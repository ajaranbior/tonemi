import type { Tone } from '../analysis/tones'
import { markTone } from '../g2p/marks'

export const toneName = (t: Tone) => (t === 0 ? 'neutral' : `T${t}`)
export const comboLabel = (combo: string) => [...combo].map((c) => (c === '0' ? '0' : c)).join('-')
export const marked = (syllables: string[], tones: Tone[]) => syllables.map((s, i) => markTone(s, tones[i]))

export function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'score-none'
  if (score >= 75) return 'score-good'
  if (score >= 50) return 'score-mid'
  return 'score-bad'
}
