import type { Tone } from '../analysis/tones'
import type { Grade } from '../ear/adapt'
import { toneName } from './tone'

const OPTIONS: [Tone, string][] = [
  [1, '¯'],
  [2, 'ˊ'],
  [3, 'ˇ'],
  [4, 'ˋ'],
  [0, '·'],
]
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
          <span className="muted small">{chosen.length > 1 ? ORDINAL[i] : ''}</span>
          {OPTIONS.map(([tone, mark]) => {
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
                <strong>{tone === 0 ? '–' : tone}</strong>
                <span aria-hidden="true">{mark}</span>
              </button>
            )
          })}
        </div>
      ))}
      <p className="muted small keys">Keys: 1–4 tones · 0 neutral · Enter check/next · Space replay · ← → previous/next</p>
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
          <li key={i}>
            <span className={`syl t${expected[i]}`}>{s}</span>
            <span className={`pill ${ok ? 'score-good' : 'score-bad'}`}>{ok ? '✓' : '✗'}</span>
            <span className={ok ? 'muted small' : 'bad small'}>
              {ok ? toneName(expected[i]) : `you said ${toneName(chosen[i] ?? 0)} · it is ${toneName(expected[i])}`}
            </span>
            {sandhi && (
              <div className="small notes">
                {chosen[i] === lexical![i] && !ok ? 'Tone sandhi: ' : 'Sandhi: '}
                written {toneName(lexical![i])}, pronounced {toneName(expected[i])}.
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Big coloured result strip; the pop/shake animation restarts whenever it mounts. */
export function ResultBanner({ grade }: { grade: Grade }) {
  const right = grade.correct.filter(Boolean).length
  const n = grade.correct.length
  return (
    <div className={`result ${grade.all ? 'ok' : 'bad'}`} role="status">
      <span>{grade.all ? '✓ Correct' : '✗ Not quite'}</span>
      {n > 1 && <small>{right} of {n} right</small>}
    </div>
  )
}
