import type { Tone } from '../analysis/tones'
import { markTone } from '../g2p/marks'

export const toneName = (t: Tone) => (t === 0 ? 'neutral' : `T${t}`)
export const toneLong = (t: Tone) =>
  ({ 0: 'Neutral (5) · light', 1: 'Tone 1 · high level', 2: 'Tone 2 · rising', 3: 'Tone 3 · falling-rising', 4: 'Tone 4 · falling' })[t]
export const comboLabel = (combo: string) => [...combo].map((c) => (c === '0' ? '0' : c)).join('-')
export const markedSyllable = (s: string, tone: Tone) => (tone === 0 ? `·${markTone(s, 0)}` : markTone(s, tone))
export const marked = (syllables: string[], tones: Tone[]) => syllables.map((s, i) => markedSyllable(s, tones[i]))

export function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'score-none'
  if (score >= 75) return 'score-good'
  if (score >= 50) return 'score-mid'
  return 'score-bad'
}
