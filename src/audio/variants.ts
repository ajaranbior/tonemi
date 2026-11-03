import { SR } from '../analysis/pitch'
import type { Tone } from '../analysis/tones'
import { FRAME_CENTER } from './retone'

/** Frames of fade-out added after each voiced run: ~60 ms, so pieces end like speech, not like a click. */
const TAIL = 6
/** Shortest note (frames) a voiced piece is hummed as. */
const MIN_NOTE = 9

/**
 * Per-frame pitch (semitones) and loudness (0..1) for the hum. Gaps inside a syllable are pitch-tracker
 * dropouts (often the creaky end of a 3rd or 4th tone), so they are bridged; each voiced piece is then
 * at least MIN_NOTE frames long and fades out over TAIL frames, carrying on in its last direction.
 */
export function humTrack(st: ArrayLike<number | null>, segments: [number, number][] = []): { pitch: Float32Array; amp: Float32Array } {
  const n = st.length
  const pitch = Float32Array.from({ length: n }, (_, i) => {
    const v = st[i]
    return v === null || v === undefined ? NaN : v
  })
  for (const [s, e] of segments) {
    let last = -1
    for (let f = Math.max(0, s); f < Math.min(n, e); f++) {
      if (Number.isNaN(pitch[f])) continue
      if (last >= 0 && f - last > 1) for (let g = last + 1; g < f; g++) pitch[g] = pitch[last] + ((pitch[f] - pitch[last]) * (g - last)) / (f - last)
      last = f
    }
  }
  const amp = Float32Array.from(pitch, (v) => (Number.isNaN(v) ? 0 : 1))
  // Lengthen short pieces and add a fade-out tail after each.
  let f = 0
  while (f < n) {
    if (amp[f] !== 1) {
      f++
      continue
    }
    const a = f
    while (f < n && amp[f] === 1) f++
    const b = f // run is [a, b)
    const slope = b - a >= 3 ? (pitch[b - 1] - pitch[b - 3]) / 2 : 0
    const step = Math.max(-1.2, Math.min(1.2, slope))
    const hold = Math.max(0, MIN_NOTE - (b - a))
    let g = b
    for (let k = 1; k <= hold + TAIL && g < n && Number.isNaN(pitch[g]); k++, g++) {
      pitch[g] = pitch[g - 1] + (k <= hold ? step / 2 : step)
      amp[g] = k <= hold ? 1 : 1 - (k - hold) / (TAIL + 1)
    }
    f = g
  }
  return { pitch, amp }
}

/**
 * A hum that follows a recorded pitch track (semitones re 55 Hz per frame, null/NaN unvoiced): the
 * speaker's real melody with the consonants and vowels taken away. Sample 0 is the start of frame 0's
 * window, like the recording the track came from. `segments` (syllables, frames) lets dropouts inside a
 * syllable be bridged.
 */
export function humFromContour(st: ArrayLike<number | null>, hop: number, segments?: [number, number][]): Float32Array {
  const { pitch, amp } = humTrack(st, segments)
  const n = pitch.length
  const len = Math.round((n * hop + FRAME_CENTER + 0.05) * SR)
  const out = new Float32Array(len)
  const lerp = (arr: Float32Array, i: number, fallback: number) => {
    const f = (i / SR - FRAME_CENTER) / hop
    const a = Math.max(0, Math.min(n - 1, Math.floor(f)))
    const b = Math.min(n - 1, a + 1)
    const va = arr[a]
    const vb = arr[b]
    if (Number.isNaN(va)) return Number.isNaN(vb) ? fallback : vb
    if (Number.isNaN(vb)) return va
    const w = Math.max(0, Math.min(1, f - a))
    return va + (vb - va) * w
  }
  // Loudness follows the frames, but never changes faster than a 15 ms ramp.
  const slew = 1 / (0.015 * SR)
  let phase = 0
  let env = 0
  let lastSt = NaN
  for (let i = 0; i < len; i++) {
    const goal = lerp(amp, i, 0)
    env += Math.max(-slew, Math.min(slew, goal - env))
    let s = lerp(pitch, i, NaN)
    if (Number.isNaN(s)) s = lastSt
    else lastSt = s
    if (env <= 0 || Number.isNaN(s)) continue
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
