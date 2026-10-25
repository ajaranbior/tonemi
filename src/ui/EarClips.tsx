import { pinyin as toPinyin } from 'pinyin-pro'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chaoTrack, rangeFromSemitones } from '../analysis/normalize'
import { hzToSt, type PitchTrack } from '../analysis/pitch'
import { segmentSyllables, type Segment } from '../analysis/segment'
import type { Tone } from '../analysis/tones'
import { trackInWorker } from '../analysis/trackInWorker'
import { audioContext } from '../audio/context'
import { decodeTo16k } from '../audio/resample'
import { playSpan, stopSpan } from '../audio/span'
import { buildClips, cueCharTimes, frameTime, hanIndex } from '../ear/chunks'
import { clearRetry, dueRetry, grade, pickByCombo, scheduleRetry, updateStat, type Retry } from '../ear/adapt'
import { sentenceTones } from '../g2p/tones'
import { markedSyllable } from './tone'
import { overrule, type TrialRecord } from '../ear/overrule'
import { addEarConfusion, getEarCombos, getPref, setEarCombo, setPref } from '../store'
import { parseSubtitles, type Cue } from '../subtitles'
import { Toggle } from './Toggle'
import { PitchPlot, type PlotLine } from './PitchPlot'
import { answerOverlay } from './earPlot'
import { AnswerPreview } from './AnswerPreview'
import { ResultBanner, ToneAnswer, Verdict } from './ToneAnswer'
import { useReview } from './useReview'
import { FEEDBACK_SECONDS, playFeedback } from '../audio/sfx'

interface Clip {
  id: string
  cue: number
  /** Code-point range inside the cue text. */
  from: number
  to: number
  hanzi: string
  /** Han-character range inside the cue ("which character number"). */
  h0: number
  h1: number
  tones: Tone[]
  lexical: Tone[]
  pinyin: string[]
  /** Toneless syllables. */
  syllables: string[]
  key: string
}

const SIZES: [number, string][] = [[1, '1 word'], [2, '2 words'], [3, '3 words'], [0, 'Phrase']]
const PAD_BEFORE = 0.06
const PAD_AFTER = 0.1

interface Props {
  onAnswered: (correct: boolean) => void
  onOverride: (delta: 1 | -1) => void
}

