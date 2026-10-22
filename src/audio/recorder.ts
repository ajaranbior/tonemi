import { createFrameAnalyzer, HOP, SR, WIN } from '../analysis/pitch'
import { audioContext } from './context'
import { Downsampler } from './resample'

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('tonemi-tap', Tap)
`

let workletLoaded: Promise<void> | null = null

export interface LiveFrame {
  t: number
  hz: number
  rms: number
}

export interface RecordOptions {
  maxSeconds: number
  /** Stop after this much silence once speech has started; 0 disables. */
  silenceStop?: number
  /** Keep the browser's echo cancellation on (needed when shadowing over speakers). */
  echoCancellation?: boolean
  onFrame?: (f: LiveFrame) => void
}

export interface Recording {
  stop: () => void
  /** 16 kHz mono samples. */
  done: Promise<Float32Array>
}

/** Record from the microphone, with live pitch frames and optional auto-stop on silence. */
export async function startRecording(opts: RecordOptions): Promise<Recording> {
  const ctx = audioContext()
  if (!workletLoaded) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    workletLoaded = ctx.audioWorklet.addModule(url)
  }
  await workletLoaded
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: opts.echoCancellation ?? false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  })
  await ctx.resume()
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'tonemi-tap')
  // Keep the graph pulling without making any sound.
  const mute = ctx.createGain()
  mute.gain.value = 0
  source.connect(node).connect(mute).connect(ctx.destination)

  const down = new Downsampler(ctx.sampleRate)
  const analyze = createFrameAnalyzer()
  const chunks: Float32Array[] = []
  let total = 0
  let pending = new Float32Array(0)
  let frame = 0
  let voicedFrames = 0
  let silentRun = 0

  let resolveDone!: (s: Float32Array) => void
  const done = new Promise<Float32Array>((r) => (resolveDone = r))
  let stopped = false

  const stop = () => {
    if (stopped) return
    stopped = true
    node.port.onmessage = null
    source.disconnect()
    node.disconnect()
    mute.disconnect()
    stream.getTracks().forEach((t) => t.stop())
    const out = new Float32Array(total)
    let off = 0
    for (const c of chunks) { out.set(c, off); off += c.length }
    resolveDone(out)
  }

  const silenceFrames = Math.round((opts.silenceStop ?? 0) / (HOP / SR))
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const s = down.push(e.data)
    chunks.push(s)
    total += s.length
    const buf = new Float32Array(pending.length + s.length)
    buf.set(pending)
    buf.set(s, pending.length)
    let at = 0
    while (at + WIN <= buf.length) {
      const r = analyze(buf.subarray(at, at + WIN))
      opts.onFrame?.({ t: frame * (HOP / SR), hz: r.hz, rms: r.rms })
      if (Number.isNaN(r.hz)) silentRun++
      else { voicedFrames++; silentRun = 0 }
      frame++
      at += HOP
    }
    pending = buf.slice(at)
    if (total >= opts.maxSeconds * SR) stop()
    else if (silenceFrames && voicedFrames > 8 && silentRun >= silenceFrames) stop()
  }

  return { stop, done }
}
