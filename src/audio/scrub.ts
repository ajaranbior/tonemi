import { SR } from '../analysis/pitch'
import { audioContext } from './context'
import { stopPlayback } from './playback'
import { decodeTo16k } from './resample'

/** Target length of the looped grain (s). Rounded to whole pitch periods when the sound is voiced. */
const GRAIN = 0.06
/** Crossfade at the loop seam (s). */
const SEAM = 0.008
/** Crossfade between grains while dragging (s). */
const SWAP = 0.02

/**
 * One looped piece of audio [s, s + L) whose seam is crossfaded with what follows it, so the loop
 * is continuous. L is a whole number of pitch periods when a period is found, giving a steady tone.
 */
export function loopGrain(samples: Float32Array, center: number, sr = SR): Float32Array | null {
  const c = Math.round(center * sr)
  const period = findPeriod(samples, c, sr)
  const target = GRAIN * sr
  const len = period ? Math.max(1, Math.round(target / period)) * period : Math.round(target)
  const fade = Math.min(Math.round(SEAM * sr), Math.floor(len / 2))
  let s = Math.round(c - len / 2)
  s = Math.max(0, Math.min(s, samples.length - len - fade))
  if (s < 0) return null
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = samples[s + i]
  // Wrap point goes from x[s+L-1] to out[0]; blend out[0..fade) from x[s+L..] into x[s..] so it is seamless.
  for (let i = 0; i < fade; i++) {
    const a = i / fade
    out[i] = samples[s + i] * a + samples[s + len + i] * (1 - a)
  }
  // Level it: quiet syllable tails should still be audible, loud ones not clip.
  let sum = 0
  let peak = 0
  for (const v of out) {
    sum += v * v
    peak = Math.max(peak, Math.abs(v))
  }
  const rms = Math.sqrt(sum / len)
  if (rms < 1e-4) return out
  const gain = Math.min(0.18 / rms, 0.9 / peak, 20)
  for (let i = 0; i < len; i++) out[i] *= gain
  return out
}

/** Pitch period in samples around `c` (normalised autocorrelation, 70–500 Hz), or 0 if unvoiced. */
function findPeriod(x: Float32Array, c: number, sr: number): number {
  const minLag = Math.floor(sr / 500)
  const maxLag = Math.ceil(sr / 70)
  const win = Math.round(0.03 * sr)
  const a = c - Math.round(win / 2)
  if (a < 0 || a + win + maxLag > x.length) return 0
  let best = 0
  let bestLag = 0
  const corr = new Float32Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let xy = 0
    let xx = 0
    let yy = 0
    for (let i = 0; i < win; i++) {
      const p = x[a + i]
      const q = x[a + i + lag]
      xy += p * q
      xx += p * p
      yy += q * q
    }
    corr[lag] = xx && yy ? xy / Math.sqrt(xx * yy) : 0
  }
  // First strong peak avoids picking a multiple of the period.
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > best) {
      best = corr[lag]
      bestLag = lag
      if (best > 0.8) break
    }
  }
  return best > 0.5 ? bestLag : 0
}

interface Voice {
  src: AudioBufferSourceNode
  gain: GainNode
}

/** Loops a tiny slice of a recording; move it around while held. */
export class Scrubber {
  private voice: Voice | null = null
  private at = NaN
  private samples: Float32Array

  constructor(samples: Float32Array) {
    this.samples = samples
  }

  /** Start or move the loop to `t` seconds into the recording. */
  set(t: number) {
    if (Math.abs(t - this.at) < 0.004) return
    this.at = t
    const grain = loopGrain(this.samples, t)
    if (!grain) return
    const ctx = audioContext()
    if (!this.voice) stopPlayback()
    const buf = ctx.createBuffer(1, grain.length, SR)
    buf.copyToChannel(grain as Float32Array<ArrayBuffer>, 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const gain = ctx.createGain()
    const now = ctx.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(1, now + SWAP)
    src.connect(gain).connect(ctx.destination)
    src.start(now)
    this.fadeOut()
    this.voice = { src, gain }
  }

  stop() {
    this.fadeOut()
    this.at = NaN
  }

  private fadeOut() {
    const v = this.voice
    if (!v) return
    this.voice = null
    const now = v.gain.context.currentTime
    v.gain.gain.cancelScheduledValues(now)
    v.gain.gain.setValueAtTime(v.gain.gain.value, now)
    v.gain.gain.linearRampToValueAtTime(0, now + SWAP)
    v.src.stop(now + SWAP + 0.01)
  }
}

const cache = new Map<string, Promise<Float32Array>>()

/** Fetch and decode a URL to 16 kHz mono, cached. */
export function samplesFor(url: string): Promise<Float32Array> {
  let p = cache.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((data) => decodeTo16k(audioContext(), data))
    p.catch(() => cache.delete(url))
    cache.set(url, p)
    if (cache.size > 40) cache.delete(cache.keys().next().value!)
  }
  return p
}
