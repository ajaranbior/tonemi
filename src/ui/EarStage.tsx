import { useMemo, type ReactNode } from 'react'
import type { Grade } from '../ear/adapt'
import { AnswerButton, type Preview } from './AnswerPreview'
import { PitchPlot, type PlotLine } from './PitchPlot'

interface StageProps {
  answered: boolean
  /** The speaker's chart (plot + legend), shown once answered. */
  chart: ReactNode
  /** Before answering: number of syllables, clip length (s), playhead and play action. */
  slots: number
  duration: number
  cursor?: number
  playing: boolean
  onPlay: () => void
  /** Set after a wrong answer: a corner button (and the F key) plays what the answer would sound like. */
  preview?: Preview | null
  /** Draw-the-pitch mode: the learner's sketch so far, and how to extend or clear it. */
  sketch?: { line: PlotLine | null; onDraw: (pt: { t: number; v: number }, start: boolean) => void; onClear: () => void }
  /** One syllable is being asked about: its real time span (s), and the other syllables' spans, outlined. */
  focus?: { span: [number, number]; others: [number, number][] }
  /** Before answering: the speaker's pitch on syllables whose tones are given, and the real syllable boundaries. */
  hint?: { lines: PlotLine[]; boundaries: number[] }
}

/**
 * A fixed-size box at the top of the ear card. Before answering it is the listen target (an empty
 * pitch grid with a playhead); afterwards the chart draws into the same space, so nothing below moves.
 * Key it per trial.
 */
export function EarStage({ answered, chart, slots, duration, cursor, playing, onPlay, preview, sketch, focus, hint }: StageProps) {
  return (
    <div className="stage">
      <div className="stage-body" key={answered ? 'answer' : 'question'}>
        {!answered ? (
          <Placeholder slots={slots} duration={duration} cursor={cursor} playing={playing} onPlay={onPlay} sketch={sketch} focus={focus} hint={hint} />
        ) : (
          chart
        )}
      </div>
      {answered && preview && <AnswerButton {...preview} />}
    </div>
  )
}

function Placeholder({ slots, duration, cursor, playing, onPlay, sketch, focus, hint }: { slots: number; duration: number; cursor?: number; playing: boolean; onPlay: () => void; sketch?: StageProps['sketch']; focus?: StageProps['focus']; hint?: StageProps['hint'] }) {
  // Evenly spaced dividers hint at the number of syllables without giving anything away;
  // with a focus syllable, every syllable gets its real box instead (tinted for the one asked).
  const even = useMemo(() => Array.from({ length: slots - 1 }, (_, i) => (duration * (i + 1)) / slots), [slots, duration])
  const boundaries = focus ? NO_BOUNDARIES : hint ? hint.boundaries : even
  const line = sketch?.line
  const hinted = hint?.lines
  const lines = useMemo(() => [...(hinted ?? NO_LINES), ...(line ? [line] : NO_LINES)], [line, hinted])
  return (
    <>
      <div className="stage-plot">
        <PitchPlot lines={lines} duration={duration} boundaries={boundaries} cursor={playing ? cursor : undefined} height="100%" draw={sketch?.onDraw} focus={focus?.span} outline={focus?.others} />
        <button className={`stage-play${sketch ? ' corner' : ''}`} onClick={onPlay} disabled={playing} aria-label="Listen">
          <span aria-hidden="true">{playing ? '🔊' : '▶'}</span>
          {playing ? 'Listening…' : sketch ? 'Listen' : 'Tap to listen'}
        </button>
      </div>
      {sketch ? (
        <div className="legend">
          Draw the melody you heard, then pick the tones.
          {sketch.line && (
            <button className="link small" onClick={sketch.onClear}>Clear drawing</button>
          )}
        </div>
      ) : focus ? (
        <div className="legend">
          <span className="key focus" /> listen for this syllable{hint ? <> · <span className="key given" /> the other syllables</> : ' · the speaker\'s pitch is drawn after you answer'}
        </div>
      ) : hint ? (
        <div className="legend"><span className="key given" /> the other syllables · the rest is drawn after you answer</div>
      ) : (
        <div className="legend">The speaker's pitch is drawn here after you answer.</div>
      )}
    </>
  )
}
const NO_LINES: PlotLine[] = []
const NO_BOUNDARIES: number[] = []

/** Compact right/wrong chip for the card header (replaces the full-width banner). */
export function ResultChip({ grade, accepted, comeback }: { grade: Grade; accepted?: boolean; comeback?: boolean }) {
  const ok = grade.all || accepted
  const kind = comeback && grade.all ? 'comeback' : ok ? 'ok' : 'bad'
  const text = accepted ? '✓ Marked correct' : kind === 'comeback' ? '↺ Got it this time!' : grade.all ? '✓ Correct' : '✗ Not quite'
  return (
    <div className={`result-chip ${kind}`} role="status">
      {text}
    </div>
  )
}
