import { useEffect, useMemo, useRef, useState } from 'react'
import { chaoTrack, rangeFromSemitones, type SpeakerRange } from '../analysis/normalize'
import { hzToSt, trackPitch, type PitchTrack } from '../analysis/pitch'
import { trackInWorker } from '../analysis/trackInWorker'
import { compareLine, voicedSeq, type ShadowResult } from '../analysis/shadow'
import { audioContext } from '../audio/context'
import { playUrl, stopPlayback, wavUrl } from '../audio/playback'
import { startRecording, type Recording } from '../audio/recorder'
import { decodeTo16k } from '../audio/resample'
import { markTone, sentenceTones } from '../g2p/tones'
import { pinyin } from 'pinyin-pro'
import { parseSubtitles, type Cue } from '../subtitles'
import { micError } from './errors'
import { Toggle } from './Toggle'
import { PitchPlot, type PlotLine } from './PitchPlot'
import { scoreClass } from './tone'

interface LineAttempt {
  result: ShadowResult | null
  wav: string
}

type Phase = 'idle' | 'playing' | 'recording'

export default function ShadowPage({ range }: { range: SpeakerRange }) {
  const [media, setMedia] = useState<{ url: string; video: boolean; name: string } | null>(null)
  const [cues, setCues] = useState<Cue[]>([])
  const [subName, setSubName] = useState<string | null>(null)
  const [native, setNative] = useState<PitchTrack | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [attempts, setAttempts] = useState<Record<number, LineAttempt>>({})
  const [phase, setPhase] = useState<Phase>('idle')
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [showPinyin, setShowPinyin] = useState(true)
  const [cursor, setCursor] = useState<number | undefined>()
  const mediaEl = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const rec = useRef<Recording | null>(null)
  const stopLoop = useRef(false)

  // Native pitch track over the whole file, in a worker; range from voiced speech inside cues.
  const loadMedia = async (file: File) => {
    setError(null)
    setNative(null)
    setAttempts({})
    if (media) URL.revokeObjectURL(media.url)
    setMedia({ url: URL.createObjectURL(file), video: file.type.startsWith('video'), name: file.name })
    try {
      setStatus('Decoding audio…')
      const samples = await decodeTo16k(audioContext(), await file.arrayBuffer())
      setStatus('Analysing pitch…')
      const track = await trackInWorker(samples)
      setNative(track)
      setStatus(null)
    } catch (e) {
      setStatus(null)
      setError(`Could not decode this file (${String(e)}). Try an mp3/m4a/mp4/webm.`)
    }
  }

  // (Re)compute range + Chao track when the track or cues change.
  const nativeReady = useMemo(() => {
    if (!native) return null
    const track = native
    const st: number[] = []
    const within = (i: number) => !cues.length || cues.some((c) => i * track.hop >= c.start && i * track.hop <= c.end)
    track.hz.forEach((hz, i) => {
      if (!Number.isNaN(hz) && within(i)) st.push(hzToSt(hz))
    })
    const r = rangeFromSemitones(st)
    if (!r) return null
    return { track, range: r, chao: chaoTrack(track, r) }
  }, [native, cues])

  const loadSubs = async (file: File) => {
    const parsed = parseSubtitles(await file.text())
    if (!parsed.length) {
      setError('No cues found in that subtitle file (expected .srt or .vtt).')
      return
    }
    setCues(parsed)
    setSubName(file.name)
    setIndex(0)
    setAttempts({})
  }

  useEffect(() => () => stopPlayback(), [])

  const cue = cues[index]

  const playCue = async (c: Cue) => {
    const el = mediaEl.current
    if (!el) return
    el.currentTime = c.start
    el.playbackRate = rate
    el.preservesPitch = true
    await el.play()
    await new Promise<void>((resolve) => {
      const check = () => {
        if (el.paused || el.currentTime >= c.end) {
          el.pause()
          setCursor(undefined)
          resolve()
        } else {
          setCursor(el.currentTime - c.start)
          requestAnimationFrame(check)
        }
      }
      check()
    })
  }

  const play = async () => {
    if (!cue) return
    setPhase('playing')
    stopLoop.current = false
    do {
      await playCue(cue)
      if (loop) await new Promise((r) => setTimeout(r, 600))
    } while (loop && !stopLoop.current)
    setPhase('idle')
  }

  const stop = () => {
    stopLoop.current = true
    mediaEl.current?.pause()
    rec.current?.stop()
  }

  /** mode "echo": play, then record. mode "shadow": record while playing. */
  const practise = async (mode: 'echo' | 'shadow') => {
    if (!cue || !nativeReady) return
    const dur = (cue.end - cue.start) / rate
    try {
      if (mode === 'echo') {
        setPhase('playing')
        await playCue(cue)
      }
      setPhase('recording')
      rec.current = await startRecording({
        maxSeconds: mode === 'echo' ? dur * 1.6 + 2 : dur + 1,
        silenceStop: mode === 'echo' ? 1 : 0,
        echoCancellation: mode === 'shadow',
      })
      if (mode === 'shadow') {
        setPhase('playing')
        await playCue(cue)
        setPhase('recording')
        setTimeout(() => rec.current?.stop(), 800)
      }
      const samples = await rec.current.done
      const track = trackPitch(samples)
      const user = voicedSeq(chaoTrack(track, range), track.hop)
      const from = Math.floor(cue.start / nativeReady.track.hop)
      const to = Math.ceil(cue.end / nativeReady.track.hop)
      const nat = voicedSeq(nativeReady.chao, nativeReady.track.hop, from, to)
      setAttempts((a) => ({ ...a, [index]: { result: compareLine(nat, user), wav: wavUrl(samples) } }))
    } catch (e) {
      setError(micError(e))
    } finally {
      rec.current = null
      setPhase('idle')
    }
  }

  const attempt = attempts[index]
  let plot = null
  if (cue && nativeReady) {
    const hop = nativeReady.track.hop
    const from = Math.floor(cue.start / hop)
    const to = Math.ceil(cue.end / hop)
    const lines: PlotLine[] = [
      {
        t: Array.from({ length: to - from }, (_, i) => i * hop),
        v: nativeReady.chao.subarray(from, to),
        kind: 'ref',
      },
    ]
    if (attempt?.result) lines.push({ ...attempt.result.warped, kind: 'user' })
    plot = <PitchPlot lines={lines} duration={cue.end - cue.start} cursor={cursor} />
  }

  return (
    <div className="page">
      <section className="card">
        <h2>Shadowing</h2>
        <div className="file-row">
          <label className="file">
            <input type="file" accept="audio/*,video/*" onChange={(e) => e.target.files?.[0] && loadMedia(e.target.files[0])} />
            <span>🎬 {media ? media.name : 'Choose audio/video'}</span>
          </label>
          <label className="file">
            <input type="file" accept=".srt,.vtt,text/vtt" onChange={(e) => e.target.files?.[0] && loadSubs(e.target.files[0])} />
            <span>💬 {subName ?? 'Choose subtitles (.srt / .vtt)'}</span>
          </label>
        </div>
        {status && <p className="muted small">{status}</p>}
        {error && <p className="bad small">{error}</p>}
        {!media && (
          <p className="muted small">
            Tip: for a YouTube video, download audio + Chinese subtitles locally, e.g.{' '}
            <code>yt-dlp -x --write-subs --sub-langs zh-Hans --convert-subs srt URL</code>. Nothing is uploaded — everything
            runs on this device.
          </p>
        )}
        {media &&
          (media.video ? (
            <video ref={mediaEl} src={media.url} playsInline className="media" />
          ) : (
            <audio ref={mediaEl} src={media.url} />
          ))}
      </section>

      {cue && (
        <section className="card">
          <div className="line-nav">
            <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0 || phase !== 'idle'}>‹</button>
            <span className="muted small">
              line {index + 1} / {cues.length}
            </span>
            <button onClick={() => setIndex(Math.min(cues.length - 1, index + 1))} disabled={index === cues.length - 1 || phase !== 'idle'}>›</button>
          </div>
          <CueText text={cue.text} showPinyin={showPinyin} />
          {plot ?? <p className="muted small">{media ? 'Waiting for pitch analysis…' : 'Load the matching audio/video.'}</p>}
          {plot && (
            <div className="legend">
              <span className="key ref" /> native <span className="key user" /> you (time-aligned)
            </div>
          )}
          <div className="controls">
            {phase === 'idle' ? (
              <button onClick={play} disabled={!media}>▶ Line</button>
            ) : (
              <button className={phase === 'recording' ? 'primary recording' : ''} onClick={stop}>■ Stop</button>
            )}
            <button className="primary" onClick={() => practise('echo')} disabled={!nativeReady || phase !== 'idle'}>● Echo</button>
            <button onClick={() => practise('shadow')} disabled={!nativeReady || phase !== 'idle'}>🎧 Shadow</button>
            <button onClick={() => attempt && playUrl(attempt.wav)} disabled={!attempt || phase !== 'idle'}>▶ Me</button>
            <button onClick={() => setRate(rate === 1 ? 0.75 : 1)} disabled={phase !== 'idle'}>{rate === 1 ? '1×' : '0.75×'}</button>
          </div>
          <div className="toggles">
            <Toggle label="Loop line" value={loop} onChange={setLoop} />
            <Toggle label="Pinyin" value={showPinyin} onChange={setShowPinyin} />
          </div>
          <p className="muted small">Echo: listen, then repeat. Shadow: speak along with the audio — use headphones.</p>
          {attempt && (
            <div className="result-row">
              {attempt.result ? (
                <>
                  <div className={`big-score ${scoreClass(attempt.result.score)}`}>{attempt.result.score}</div>
                  <div className="small">
                    {attempt.result.notes.length ? attempt.result.notes.map((n) => <p key={n}>{n}</p>) : <p>Melody matches well.</p>}
                  </div>
                </>
              ) : (
                <p className="small">Not enough voiced speech to compare — try again.</p>
              )}
            </div>
          )}
        </section>
      )}

      {cues.length > 0 && (
        <section className="card">
          <h3>Lines</h3>
          <ol className="cue-list">
            {cues.map((c, i) => (
              <li key={i}>
                <button className={i === index ? 'selected' : ''} onClick={() => phase === 'idle' && setIndex(i)}>
                  <span className="cue-text">{c.text}</span>
                  {attempts[i]?.result && <span className={`pill ${scoreClass(attempts[i].result!.score)}`}>{attempts[i].result!.score}</span>}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function CueText({ text, showPinyin }: { text: string; showPinyin: boolean }) {
  const { chars, tones, approximate } = useMemo(() => sentenceTones(text), [text])
  const syllables = useMemo(() => pinyin(text, { toneType: 'none', type: 'array', v: true, nonZh: 'removed' }), [text])
  let k = 0
  return (
    <div className="cue">
      <p className="cue-line">
        {chars.map((c, i) => {
          const t = tones[i]
          if (t === null) return <span key={i}>{c}</span>
          const syl = syllables[k++] ?? ''
          return showPinyin ? (
            <span key={i} className={`cc t${t}`}>
              <small>{markTone(syl.replace(/v/g, 'ü'), t)}</small>
              {c}
            </span>
          ) : (
            <span key={i} className={`t${t}`}>{c}</span>
          )
        })}
      </p>
      {showPinyin && approximate && <p className="muted small">3-3-3 sandhi shown approximately.</p>}
    </div>
  )
}
