import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chaoTrack, stToChao, type SpeakerRange } from '../analysis/normalize'
import { hzToSt, trackPitch } from '../analysis/pitch'
import { compareToReference, type DrillResult } from '../analysis/score'
import { segmentSyllables, type Segment } from '../analysis/segment'
import { playUrl, stopPlayback, wavUrl } from '../audio/playback'
import { startRecording, type Recording } from '../audio/recorder'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, ItemKind, Manifest } from '../bank/types'
import { getPref, getProgress, recordScore, setPref } from '../store'
import { ComboPicker } from './ComboPicker'
import { comboScores } from './progress'
import { micError } from './errors'
import { Toggle } from './Toggle'
import { PitchPlot, type PlotLabel, type PlotLine } from './PitchPlot'
import { marked, scoreClass, toneName } from './tone'

type Phase = 'idle' | 'listening' | 'recording'

interface Attempt {
  result: DrillResult
  lines: PlotLine[]
  labels: PlotLabel[]
  boundaries: number[]
  duration: number
  wav: string
}

interface Props {
  range: SpeakerRange
  calibrated: boolean
  onCalibrate: () => void
}

export function DrillPage({ range, calibrated, onCalibrate }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<ItemKind>(() => getPref('drill.kind', 'pair') as ItemKind)
  const [combo, setCombo] = useState<string>(() => getPref('drill.combo', 'auto'))
  const [item, setItem] = useState<BankItem | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [live, setLive] = useState<{ t: number[]; v: number[] } | null>(null)
  const [showPinyin, setShowPinyin] = useState(() => getPref<boolean>('drill.pinyin', true))
  const [autoRecord, setAutoRecord] = useState(() => getPref<boolean>('drill.autoRecord', true))
  const [smoothOnly, setSmoothOnly] = useState(() => getPref<boolean>('drill.smooth', false))
  const [hum, setHum] = useState(() => getPref<boolean>('drill.hum', false))
  const [progressTick, setProgressTick] = useState(0)
  const recording = useRef<Recording | null>(null)

  useEffect(() => {
    loadManifest().then(setManifest, (e) => setError(String(e)))
  }, [])

  const refRange = manifest && item ? manifest.speakers[item.speaker].range : null
  const scores = useMemo(
    () => (manifest ? comboScores(manifest.items, getProgress()) : new Map()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manifest, progressTick],
  )

  const pickItem = useCallback(
    (k: ItemKind, c: string, avoid?: BankItem | null) => {
      if (!manifest) return
      let pool = manifest.items.filter((i) => i.kind === k)
      let target = c
      if (c === 'auto') target = pickWeakCombo(pool, scores)
      pool = pool.filter((i) => i.combo === target)
      if (smoothOnly && pool.some((i) => i.sonorant)) pool = pool.filter((i) => i.sonorant)
      if (pool.length > 1 && avoid) pool = pool.filter((i) => i.id !== avoid.id)
      setItem(pool[Math.floor(Math.random() * pool.length)] ?? null)
      setAttempt(null)
      setLive(null)
    },
    [manifest, scores, smoothOnly],
  )

  useEffect(() => {
    if (manifest && !item) pickItem(kind, combo)
  }, [manifest, item, kind, combo, pickItem])

  const choose = (k: ItemKind, c: string) => {
    setKind(k)
    setCombo(c)
    setPref('drill.kind', k)
    setPref('drill.combo', c)
    pickItem(k, c)
  }

  const record = async () => {
    if (!item || !refRange) return
    stopPlayback()
    setAttempt(null)
    const t: number[] = []
    const v: number[] = []
    setLive({ t, v })
    setPhase('recording')
    let raf = 0
    const tick = () => {
      setLive({ t: t.slice(), v: v.slice() })
      raf = requestAnimationFrame(tick)
    }
    try {
      recording.current = await startRecording({
        maxSeconds: 2.5 + item.lexical.length * 1.2,
        silenceStop: 0.6,
        onFrame: (f) => {
          t.push(f.t)
          v.push(Number.isNaN(f.hz) ? NaN : stToChao(hzToSt(f.hz), range))
        },
      })
      raf = requestAnimationFrame(tick)
      const samples = await recording.current.done
      cancelAnimationFrame(raf)
      setLive(null)
      const a = analyzeAttempt(samples, item, range, refRange)
      setAttempt(a)
      if (a.result.score !== null) {
        recordScore(item.id, a.result.score)
        setProgressTick((x) => x + 1)
      }
    } catch (e) {
      cancelAnimationFrame(raf)
      setLive(null)
      setError(micError(e))
    } finally {
      recording.current = null
      setPhase('idle')
    }
  }

  const listen = async (rate = 1) => {
    if (!item) return
    if (phase === 'recording') return
    setPhase('listening')
    try {
      await playUrl(audioUrl(item), rate)
    } catch (e) {
      setError(String(e))
    }
    setPhase('idle')
    if (autoRecord && rate === 1) void record()
  }

  const playBoth = async () => {
    if (!item || !attempt) return
    setPhase('listening')
    await playUrl(audioUrl(item)).catch(() => {})
    await new Promise((r) => setTimeout(r, 250))
    await playUrl(attempt.wav).catch(() => {})
    setPhase('idle')
  }

  if (error)
    return (
      <div className="card error">
        <p>{error}</p>
        <button onClick={() => setError(null)}>OK</button>
      </div>
    )
  if (!manifest || !item || !refRange) return <div className="card">Loading word bank…</div>

  const refLine = refPlotLine(item, refRange)
  const refDuration = item.ref.st.length * item.ref.hop
  const preLabels: PlotLabel[] = item.ref.segments.map((s, i) => ({
    t: ((s[0] + s[1]) / 2) * item.ref.hop,
    text: showPinyin ? marked(item.syllables, item.surface)[i] : toneName(item.surface[i]),
    tone: item.surface[i],
  }))
  const sandhi = item.surface.some((t, i) => t !== item.lexical[i])

  let plot
  if (live) {
    const firstVoiced = live.v.findIndex((x) => !Number.isNaN(x))
    const shift = firstVoiced >= 0 ? live.t[firstVoiced] - item.ref.segments[0][0] * item.ref.hop : 0.3
    const ghost = { ...refLine, t: Array.from(refLine.t, (x) => x + shift) }
    const duration = Math.max(refDuration + 0.8, (live.t.at(-1) ?? 0) + 0.3)
    plot = <PitchPlot lines={[ghost, { t: live.t, v: live.v, kind: 'live' }]} duration={duration} />
  } else if (attempt) {
    plot = <PitchPlot lines={attempt.lines} duration={attempt.duration} labels={attempt.labels} boundaries={attempt.boundaries} />
  } else {
    plot = <PitchPlot lines={[refLine]} duration={refDuration} labels={preLabels} boundaries={item.ref.segments.slice(1).map((s) => s[0] * item.ref.hop)} />
  }

  return (
    <div className="page">
      {!calibrated && (
        <div className="banner">
          Using a default voice range. <button className="link" onClick={onCalibrate}>Calibrate</button> for accurate heights.
        </div>
      )}

      <ComboPicker items={manifest.items} kind={kind} combo={combo} scores={scores} onChange={choose} />

      <section className="card item-card">
        <div className="item-head">
          <div>
            <div className="hanzi">{item.hanzi}</div>
            <div className="pinyin">
              {showPinyin ? (
                marked(item.syllables, item.surface).map((s, i) => (
                  <span key={i} className={`t${item.surface[i]}`}>{s} </span>
                ))
              ) : (
                <span className="muted">pinyin hidden</span>
              )}
            </div>
            {sandhi && showPinyin && (
              <div className="muted small">
                sandhi: {marked(item.syllables, item.lexical).join(' ')} → {marked(item.syllables, item.surface).join(' ')}
              </div>
            )}
          </div>
          {attempt && <div className={`big-score ${scoreClass(attempt.result.score)}`}>{attempt.result.score ?? '–'}</div>}
        </div>

        {plot}
        <div className="legend">
          <span className="key ref" /> native <span className="key user" /> you
          {hum && <span className="muted"> · hum the melody, no words</span>}
        </div>

        <div className="controls">
          <button onClick={() => listen(1)} disabled={phase !== 'idle'}>▶ Listen</button>
          <button onClick={() => listen(0.6)} disabled={phase !== 'idle'}>🐢 Slow</button>
          {phase === 'recording' ? (
            <button className="primary recording" onClick={() => recording.current?.stop()}>■ Stop</button>
          ) : (
            <button className="primary" onClick={record} disabled={phase !== 'idle'}>● Record</button>
          )}
          <button onClick={() => attempt && playUrl(attempt.wav)} disabled={!attempt || phase !== 'idle'}>▶ Me</button>
          <button onClick={playBoth} disabled={!attempt || phase !== 'idle'}>⇄ Both</button>
          <button onClick={() => pickItem(kind, combo, item)} disabled={phase === 'recording'}>Next →</button>
        </div>
      </section>

      {attempt && <Feedback attempt={attempt} item={item} />}

      <details className="card settings">
        <summary>Drill settings</summary>
        <Toggle label="Show pinyin" value={showPinyin} onChange={(v) => { setShowPinyin(v); setPref('drill.pinyin', v) }} />
        <Toggle label="Start recording after Listen" value={autoRecord} onChange={(v) => { setAutoRecord(v); setPref('drill.autoRecord', v) }} />
        <Toggle label="Smooth consonants only (m n l r w y)" value={smoothOnly} onChange={(v) => { setSmoothOnly(v); setPref('drill.smooth', v) }} />
        <Toggle label="Hum-back mode" value={hum} onChange={(v) => { setHum(v); setPref('drill.hum', v) }} />
      </details>
    </div>
  )
}

