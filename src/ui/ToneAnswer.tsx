import type { Tone } from '../analysis/tones'
import type { Grade } from '../ear/adapt'
import { ToneChip, ToneGlyph } from './ToneGlyph'

const OPTIONS: Tone[] = [1, 2, 3, 4, 0]
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th']

interface Props {
  chosen: (Tone | null)[]
  /** Set once answered: marks right/wrong buttons and locks input. */
  expected?: Tone[]
  onPick: (index: number, tone: Tone) => void
}

/** One row of tone buttons per syllable. */
export function ToneAnswer({ chosen, expected, onPick }: Props) {
  return (
    <div className="tone-rows">
      {chosen.map((pick, i) => (
        <div className="tone-row" key={i}>
          {expected ? (
            <span className={`row-mark ${pick === expected[i] ? 'ok' : 'bad'}`} aria-label={pick === expected[i] ? 'correct' : 'wrong'}>
              {pick === expected[i] ? '✓' : '✗'}
            </span>
          ) : (
            <span className="muted small">{chosen.length > 1 ? ORDINAL[i] : ''}</span>
          )}
          {OPTIONS.map((tone) => {
            const state = expected
              ? tone === expected[i]
                ? 'ok'
                : pick === tone
                  ? 'wrong'
                  : ''
              : pick === tone
                ? 'picked'
                : ''
            return (
              <button
                key={tone}
                className={`tone-btn t${tone} ${state}`}
                disabled={!!expected || (i === 0 && tone === 0)}
                aria-pressed={pick === tone}
                aria-label={`${ORDINAL[i]} syllable: ${tone === 0 ? 'neutral tone' : `tone ${tone}`}`}
                onClick={() => onPick(i, tone)}
              >
                <strong>{tone === 0 ? '5' : tone}</strong>
                <ToneGlyph tone={tone} />
              </button>
            )
          })}
        </div>
      ))}
      <p className="muted small keys">Keys: 1–4 tones · 5 neutral · Backspace undo · Enter check/next · Space replay · ← → previous/next · M mark correct</p>
    </div>
  )
}

interface VerdictProps {
  syllables: string[]
  expected: Tone[]
  lexical?: Tone[]
  chosen: (Tone | null)[]
}

export function Verdict({ syllables, expected, lexical, chosen }: VerdictProps) {
  return (
    <ul className="syllables">
      {syllables.map((s, i) => {
        const ok = chosen[i] === expected[i]
        const sandhi = lexical && lexical[i] !== expected[i]
        return (
          <li key={i} className={`verdict-row ${ok ? 'ok' : 'bad'}`}>
            <span className="verdict-mark" aria-label={ok ? 'correct' : 'wrong'}>{ok ? '✓' : '✗'}</span>
            <span className={`syl t${expected[i]}`}>{s}</span>
            {ok ? (
              <ToneChip tone={expected[i]} />
            ) : (
              <div className="compare">
                <div><small>target</small><ToneChip tone={expected[i]} /></div>
                <div><small>you</small><ToneChip tone={chosen[i] ?? 0} /></div>
              </div>
            )}
            {sandhi && (
              <div className="small notes">
                {chosen[i] === lexical![i] && !ok ? 'Tone sandhi: ' : 'Sandhi: '}
                written {lexical![i] === 0 ? 'neutral' : `tone ${lexical![i]}`}, pronounced {expected[i] === 0 ? 'neutral' : `tone ${expected[i]}`}.
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Big coloured result strip; the pop/shake animation restarts whenever it mounts. */
export function ResultBanner({ grade, accepted }: { grade: Grade; accepted?: boolean }) {
  return (
    <div className={`result ${grade.all || accepted ? 'ok' : 'bad'}`} role="status">
      <span>{accepted ? '✓ Marked correct' : grade.all ? '✓ Correct' : '✗ Not quite'}</span>
      {accepted && <small>you overruled the key</small>}
    </div>
  )
}
