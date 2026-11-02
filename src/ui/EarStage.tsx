import { useMemo, useState, type ReactNode } from 'react'
import type { Tone } from '../analysis/tones'
import type { Grade } from '../ear/adapt'
import { AnswerPreview } from './AnswerPreview'
import { PitchPlot } from './PitchPlot'

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
  /** Set after a wrong answer: "your answer sounds like this" becomes a second tab in the same box. */
  preview?: { chosen: Tone[]; exclude?: string; syllables?: string[] } | null
}

/**
 * A fixed-size box at the top of the ear card. Before answering it is the listen target (an empty
 * pitch grid with a playhead); afterwards the chart draws into the same space, so nothing below moves.
 * Key it per trial so the tab resets.
 */
export function EarStage({ answered, chart, slots, duration, cursor, playing, onPlay, preview }: StageProps) {
  const [tab, setTab] = useState<'speaker' | 'yours'>('speaker')
  const yours = answered && !!preview && tab === 'yours'
  return (
    <div className="stage">
      {answered && preview && (
        <div className="segmented compact stage-tabs" role="tablist" aria-label="Chart">
          <button role="tab" aria-selected={!yours} className={!yours ? 'active' : ''} onClick={() => setTab('speaker')}>
            What was said
          </button>
          <button role="tab" aria-selected={yours} className={yours ? 'active' : ''} onClick={() => setTab('yours')}>
            Your answer ({preview.chosen.join('-')})
          </button>
        </div>
      )}
      <div className="stage-body" key={answered ? tab : 'question'}>
        {!answered ? (
          <Placeholder slots={slots} duration={duration} cursor={cursor} playing={playing} onPlay={onPlay} />
        ) : yours && preview ? (
          <AnswerPreview chosen={preview.chosen} exclude={preview.exclude} syllables={preview.syllables} />
        ) : (
          chart
        )}
      </div>
    </div>
  )
}

function Placeholder({ slots, duration, cursor, playing, onPlay }: { slots: number; duration: number; cursor?: number; playing: boolean; onPlay: () => void }) {
  // Evenly spaced dividers hint at the number of syllables without giving anything away.
  const boundaries = useMemo(() => Array.from({ length: slots - 1 }, (_, i) => (duration * (i + 1)) / slots), [slots, duration])
  return (
    <>
      <div className="stage-plot">
        <PitchPlot lines={NO_LINES} duration={duration} boundaries={boundaries} cursor={playing ? cursor : undefined} height="100%" />
        <button className="stage-play" onClick={onPlay} disabled={playing} aria-label="Listen">
          <span aria-hidden="true">{playing ? '🔊' : '▶'}</span>
          {playing ? 'Listening…' : 'Tap to listen'}
        </button>
      </div>
      <div className="legend">The speaker's pitch is drawn here after you answer.</div>
    </>
  )
}
const NO_LINES: never[] = []

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
