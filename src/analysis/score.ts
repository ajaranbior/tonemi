import { mean, syllableContour } from './contour'
import type { Segment } from './segment'
import { recognizeTone, type Recognition, type Tone } from './tones'

export interface Utterance {
  /** Per-frame Chao values, NaN when unvoiced. */
  chao: ArrayLike<number>
  segments: Segment[]
}

export interface SyllableResult {
  expected: Tone
  /** Undefined for neutral tones or unusable pitch. */
  recognized?: Recognition
  score: number | null
  /** user − reference mean height, Chao units. */
  heightErr: number
  /** RMS contour difference after removing the mean, Chao units. */
  shapeErr: number
  notes: string[]
}

export interface DrillResult {
  score: number | null
  syllables: SyllableResult[]
  /** user range ÷ reference range across the utterance. */
  rangeRatio: number | null
  notes: string[]
}

const POINTS = 10

export function syllableScore(heightErr: number, shapeErr: number): number {
  const err = Math.sqrt(0.5 * heightErr ** 2 + shapeErr ** 2)
  return Math.round(100 * Math.exp(-err / 1.5))
}

/** Compare a user attempt to a reference, syllable by syllable (both already segmented). */
export function compareToReference(user: Utterance, ref: Utterance, expected: Tone[]): DrillResult {
  const n = expected.length
  const syllables: SyllableResult[] = []
  for (let i = 0; i < n; i++) {
    const final = i === n - 1
    const u = syllableContour(user.chao, user.segments[i], POINTS, 0.1)
    const r = syllableContour(ref.chao, ref.segments[i], POINTS, 0.1)
    const res: SyllableResult = { expected: expected[i], score: null, heightErr: 0, shapeErr: 0, notes: [] }
    if (!u || !r) {
      if (expected[i] !== 0) res.notes.push('No clear pitch on this syllable')
      syllables.push(res)
      continue
    }
    const mu = mean(u)
    const mr = mean(r)
    res.heightErr = mu - mr
    res.shapeErr = Math.sqrt(mean(u.map((v, k) => (v - mu - (r[k] - mr)) ** 2)))
    res.score = syllableScore(res.heightErr, res.shapeErr)
    if (expected[i] !== 0) {
      const u5 = syllableContour(user.chao, user.segments[i], 5, 0.1)!
      res.recognized = recognizeTone(u5, final)
    }
    res.notes.push(...syllableNotes(expected[i], u, r, res.heightErr, final))
    syllables.push(res)
  }

  // Neutral syllables are often devoiced; only toned syllables must have pitch.
  const scored = syllables.filter((s) => s.score !== null)
  const missing = syllables.some((s) => s.score === null && s.expected !== 0)
  const score = !missing && scored.length ? Math.round(mean(scored.map((s) => s.score!))) : null
  const rangeRatio = utteranceRange(user) / utteranceRange(ref)
  const notes: string[] = []
  if (Number.isFinite(rangeRatio)) {
    if (rangeRatio < 0.7) notes.push(`You used ${Math.round(rangeRatio * 100)}% of the reference's pitch range — exaggerate the highs and lows.`)
    else if (rangeRatio > 1.5) notes.push(`Your pitch range is ${rangeRatio.toFixed(1)}× the reference's — a bit less drama.`)
  }
  return { score, syllables, rangeRatio: Number.isFinite(rangeRatio) ? rangeRatio : null, notes }
}

function syllableNotes(tone: Tone, u: number[], r: number[], heightErr: number, final: boolean): string[] {
  const notes: string[] = []
  const slope = (c: number[]) => c[c.length - 1] - c[0]
  const su = slope(u)
  const sr = slope(r)
  if (heightErr > 0.7) notes.push(`About ${heightErr.toFixed(1)} Chao levels too high`)
  else if (heightErr < -0.7) notes.push(`About ${(-heightErr).toFixed(1)} Chao levels too low`)
  if (sr > 1 && su < sr * 0.5) notes.push('Rise too small')
  if (sr < -1 && su > sr * 0.5) notes.push('Fall too small')
  if (Math.abs(sr) < 0.6 && Math.abs(su) > 1.2) notes.push(su > 0 ? 'Should stay level — yours rises' : 'Should stay level — yours falls')
  if (tone === 3 && !final && Math.min(...u) > 2.2) notes.push(`Half-3rd not low enough (lowest ≈ ${Math.min(...u).toFixed(1)}, aim ≤ 2)`)
  if (tone === 1 && mean(u) < 3.8) notes.push('1st tone should sit at the top of your range')
  return notes
}

function utteranceRange(u: Utterance): number {
  const v: number[] = []
  const s = u.segments[0][0]
  const e = u.segments[u.segments.length - 1][1]
  for (let i = s; i < e; i++) if (!Number.isNaN(u.chao[i])) v.push(u.chao[i])
  if (v.length < 5) return NaN
  v.sort((a, b) => a - b)
  return v[Math.floor(v.length * 0.95)] - v[Math.floor(v.length * 0.05)]
}
