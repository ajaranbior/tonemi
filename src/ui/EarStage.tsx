import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Tone } from '../analysis/tones'
import type { Grade } from '../ear/adapt'
import { AnswerPreview, type PreviewVoice } from './AnswerPreview'
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
  /** Set after a wrong answer: "your answer sounds like this" becomes a second tab in the same box. */
  preview?: { chosen: Tone[]; exclude?: string; syllables?: string[]; voice?: PreviewVoice } | null
  /** Draw-the-pitch mode: the learner's sketch so far, and how to extend or clear it. */
  sketch?: { line: PlotLine | null; onDraw: (pt: { t: number; v: number }, start: boolean) => void; onClear: () => void }
}

/**
 * A fixed-size box at the top of the ear card. Before answering it is the listen target (an empty
 * pitch grid with a playhead); afterwards the chart draws into the same space, so nothing below moves.
 * Key it per trial so the tab resets.
 */
export function EarStage({ answered, chart, slots, duration, cursor, playing, onPlay, preview, sketch }: StageProps) {
  const [tab, setTab] = useState<'speaker' | 'yours'>('speaker')
  const yours = answered && !!preview && tab === 'yours'
  // Coming back from "Your answer" replays what was said (the preview autoplays the other way).
  // In an effect, not the click handler, so it starts after the preview's unmount has stopped its audio.
  const prevTab = useRef(tab)
  const play = useRef(onPlay)
  play.current = onPlay
  useEffect(() => {
    if (prevTab.current === 'yours' && tab === 'speaker') play.current()
    prevTab.current = tab
  }, [tab])
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
          <Placeholder slots={slots} duration={duration} cursor={cursor} playing={playing} onPlay={onPlay} sketch={sketch} />
        ) : yours && preview ? (
          <AnswerPreview chosen={preview.chosen} exclude={preview.exclude} syllables={preview.syllables} voice={preview.voice} />
        ) : (
          chart
        )}
      </div>
    </div>
  )
}

function Placeholder({ slots, duration, cursor, playing, onPlay, sketch }: { slots: number; duration: number; cursor?: number; playing: boolean; onPlay: () => void; sketch?: StageProps['sketch'] }) {
  // Evenly spaced dividers hint at the number of syllables without giving anything away.
  const boundaries = useMemo(() => Array.from({ length: slots - 1 }, (_, i) => (duration * (i + 1)) / slots), [slots, duration])
  const line = sketch?.line
  const lines = useMemo(() => (line ? [line] : NO_LINES), [line])
  return (
    <>
      <div className="stage-plot">
        <PitchPlot lines={lines} duration={duration} boundaries={boundaries} cursor={playing ? cursor : undefined} height="100%" draw={sketch?.onDraw} />
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
      ) : (
        <div className="legend">The speaker's pitch is drawn here after you answer.</div>
      )}
    </>
  )
}
const NO_LINES: PlotLine[] = []

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
