import { hzToSt, type PitchTrack } from './pitch'

/** A speaker's pitch range in semitones (re 55 Hz), mapped to Chao 1..5. */
export interface SpeakerRange {
  lo: number
  hi: number
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN
  const idx = (sorted.length - 1) * p
  const a = Math.floor(idx)
  const b = Math.min(sorted.length - 1, a + 1)
  return sorted[a] + (sorted[b] - sorted[a]) * (idx - a)
}

/** Range from pooled voiced semitone values: 5th..95th percentile. */
export function rangeFromSemitones(values: number[]): SpeakerRange | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length < 50) return null
  const lo = percentile(v, 0.05)
  let hi = percentile(v, 0.95)
  if (hi - lo < 4) hi = lo + 4 // guard against near-monotone input
  return { lo, hi }
}

export function voicedSemitones(track: PitchTrack): number[] {
  const out: number[] = []
  for (const hz of track.hz) if (!Number.isNaN(hz)) out.push(hzToSt(hz))
  return out
}

export function stToChao(st: number, r: SpeakerRange): number {
  return 1 + (4 * (st - r.lo)) / (r.hi - r.lo)
}

/**
 * Per-frame Chao values (NaN when unvoiced). Creaky stretches after voicing are
 * filled with a ramp down to the bottom of the range (Chao 1), since creak is
 * how the low end of T3/T4 is often realised.
 */
export function chaoTrack(track: PitchTrack, r: SpeakerRange): Float32Array {
  const out = Float32Array.from(track.hz, (hz) => (Number.isNaN(hz) ? NaN : stToChao(hzToSt(hz), r)))
  let i = 1
  while (i < out.length) {
    if (!track.creak[i] || Number.isNaN(out[i - 1])) { i++; continue }
    let j = i
    while (j < out.length && track.creak[j]) j++
    const from = out[i - 1]
    const to = Math.min(from, 1)
    for (let k = i; k < j; k++) out[k] = from + ((to - from) * (k - i + 1)) / (j - i)
    i = j
  }
  return out
}