export default function EarClips({ onAnswered, onOverride }: Props) {
  const [media, setMedia] = useState<{ url: string; video: boolean; name: string } | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [subName, setSubName] = useState<string | null>(null)
  const [native, setNative] = useState<PitchTrack | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [words, setWords] = useState(() => getPref<string>('ear.words', '2'))
  const [showVideo, setShowVideo] = useState(() => getPref<boolean>('ear.video', false))
  const [clip, setClip] = useState<Clip | null>(null)
  const [chosen, setChosen] = useState<(Tone | null)[]>([])
  const [answered, setAnswered] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<number | undefined>()
  const [accepted, setAccepted] = useState(false)
  const lastRec = useRef<TrialRecord | null>(null)
  const [sound, setSound] = useState(() => getPref<boolean>('ear.sound', true))
  const [autoReveal, setAutoReveal] = useState(() => getPref<boolean>('ear.auto', true))
  const review = useReview<Clip>()
  const mediaEl = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const playToken = useRef(0)
  const trial = useRef(0)
  const retry = useRef<Retry[]>([])
  const autoplay = useRef(false)

  const loadFiles = async (files: FileList | null) => {
    if (!files) return
    setError(null)
    for (const file of Array.from(files)) {
      if (/\.(srt|vtt)$/i.test(file.name) || file.type === 'text/vtt') await loadSubs(file)
      else await loadMedia(file)
    }
  }

  const loadSubs = async (file: File) => {
    const parsed = parseSubtitles(await file.text())
    if (!parsed.length) {
      setError('No cues found in that subtitle file (expected .srt or .vtt).')
      return
    }
    setCues(parsed)
    setSubName(file.name)
    setClip(null)
  }

  const loadMedia = async (file: File) => {
    setNative(null)
    setClip(null)
    stopSpan(mediaEl.current)
    if (media) URL.revokeObjectURL(media.url)
    setMedia({ url: URL.createObjectURL(file), video: file.type.startsWith('video'), name: file.name })
    try {
      setStatus('Decoding audio…')
      const samples = await decodeTo16k(audioContext(), await file.arrayBuffer())
      setStatus('Analysing pitch…')
      setNative(await trackInWorker(samples))
      setStatus(null)
    } catch (e) {
      setStatus(null)
      setError(`Could not decode this file (${String(e)}). Try an mp3/m4a/mp4/webm.`)
    }
  }

  // Cues worth training on: has Chinese, long enough, not a rolling-caption duplicate.
  const usable = useMemo(() => {
    const out: { cue: Cue; index: number }[] = []
    cues.forEach((cue, index) => {
      if (cue.end - cue.start < 0.4 || !/\p{Script=Han}/u.test(cue.text)) return
      if (out.length && out[out.length - 1].cue.text === cue.text) return
      out.push({ cue, index })
    })
    return out
  }, [cues])

  const clips = useMemo<Clip[]>(() => {
    const n = Number(words)
    const out: Clip[] = []
    for (const { cue, index } of usable) {
      const { chars, tones, lexical } = sentenceTones(cue.text)
      const han = hanIndex(cue.text)
      const syl = toPinyin(cue.text, { toneType: 'none', type: 'array', v: true, nonZh: 'removed' })
      for (const r of buildClips(cue.text, n)) {
        const h0 = han[r.from]
        const h1 = han[r.to - 1]
        const t = tones.slice(r.from, r.to)
        if (t.some((x) => x === null)) continue
        const tt = t as Tone[]
        out.push({
          id: `${index}:${r.from}-${r.to}`,
          cue: index,
          from: r.from,
          to: r.to,
          hanzi: chars.slice(r.from, r.to).join(''),
          h0,
          h1,
          tones: tt,
          lexical: lexical.slice(r.from, r.to) as Tone[],
          pinyin: tt.map((tone, i) => markedSyllable((syl[h0 + i] ?? '').replace(/v/g, 'ü'), tone)),
          syllables: tt.map((_, i) => (syl[h0 + i] ?? '').replace(/ü/g, 'v')),
          key: tt.join(''),
        })
      }
    }
    return out
  }, [usable, words])

  // Speaker range and Chao track from the voiced speech inside the cues.
  const ready = useMemo(() => {
    if (!native) return null
    const st: number[] = []
    const within = (i: number) => !cues.length || cues.some((c) => i * native.hop >= c.start && i * native.hop <= c.end)
    native.hz.forEach((hz, i) => !Number.isNaN(hz) && within(i) && st.push(hzToSt(hz)))
    const range = rangeFromSemitones(st)
    return range ? { track: native, range, chao: chaoTrack(native, range) } : null
  }, [native, cues])

  const next = useCallback(
    (avoid?: Clip | null, play = true) => {
      if (!clips.length) return
      const byId = new Map(clips.map((c) => [c.id, c]))
      const due = dueRetry(retry.current, trial.current, (id) => byId.has(id) && id !== avoid?.id)
      let pick = due ? byId.get(due) : undefined
      if (!pick) {
        const pool = clips.length > 1 && avoid ? clips.filter((c) => c.id !== avoid.id) : clips
        pick = pickByCombo(pool, (c) => c.key, getEarCombos())
      }
      if (!pick) return
      if (clip && answered) review.record({ item: clip, chosen, accepted, rec: lastRec.current ?? undefined })
      review.leave()
      setAccepted(false)
      lastRec.current = null
      autoplay.current = play
      setClip(pick)
      setChosen(pick.tones.map(() => null))
      setAnswered(false)
    },
    [clips, clip, chosen, answered, accepted, review.record, review.leave],
  )

  useEffect(() => {
    if (ready && clips.length && (!clip || !byIdHas(clips, clip))) next(null, false)
  }, [ready, clips, clip, next])

  /** [start, end] seconds of a clip, from the estimated character timing. */
  const span = useCallback(
    (c: Clip): [number, number] | null => {
      if (!ready) return null
      const cue = cues[c.cue]
      const hop = ready.track.hop
      const ct = cueCharTimes(ready.track, c.cue, Math.floor(cue.start / hop), Math.ceil(cue.end / hop), cue.text)
      if (!ct) return [cue.start, cue.end]
      return [Math.max(cue.start - 0.1, frameTime(ct.start[c.h0]) - PAD_BEFORE), Math.min(cue.end + 0.1, frameTime(ct.end[c.h1]) + PAD_AFTER)]
    },
    [ready, cues],
  )

  const play = useCallback(
    async (c: Clip | null, rate = 1, whole = false) => {
      const el = mediaEl.current
      if (!c || !el) return
      const s = whole ? ([cues[c.cue].start, cues[c.cue].end] as [number, number]) : span(c)
      if (!s) return
      const mine = ++playToken.current
      setPlaying(true)
      try {
        await playSpan(el, s[0], s[1], rate, (t) => setCursor(Number.isNaN(t) ? undefined : t))
      } catch (e) {
        setError(String(e))
      }
      if (mine === playToken.current) setPlaying(false)
    },
    [cues, span],
  )

  useEffect(() => {
    if (clip && autoplay.current) {
      autoplay.current = false
      void play(clip)
    }
  }, [clip, play])
  useEffect(() => () => stopSpan(mediaEl.current), [])

  const check = useCallback((answers: (Tone | null)[] = chosen) => {
    if (!clip || answered || answers.some((c) => c === null)) return
    const g = grade(clip.tones, answers)
    const conf = clip.tones.flatMap((t, i) => (g.correct[i] ? [] : [`${t}>${answers[i]}`]))
    lastRec.current = { key: clip.key, conf }
    setEarCombo(clip.key, updateStat(getEarCombos()[clip.key], g.all))
    conf.forEach(addEarConfusion)
    trial.current++
    retry.current = g.all ? clearRetry(retry.current, clip.id) : scheduleRetry(retry.current, clip.id, trial.current)
    setAnswered(true)
    onAnswered(g.all)
    if (sound) playFeedback(g.all)
    if (!g.all) setTimeout(() => void play(clip), sound ? FEEDBACK_SECONDS * 1000 : 0)
  }, [clip, answered, chosen, onAnswered, play, sound])

  const rv = review.reviewing
  const sClip = rv ? rv.item : clip
  const sChosen = rv ? rv.chosen : chosen
  const sAnswered = rv ? true : answered
  const wrong = !!sClip && sAnswered && !grade(sClip.tones, sChosen).all

  /** The learner disagrees with the answer key (or takes that back): flip this trial's result. */
  const toggleAccept = useCallback(() => {
    if (rv && review.index !== null) {
      if (!rv.rec) return
      const key = rv.rec.key
      const later = review.history.slice(review.index + 1).filter((t) => t.rec?.key === key).length + (answered && lastRec.current?.key === key ? 1 : 0)
      const now = !rv.accepted
      overrule(rv.rec, later, now)
      review.update(review.index, { accepted: now })
      if (now) retry.current = clearRetry(retry.current, rv.item.id)
      onOverride(now ? 1 : -1)
    } else {
      const rec = lastRec.current
      if (!clip || !answered || !rec) return
      const now = !accepted
      overrule(rec, 0, now)
      if (now) retry.current = clearRetry(retry.current, clip.id)
      setAccepted(now)
      onOverride(now ? 1 : -1)
    }
  }, [rv, review, clip, answered, accepted, onOverride])

  /** Backspace: take back the last tone entered. */
  const undo = useCallback(() => {
    if (answered) return
    setChosen((c) => {
      const last = c.map((x) => x !== null).lastIndexOf(true)
      return last < 0 ? c : c.map((x, i) => (i === last ? null : x))
    })
  }, [answered])

  const pick = useCallback(
    (index: number, tone: Tone) => {
      if (answered) return
      const next = chosen.map((x, i) => (i === index ? (x === tone ? null : tone) : x))
      setChosen(next)
      if (autoReveal && next.every((c) => c !== null)) check(next)
    },
    [answered, chosen, autoReveal, check],
  )

  const advance = useCallback(() => {
    if (rv) review.forward()
    else next(clip)
  }, [rv, review, next, clip])

  // Keys: digits fill the next empty syllable, Enter checks/continues, Space or R replays,
  // ← goes back to the previous clip, → forward / next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !clip) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (sAnswered) advance()
        else if (!autoReveal) check()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        review.back()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (sAnswered) advance()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        undo()
      } else if ((e.key === 'm' || e.key === 'M') && wrong) {
        toggleAccept()
      } else if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (!e.repeat) void play(sClip)
      } else if (!sAnswered && /^[0-5]$/.test(e.key)) {
        const i = chosen.findIndex((c) => c === null)
        if (i >= 0 && !(i === 0 && (e.key === '0' || e.key === '5'))) pick(i, (e.key === '5' ? 0 : Number(e.key)) as Tone)
      }
    }
    // A focused button would otherwise "click" on Space release.
    const onUp = (e: KeyboardEvent) => e.key === ' ' && e.preventDefault()
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [clip, sClip, sAnswered, chosen, advance, check, play, pick, review, autoReveal, undo, toggleAccept, wrong])

  const complete = chosen.length > 0 && chosen.every((c) => c !== null)
  const g = sClip && sAnswered ? grade(sClip.tones, sChosen) : null

  return (
    <>
      <section className="card">
        <h2>Train on a video</h2>
        <label className="file">
          <input type="file" multiple accept="audio/*,video/*,.srt,.vtt,text/vtt" onChange={(e) => { void loadFiles(e.target.files); e.target.value = '' }} />
          <span>📂 Choose audio/video + subtitles</span>
        </label>
        <p className="muted small">
          Select the media file and the .srt/.vtt together (or one after the other).
        </p>
        <p className="muted small">
          {media ? `🎬 ${media.name}` : 'No audio/video yet'} · {subName ? `💬 ${subName} (${usable.length} lines)` : 'no subtitles yet'}
        </p>
        {status && <p className="muted small">{status}</p>}
        {error && <p className="bad small">{error}</p>}
        <YoutubeHelp />
        {media &&
          (media.video ? (
            <video ref={mediaEl} src={media.url} playsInline className="media" hidden={!showVideo} />
          ) : (
            <audio ref={mediaEl} src={media.url} />
          ))}
      </section>

      {media && cues.length > 0 && !ready && !status && !error && <div className="card">Waiting for pitch analysis…</div>}

      {ready && sClip && (
        <>
          
          <section className={`card ${g ? (g.all || (rv ? !!rv.accepted : accepted) ? 'flash-ok' : 'flash-bad') : ''}`}>
            {g && <ResultBanner key={sClip.id + sChosen.join('') + String((rv ? !!rv.accepted : accepted))} grade={g} accepted={(rv ? !!rv.accepted : accepted)} />}
            <div className="item-head">
              <div>
                {sAnswered ? (
                  <>
                    <div className="hanzi">{sClip.hanzi}</div>
                    <div className="pinyin">
                      {sClip.pinyin.map((s, i) => (
                        <span key={i} className={`t${sClip.tones[i]}`}>{s} </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="hanzi muted" aria-label="Clip text hidden">？</div>
                )}
              </div>
            </div>

            {sAnswered && g && <ClipChart clip={sClip} chosen={sChosen} ready={ready} span={span(sClip)} cursor={cursor} />}
            {g && !g.all && <p className="muted small">Grey is what was said; blue is the tone you picked. Space replays it; the line follows the audio.</p>}

            <div className="controls ear-controls">
              <button className="primary" onClick={() => play(sClip)} disabled={playing}>▶ Clip</button>
              <button onClick={() => play(sClip, 0.6)} disabled={playing}>🐢 Slow</button>
              <button onClick={() => play(sClip, 1, true)} disabled={playing}>▶ Line</button>
            </div>

            <h3 className="ear-q">{sAnswered ? 'Answer' : `Tones of the ${sClip.tones.length} syllable${sClip.tones.length > 1 ? 's' : ''}?`}</h3>
            <ToneAnswer chosen={sChosen} expected={sAnswered ? sClip.tones : undefined} onPick={pick} />
            <div className="nav-row">
              <button onClick={review.back} disabled={!review.canBack}>← Back</button>
              {!sAnswered && !autoReveal ? (
                <button className="primary" onClick={() => check()} disabled={!complete}>Check</button>
              ) : (
                <button className="primary" onClick={advance} disabled={!sAnswered}>Next →</button>
              )}
            </div>
            {g && !g.all && (
              <button className="link small" onClick={toggleAccept}>{(rv ? !!rv.accepted : accepted) ? 'Undo: count this as incorrect again (M)' : 'I was right — mark my answer as correct (M)'}</button>
            )}
            {!sAnswered && <button className="link small" onClick={() => next(clip)}>Skip (clip cut badly / audio unclear)</button>}
          </section>

          {sAnswered && g && (
            <section className="card">
              <Verdict syllables={sClip.pinyin} expected={sClip.tones} lexical={sClip.lexical} chosen={sChosen} />
              {!g.all && !(rv ? !!rv.accepted : accepted) && <AnswerPreview key={sClip.id + sChosen.join('')} chosen={sChosen as Tone[]} syllables={sClip.syllables} />}
              <p className="muted small">Line: {cues[sClip.cue].text}</p>
              <p className="muted small">Answers are generated from the subtitle text, so rare readings can be wrong, and clip edges are estimated.</p>
            </section>
          )}

          <div className="options">
<p className="muted small">Clip size</p>
<div className="segmented compact" role="tablist" aria-label="Clip size">
            {SIZES.map(([n, label]) => (
              <button
                key={n}
                role="tab"
                aria-selected={words === String(n)}
                className={words === String(n) ? 'active' : ''}
                onClick={() => { setWords(String(n)); setPref('ear.words', String(n)); setClip(null) }}
              >
                {label}
              </button>
            ))}
          </div>

</div>
<details className="card settings">
            <summary>Video settings</summary>
            <Toggle label="Sound effects and vibration for right/wrong" value={sound} onChange={(v) => { setSound(v); setPref('ear.sound', v) }} />
            <Toggle label="Reveal the answer as soon as all tones are chosen" value={autoReveal} onChange={(v) => { setAutoReveal(v); setPref('ear.auto', v) }} />
            {media?.video && <Toggle label="Show video (may reveal burned-in subtitles)" value={showVideo} onChange={(v) => { setShowVideo(v); setPref('ear.video', v) }} />}
            <p className="muted small">Pitch range is estimated from the speech in the subtitled lines; background music or several speakers make the chart less accurate.</p>
          </details>
        </>
      )}
    </>
  )
}

const byIdHas = (clips: Clip[], c: Clip) => clips.some((x) => x.id === c.id)

function ClipChart({ clip, chosen, ready, span, cursor }: { clip: Clip; chosen: (Tone | null)[]; ready: { track: PitchTrack; chao: Float32Array }; span: [number, number] | null; cursor?: number }) {
  const { track, chao } = ready
  const hop = track.hop
  const view = useMemo(() => {
    if (!span) return null
    const a = Math.max(0, Math.floor((span[0] + PAD_BEFORE - 0.032) / hop))
    const b = Math.min(chao.length, Math.ceil((span[1] - PAD_AFTER - 0.032) / hop))
    if (b - a < 6) return null
    const from = Math.max(0, a - 10)
    const to = Math.min(chao.length, b + 10)
    const slice: PitchTrack = {
      hop,
      hz: track.hz.subarray(a, b),
      rms: track.rms.subarray(a, b),
      zcr: track.zcr.subarray(a, b),
      creak: track.creak.subarray(a, b),
    }
    const n = clip.tones.length
    const seg = segmentSyllables(slice, n)
    const segments: Segment[] = seg
      ? seg.segments.map(([s, e]) => [s + a, e + a])
      : Array.from({ length: n }, (_, i) => [Math.round(a + ((b - a) * i) / n), Math.round(a + ((b - a) * (i + 1)) / n)] as Segment)
    return { from, to, segments }
  }, [span, track, chao, hop, clip.tones.length])

  if (!view) return <p className="muted small">Not enough voiced speech in this clip to draw a chart.</p>
  const { from, to, segments } = view
  const { labels, guess, boundaries } = answerOverlay(segments, clip.tones, chosen, clip.pinyin, hop, from, chao)
  const lines: PlotLine[] = [
    { t: Array.from({ length: to - from }, (_, i) => i * hop), v: chao.subarray(from, to), kind: 'ref' },
  ]
  if (guess) lines.push(guess)
  const playhead = cursor !== undefined && span ? cursor - from * hop - 0.032 : undefined
  return (
    <>
      <PitchPlot lines={lines} duration={(to - from) * hop} labels={labels} boundaries={boundaries} cursor={playhead} />
      <div className="legend">
        <span className="key ref" /> speaker
        {guess && (
          <>
            <span className="key user" /> shape of the tone you picked
          </>
        )}
      </div>
    </>
  )
}

function YoutubeHelp() {
  const [url, setUrl] = useState('')
  const cmd = `yt-dlp -x --audio-format mp3 --write-subs --write-auto-subs --sub-langs "zh-Hans,zh-Hant,zh.*" --convert-subs srt ${url.trim() ? JSON.stringify(url.trim()) : '<URL>'}`
  return (
    <details className="settings">
      <summary>Have a YouTube link?</summary>
      <p className="muted small">
        Browsers can't download YouTube audio, so fetch the audio and subtitles once on your computer, then pick both files above.
        Nothing is uploaded; everything stays on this device.
      </p>
      <input className="text-input" type="url" placeholder="Paste a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} />
      <code className="cmd">{cmd}</code>
      <button onClick={() => navigator.clipboard?.writeText(cmd).catch(() => {})}>Copy command</button>
    </details>
  )
}
