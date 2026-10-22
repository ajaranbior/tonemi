import { SR } from '../analysis/pitch'

/** Streaming downsampler to 16 kHz (box low-pass + linear interpolation). Good enough for F0. */
export class Downsampler {
  private tail = new Float32Array(0)
  private pos = 0
  private readonly step: number
  private readonly taps: number

  constructor(inRate: number) {
    this.step = inRate / SR
    this.taps = Math.max(1, Math.round(this.step))
  }

  push(input: Float32Array): Float32Array {
    const data = new Float32Array(this.tail.length + input.length)
    data.set(this.tail)
    data.set(input, this.tail.length)
    const out: number[] = []
    while (this.pos + this.taps + 1 < data.length) {
      const i = Math.floor(this.pos)
      const frac = this.pos - i
      let a = 0
      let b = 0
      for (let k = 0; k < this.taps; k++) { a += data[i + k]; b += data[i + k + 1] }
      out.push((a + (b - a) * frac) / this.taps)
      this.pos += this.step
    }
    const drop = Math.floor(this.pos)
    this.tail = data.slice(drop)
    this.pos -= drop
    return Float32Array.from(out)
  }
}

/** Decode any browser-supported audio/video file to 16 kHz mono. */
export async function decodeTo16k(ctx: AudioContext, data: ArrayBuffer): Promise<Float32Array> {
  const decoded = await ctx.decodeAudioData(data)
  const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * SR), SR)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0)
}
