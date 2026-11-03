import { SR } from '../analysis/pitch'
import type { Tone } from '../analysis/tones'
import { FRAME_CENTER } from './retone'

/**
 * A hum that follows a recorded pitch track (semitones re 55 Hz per frame, null/NaN unvoiced): the
 * speaker's real melody with the consonants and vowels taken away. Sample 0 is the start of frame 0's
 * window, like the recording the track came from.
 */
export function humFromContour(st: ArrayLike<number | null>, hop: number): Float32Array {
  const n = st.length
  const len = Math.round((n * hop + FRAME_CENTER + 0.05) * SR)
  const out = new Float32Array(len)
  const val = (f: number) => {
    const v = f >= 0 && f < n ? st[f] : null
    return v === null || v === undefined || Number.isNaN(v) ? NaN : v
  }
  // Per sample: interpolated semitones, NaN when the nearest frame is unvoiced.
  const at = (i: number) => {
    const f = (i / SR - FRAME_CENTER) / hop
    const r = Math.round(f)
    if (Number.isNaN(val(r))) return NaN
    const a = Math.floor(f)
    const va = val(a)
    const vb = val(a + 1)
    if (Number.isNaN(va)) return vb
    if (Number.isNaN(vb)) return va
    return va + (vb - va) * (f - a)
  }
  const fade = Math.round(0.015 * SR)
  let phase = 0
  let env = 0
  let lastSt = NaN
  for (let i = 0; i < len; i++) {
    let s = at(i)
    const voiced = !Number.isNaN(s)
    if (voiced) lastSt = s
    else s = lastSt
    env = Math.max(0, Math.min(1, env + (voiced ? 1 : -1) / fade))
    if (env === 0 || Number.isNaN(s)) continue
    phase += (2 * Math.PI * 55 * 2 ** (s / 12)) / SR
    out[i] = 0.26 * env * (Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase))
  }
  return out
}

/**
 * The recording through a steep low-pass (≈ 350 Hz): the pitch and rhythm stay, most of the
 * consonants and vowel colour go, so the word is hard to make out.
 */
export function muffle(x: Float32Array, cutoff = 350): Float32Array {
  let y = Float32Array.from(x)
  // Four passes of a 2nd-order Butterworth low-pass (RBJ biquad) ≈ 48 dB/octave.
  const w = (2 * Math.PI * cutoff) / SR
  const alpha = Math.sin(w) / Math.SQRT2
  const cos = Math.cos(w)
  const a0 = 1 + alpha
  const b0 = (1 - cos) / 2 / a0
  const b1 = (1 - cos) / a0
  const b2 = b0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0
  for (let pass = 0; pass < 4; pass++) {
    const out = new Float32Array(y.length)
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      x2 = x1
      x1 = y[i]
      y2 = y1
      y1 = v
      out[i] = v
    }
    y = out
  }
  let peak = 0
  for (const v of y) peak = Math.max(peak, Math.abs(v))
  const gain = peak > 0 ? Math.min(0.9 / peak, 8) : 1
  for (let i = 0; i < y.length; i++) y[i] *= gain
  return y
}

/**
 * A word can be resynthesized with `pattern` when it has as many syllables and its neutral tones sit in
 * the same places (a neutral tone is shorter and weaker, not just a different pitch, so it can't be
 * made by moving pitch alone).
 */
export function canRetone(surface: Tone[], pattern: Tone[]): boolean {
  return surface.length === pattern.length && surface.every((t, k) => (t === 0) === (pattern[k] === 0))
}

/** Playback rate for "vary pitch and speed": 0.9–1.1, so pitch moves by up to ±1.7 semitones. */
export const jitterRate = (rand: () => number = Math.random) => 0.9 + 0.2 * rand()
