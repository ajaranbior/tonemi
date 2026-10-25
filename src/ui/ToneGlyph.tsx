import type { Tone } from '../analysis/tones'
import { toneLong } from './tone'
import { GLYPH_POINTS } from './toneShapes'

/** The tone's pitch shape as a small icon: ¯ ˊ ˇ ˋ, and a dot for the neutral tone. */
export function ToneGlyph({ tone }: { tone: Tone }) {
  return (
    <svg className={`glyph t${tone}`} viewBox="0 0 24 16" width="24" height="16" aria-hidden="true">
      {tone === 0 ? (
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      ) : (
        <polyline points={GLYPH_POINTS[tone].map((q) => q.join(',')).join(' ')} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
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
