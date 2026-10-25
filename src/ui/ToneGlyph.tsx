import type { Tone } from '../analysis/tones'
import { toneLong } from './tone'

const SHAPES: Record<Tone, string> = {
  1: '3,3 21,3',
  2: '3,12 21,3',
  3: '3,4 10,13 21,3',
  4: '3,3 21,14',
  0: '',
}

/** The tone's pitch shape as a small icon: ¯ ˊ ˇ ˋ, and a dot for the neutral tone. */
export function ToneGlyph({ tone }: { tone: Tone }) {
  return (
    <svg className={`glyph t${tone}`} viewBox="0 0 24 16" width="24" height="16" aria-hidden="true">
      {tone === 0 ? (
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      ) : (
        <polyline points={SHAPES[tone]} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

/** Icon + full name, e.g. "[ˇ] Tone 3 · falling-rising". */
export function ToneChip({ tone }: { tone: Tone }) {
  return (
    <span className={`tone-chip t${tone}`}>
      <ToneGlyph tone={tone} />
      <span>{toneLong(tone)}</span>
    </span>
  )
}
