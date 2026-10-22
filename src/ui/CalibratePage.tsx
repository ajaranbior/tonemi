import { useRef, useState } from 'react'
import { chaoTrack, rangeFromSemitones, voicedSemitones, type SpeakerRange } from '../analysis/normalize'
import { stToHz, trackPitch } from '../analysis/pitch'
import { startRecording, type Recording } from '../audio/recorder'
import { DEFAULT_RANGES } from '../store'
import { micError } from './errors'
import { PitchPlot, type PlotLine } from './PitchPlot'

interface Props {
  range: SpeakerRange
  calibrated: boolean
  onSave: (r: SpeakerRange, calibrated: boolean) => void
}

const PROMPT = [
  { hanzi: '妈 麻 马 骂', pinyin: 'mā má mǎ mà' },
  { hanzi: '衣 姨 椅 意', pinyin: 'yī yí yǐ yì' },
  { hanzi: '我们明天早上八点去学校。', pinyin: 'Wǒmen míngtiān zǎoshang bā diǎn qù xuéxiào.' },
]

export function CalibratePage({ range, calibrated, onSave }: Props) {
  const [recording, setRecording] = useState(false)
  const [result, setResult] = useState<{ range: SpeakerRange; line: PlotLine; duration: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recording | null>(null)

  const start = async () => {
    setError(null)
    setResult(null)
    setRecording(true)
    try {
      rec.current = await startRecording({ maxSeconds: 25, silenceStop: 2.5 })
      const samples = await rec.current.done
      const track = trackPitch(samples)
      const r = rangeFromSemitones(voicedSemitones(track))
      if (!r) {
        setError('Not enough voiced speech detected — read all three lines at a normal volume.')
      } else {
        const chao = chaoTrack(track, r)
        setResult({ range: r, line: { t: Array.from(chao, (_, i) => i * track.hop), v: chao, kind: 'user' }, duration: chao.length * track.hop })
      }
    } catch (e) {
      setError(micError(e))
    } finally {
      rec.current = null
      setRecording(false)
    }
  }

  const hz = (r: SpeakerRange) => `${Math.round(stToHz(r.lo))}–${Math.round(stToHz(r.hi))} Hz`

  return (
    <div className="page">
      <section className="card">
        <h2>Your pitch range</h2>
        <p className="small">
          Scores compare <em>relative</em> height, so the app needs to know where your 1 and 5 are. Read the lines below
          in your normal speaking voice — natural, not sung. Recording stops after 2.5 s of silence.
        </p>
        <ol className="prompt">
          {PROMPT.map((p) => (
            <li key={p.hanzi}>
              <div className="hanzi-sm">{p.hanzi}</div>
              <div className="muted small">{p.pinyin}</div>
            </li>
          ))}
        </ol>
        <div className="controls">
          {recording ? (
            <button className="primary recording" onClick={() => rec.current?.stop()}>■ Stop</button>
          ) : (
            <button className="primary" onClick={start}>● Record</button>
          )}
        </div>
        {error && <p className="bad small">{error}</p>}
        {result && (
          <>
            <PitchPlot lines={[result.line]} duration={result.duration} height={160} />
            <p>
              Range: <strong>{hz(result.range)}</strong> (Chao 1 → 5)
            </p>
            <div className="controls">
              <button className="primary" onClick={() => onSave(result.range, true)}>Save</button>
              <button onClick={start}>Redo</button>
            </div>
          </>
        )}
        <p className="muted small">Current: {hz(range)} {calibrated ? '(calibrated)' : '(default)'}</p>
      </section>

      <section className="card">
        <h3>Skip for now</h3>
        <p className="small">Use a typical range until you calibrate:</p>
        <div className="controls">
          <button onClick={() => onSave(DEFAULT_RANGES.low, false)}>Lower voice ({hz(DEFAULT_RANGES.low)})</button>
          <button onClick={() => onSave(DEFAULT_RANGES.high, false)}>Higher voice ({hz(DEFAULT_RANGES.high)})</button>
        </div>
      </section>
    </div>
  )
}
