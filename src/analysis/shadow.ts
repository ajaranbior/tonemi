import { mean } from './contour'
import { dtw } from './dtw'

export interface VoicedSeq {
  /** Times (s) of voiced frames. */
  t: number[]
  /** Chao values of voiced frames. */
  v: number[]
}

export function voicedSeq(chao: ArrayLike<number>, hop: number, from = 0, to = chao.length, step = 2): VoicedSeq {
  const t: number[] = []
  const v: number[] = []
  for (let i = from; i < to; i += step) {
    if (!Number.isNaN(chao[i])) {
      t.push((i - from) * hop)
      v.push(chao[i])
    }
  }
  return { t, v }
}

export interface ShadowResult {
  score: number
  /** Mean height difference user − native, Chao units. */
  heightDiff: number
  /** Contour distance after removing the overall height difference. */
  shapeErr: number
  rangeRatio: number
  /** User values warped onto the native time axis. */
  warped: { t: number[]; v: number[] }
  notes: string[]
}

/** Compare a whole line without syllable alignment: DTW over voiced pitch, both speaker-normalised. */
export function compareLine(native: VoicedSeq, user: VoicedSeq): ShadowResult | null {
  if (native.v.length < 10 || user.v.length < 10) return null
  const heightDiff = mean(user.v) - mean(native.v)
  // Align on shape (mean-removed) so a global register offset doesn't distort the warp.
  const a = native.v.map((x) => x - mean(native.v))
  const b = user.v.map((x) => x - mean(user.v))
  const { path, meanAbs } = dtw(a, b)

  const sums = new Float64Array(a.length)
  const counts = new Uint16Array(a.length)
  for (const [i, j] of path) { sums[i] += user.v[j]; counts[i]++ }
  const warped = { t: native.t, v: Array.from(sums, (s, i) => s / counts[i]) }

  const err = Math.sqrt(meanAbs ** 2 + 0.5 * heightDiff ** 2)
  const score = Math.round(100 * Math.exp(-err / 1.2))
  const rangeRatio = spread(user.v) / spread(native.v)

  const notes: string[] = []
  if (heightDiff > 0.7) notes.push(`Overall about ${heightDiff.toFixed(1)} Chao levels higher than the native speaker (relative to your range).`)
  if (heightDiff < -0.7) notes.push(`Overall about ${(-heightDiff).toFixed(1)} Chao levels lower than the native speaker.`)
  if (rangeRatio < 0.7) notes.push(`You used ${Math.round(rangeRatio * 100)}% of the native pitch range — make the highs higher and the lows lower.`)
  if (rangeRatio > 1.5) notes.push(`Your pitch range is ${rangeRatio.toFixed(1)}× the native one.`)
  if (meanAbs > 0.8) notes.push('Melody differs noticeably — listen to the line at 0.75× and try echo mode.')
  return { score, heightDiff, shapeErr: meanAbs, rangeRatio, warped, notes }
}

function spread(v: number[]): number {
  const s = v.slice().sort((x, y) => x - y)
  return s[Math.floor(s.length * 0.95)] - s[Math.floor(s.length * 0.05)]
}