function Feedback({ attempt, item }: { attempt: Attempt; item: BankItem }) {
  const { result } = attempt
  return (
    <section className="card">
      <ul className="syllables">
        {result.syllables.map((s, i) => (
          <li key={i}>
            <span className={`syl t${s.expected}`}>{marked(item.syllables, item.surface)[i]}</span>
            <span className={`pill ${scoreClass(s.score)}`}>{s.score ?? '–'}</span>
            {s.recognized && (
              <span className={s.recognized.tone === s.expected ? 'muted small' : 'bad small'}>
                heard {toneName(s.recognized.tone)} ({Math.round(s.recognized.confidence * 100)}%)
              </span>
            )}
            {s.notes.length > 0 && <div className="small notes">{s.notes.join(' · ')}</div>}
          </li>
        ))}
      </ul>
      {result.notes.map((n) => (
        <p key={n} className="small">{n}</p>
      ))}
    </section>
  )
}

function refPlotLine(item: BankItem, range: SpeakerRange): PlotLine {
  const chao = refChao(item, range)
  return { t: Array.from(chao, (_, i) => i * item.ref.hop), v: chao, kind: 'ref' }
}

function analyzeAttempt(samples: Float32Array, item: BankItem, range: SpeakerRange, refRange: SpeakerRange): Attempt {
  const wav = wavUrl(samples)
  const track = trackPitch(samples)
  const n = item.lexical.length
  const seg = segmentSyllables(track, n)
  const empty: DrillResult = { score: null, syllables: [], rangeRatio: null, notes: [] }
  if (!seg) {
    const chao = chaoTrack(track, range)
    return {
      result: { ...empty, notes: [`Couldn't find ${n} syllable${n > 1 ? 's' : ''} with clear pitch — try again a little louder, closer to the mic.`] },
      lines: [{ t: Array.from(chao, (_, i) => i * track.hop), v: chao, kind: 'user' }],
      labels: [],
      boundaries: [],
      duration: chao.length * track.hop,
      wav,
    }
  }
  const chao = chaoTrack(track, range)
  const ref = refChao(item, refRange)
  const result = compareToReference({ chao, segments: seg.segments }, { chao: ref, segments: item.ref.segments }, item.surface)

  const from = Math.max(0, seg.segments[0][0] - 10)
  const to = Math.min(chao.length, seg.segments[n - 1][1] + 10)
  const hop = track.hop
  const userLine: PlotLine = {
    t: Array.from({ length: to - from }, (_, i) => i * hop),
    v: chao.subarray(from, to),
    kind: 'user',
  }
  const refT: number[] = []
  const refV: number[] = []
  item.ref.segments.forEach((rs: Segment, k) => {
    const us = seg.segments[k]
    for (let i = rs[0]; i < rs[1]; i++) {
      refT.push((us[0] - from + ((i - rs[0]) / (rs[1] - rs[0])) * (us[1] - us[0])) * hop)
      refV.push(ref[i])
    }
    refT.push(NaN)
    refV.push(NaN)
  })
  const surface = marked(item.syllables, item.surface)
  const labels: PlotLabel[] = seg.segments.map((s, i) => {
    const r = result.syllables[i]
    return {
      t: ((s[0] + s[1]) / 2 - from) * hop,
      text: surface[i],
      tone: item.surface[i],
      sub: r.recognized ? `heard ${r.recognized.tone}` : undefined,
      ok: r.recognized ? r.recognized.tone === item.surface[i] : undefined,
    }
  })
  return {
    result,
    lines: [{ t: refT, v: refV, kind: 'ref' }, userLine],
    labels,
    boundaries: seg.segments.slice(1).map((s) => (s[0] - from) * hop),
    duration: (to - from) * hop,
    wav,
  }
}

function pickWeakCombo(pool: BankItem[], scores: Map<string, number>): string {
  const combos = [...new Set(pool.map((i) => i.combo))]
  // Unpractised combos count as weak; weight grows with the gap to 100.
  const weights = combos.map((c) => (100 - (scores.get(c) ?? 40)) ** 2 + 1)
  let r = Math.random() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < combos.length; i++) {
    r -= weights[i]
    if (r <= 0) return combos[i]
  }
  return combos[0]
}
