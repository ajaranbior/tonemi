import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SR } from '../analysis/pitch'
import { stToChao } from '../analysis/normalize'
import type { Tone } from '../analysis/tones'
import { playUrl, stopPlayback, wavUrl } from '../audio/playback'
import { FRAME_CENTER, retone, targetContour, type Voice } from '../audio/retone'
import { synthTones } from '../audio/synth'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, Manifest } from '../bank/types'
import { pickVoice, usableItems } from '../bank/voices'
import { PitchPlot, type PlotLabel, type PlotLine } from './PitchPlot'
import { useSamples } from './useSamples'
import { marked } from './tone'

const same = (a: Tone[], b: Tone[]) => a.length === b.length && a.every((t, i) => t === b[i])

/** The asked recording, so it can be re-pitched to the learner's answer. */
export interface PreviewVoice extends Omit<Voice, 'samples'> {
  /** 16 kHz samples, or a URL to fetch them from. */
  samples?: Float32Array | null
  url?: string
  /** The tones actually spoken. */
  expected: Tone[]
}

interface Props {
  /** The tones the learner picked. */
  chosen: Tone[]
  /** Bank word to leave out (the one that was just played). */
  exclude?: string
  /** Toneless syllables of the word that was asked; recordings sharing them are preferred. */
  syllables?: string[]
  voice?: PreviewVoice
}

const plain = (s: string) => s.toLowerCase().replace(/ü/g, 'v')

type Mode = 'same' | 'other'

/**
 * "If it were 2-3, it would sound like this". Two ways to hear it: the very recording that was asked,
 * re-pitched to the tones picked (same voice, same word), or a real recording of another word with
 * that tone pattern (else a synthesized hum). Laid out to fill the ear stage; plays once when opened.
 */
export function AnswerPreview({ chosen, exclude, syllables, voice }: Props) {
  const [mode, setMode] = useState<Mode>(voice ? 'same' : 'other')
  useEffect(() => () => stopPlayback(), [])
  const switcher = voice ? (
    <div className="segmented compact preview-mode" role="tablist" aria-label="Preview source">
      {(
        [
          ['same', 'Same voice'],
          ['other', 'Other word'],
        ] as const
      ).map(([m, label]) => (
        <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => { stopPlayback(); setMode(m) }}>
          {label}
        </button>
      ))}
    </div>
  ) : null
  return mode === 'same' && voice ? (
    <SameVoice chosen={chosen} syllables={syllables} voice={voice} switcher={switcher} />
  ) : (
    <OtherWord chosen={chosen} exclude={exclude} syllables={syllables} switcher={switcher} />
  )
}

/** The asked recording itself, its pitch moved to the chosen tones (TD-PSOLA). */
function SameVoice({ chosen, syllables, voice, switcher }: { chosen: Tone[]; syllables?: string[]; voice: PreviewVoice; switcher: ReactNode }) {
  const fetched = useSamples(voice.samples ? null : (voice.url ?? null))
  const samples = voice.samples ?? fetched
  const [cursor, setCursor] = useState<number | undefined>()
  const [playing, setPlaying] = useState(false)
  const latest = useRef(0)

  const audio = useMemo(() => (samples ? retone({ ...voice, samples }, voice.expected, chosen) : null), [samples, voice, chosen])
  const url = useMemo(() => (audio && audio.length ? wavUrl(audio) : null), [audio])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const play = useCallback(
    async (rate = 1) => {
      if (!url) return
      const mine = ++latest.current
      setPlaying(true)
      try {
        await playUrl(url, rate, (t) => setCursor(Number.isNaN(t) ? undefined : t))
      } catch {
        // ignore: nothing useful to show for a failed preview
      }
      if (mine === latest.current) setPlaying(false)
    },
    [url],
  )
  const autoplayed = useRef(false)
  useEffect(() => {
    if (url && !autoplayed.current) {
      autoplayed.current = true
      void play()
    }
  }, [url, play])

  // Chart: what was said (blue) and the melody it was moved to (red), in the rendered clip's time.
  const chart = useMemo(() => {
    const { hop, range } = voice
    const from = voice.from ?? voice.t0
    const at = (f: number) => voice.t0 + FRAME_CENTER + f * hop - from
    const t = Array.from(voice.st, (_, f) => at(f))
    const orig = Float32Array.from(voice.st, (s) => (s === null || Number.isNaN(s) ? NaN : stToChao(s, range)))
    const goal = Float32Array.from(targetContour(voice, voice.expected, chosen), (s) => (Number.isNaN(s) ? NaN : stToChao(s, range)))
    const lines: PlotLine[] = [
      { t, v: orig, kind: 'ref' },
      { t, v: goal, kind: 'wrong' },
    ]
    const pinyin = syllables && syllables.length === chosen.length ? marked(syllables, chosen) : null
    const labels: PlotLabel[] = voice.segments.map(([s, e], i) => ({ t: at((s + e) / 2), text: pinyin?.[i] ?? String(chosen[i]), tone: chosen[i] }))
    const boundaries = voice.segments.slice(1).map(([s]) => at(s))
    return { lines, labels, boundaries }
  }, [voice, chosen, syllables])

  const label = chosen.join('-')
  const duration = audio ? audio.length / SR : 1
  return (
    <div className="stage-preview">
      <div className="preview-head">
        {switcher}
        <span className="preview-btns">
          <button className="primary" onClick={() => play(1)} disabled={playing || !url} aria-label={`Play this word as ${label}`}>▶</button>
          <button onClick={() => play(0.6)} disabled={playing || !url} aria-label="Play slowly" title="Slow">🐢</button>
        </span>
      </div>
      <div className="stage-plot">
        {samples && !url ? (
          <p className="muted small">Not enough voiced speech here to change the tones.</p>
        ) : (
          <PitchPlot lines={chart.lines} duration={duration} labels={chart.labels} boundaries={chart.boundaries} cursor={cursor} height="100%" scrub={{ samples: audio, offset: 0 }} />
        )}
      </div>
      <div className="legend">
        <span className="key ref" /> what was said <span className="key wrong" /> moved to your tones ({label})
        <span className="legend-hint">Same voice, pitch changed by the app: a guide, not a native recording</span>
      </div>
    </div>
  )
}

/** A real recording of another word with the chosen tones, else a synthesized hum. */
function OtherWord({ chosen, exclude, syllables, switcher }: { chosen: Tone[]; exclude?: string; syllables?: string[]; switcher: ReactNode }) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [round, setRound] = useState(0)
  const [cursor, setCursor] = useState<number | undefined>()
  const [playing, setPlaying] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    loadManifest().then(setManifest, () => {})
  }, [])

  // Recordings with the chosen tones, those sharing the most syllables with the asked word first.
  const matches = useMemo(() => {
    const asked = syllables?.map(plain) ?? []
    const shared = (i: BankItem) => i.syllables.filter((s, k) => plain(s) === asked[k]).length
    return (manifest ? usableItems(manifest) : [])
      .filter((i) => same(i.surface, chosen) && i.id !== exclude)
      .map((i) => ({ i, score: shared(i), r: Math.random() }))
      .sort((a, b) => b.score - a.score || a.r - b.r)
      .map((x) => x.i)
  }, [manifest, chosen, exclude, syllables])
  // Two 3rd tones in a row are never pronounced as 3-3 (the first becomes a 2nd tone), so there is no
  // recording of that surface pattern. Offer a word that is *written* with these tones instead.
  const written = useMemo(
    () => (matches.length ? [] : (manifest ? usableItems(manifest) : []).filter((i) => same(i.lexical, chosen) && i.id !== exclude)),
    [manifest, matches, chosen, exclude],
  )
  const pool = matches.length ? matches : written
  const word = pool.length ? pool[round % pool.length] : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const item: BankItem | null = useMemo(() => (word && manifest ? pickVoice(manifest, word) : null), [word, manifest, round])
  const isWritten = !matches.length && !!item
  const sharedCount = item && syllables ? item.syllables.filter((s, k) => plain(s) === plain(syllables[k] ?? '')).length : 0
  const range = manifest ? Object.values(manifest.speakers)[0].range : null

  const play = useCallback(async () => {
    if (!range) return
    const mine = ++latest.current
    setPlaying(true)
    try {
      if (item) await playUrl(audioUrl(item), 1, (t) => setCursor(Number.isNaN(t) ? undefined : t - item.ref.t0))
      else await playUrl(wavUrl(synthTones(chosen, range)))
    } catch {
      // ignore: nothing useful to show for a failed preview
    }
    if (mine === latest.current) setPlaying(false)
  }, [item, range, chosen])

  // Play as soon as the tab opens, and again for each "another".
  const autoplayed = useRef(-1)
  useEffect(() => {
    if (range && autoplayed.current !== round) {
      autoplayed.current = round
      void play()
    }
  }, [range, round, play])

  if (!manifest || !range) return null
  const label = chosen.join('-')
  const speaker = item ? manifest.speakers[item.speaker].range : range

  return (
    <div className="stage-preview">
      <div className="preview-head">
        {switcher}
        {item ? (
          <span className="preview-word">
            <span className="hanzi-sm">{item.hanzi}</span>{' '}
            <span className="pinyin">
              {marked(item.syllables, item.surface).map((s, i) => (
                <span key={i} className={`t${item.surface[i]}`}>{s} </span>
              ))}
            </span>
          </span>
        ) : (
          <span className="muted small">Synthesized hum of {label}</span>
        )}
        <span className="preview-btns">
          <button className="primary" onClick={play} disabled={playing} aria-label={`Play ${label}`}>▶</button>
          {pool.length > 1 && (
            <button onClick={() => setRound((r) => r + 1)} disabled={playing} aria-label={`Another ${label}`} title={`Another ${label}`}>↻</button>
          )}
        </span>
      </div>
      <div className="stage-plot">
        {item ? <PreviewChart item={item} range={speaker} cursor={cursor} /> : <p className="muted small">No recording has this exact pattern.</p>}
      </div>
      <div className="legend">
        {isWritten ? (
          <>Spoken 3-3 doesn't exist (the first 3 becomes 2); this word is <em>written</em> {label}.</>
        ) : (
          <>
            <span className="key wrong" /> a word with your tones ({label})
            {sharedCount > 0 && sharedCount === item?.syllables.length && sharedCount === syllables?.length ? ' · same syllables' : ''}
          </>
        )}
      </div>
    </div>
  )
}

function PreviewChart({ item, range, cursor }: { item: BankItem; range: { lo: number; hi: number }; cursor?: number }) {
  const { hop } = item.ref
  const chao = useMemo(() => refChao(item, range), [item, range])
  const pinyin = useMemo(() => marked(item.syllables, item.surface), [item])
  const labels = useMemo<PlotLabel[]>(
    () => item.ref.segments.map((s, i) => ({ t: ((s[0] + s[1]) / 2) * hop, text: pinyin[i], tone: item.surface[i] })),
    [item, pinyin, hop],
  )
  const boundaries = useMemo(() => item.ref.segments.slice(1).map((s) => s[0] * hop), [item, hop])
  const lines = useMemo<PlotLine[]>(() => [{ t: Array.from(chao, (_, i) => i * hop), v: chao, kind: 'wrong' }], [chao, hop])
  const samples = useSamples(audioUrl(item))
  return <PitchPlot lines={lines} duration={chao.length * hop} labels={labels} boundaries={boundaries} cursor={cursor} height="100%" scrub={{ samples, offset: item.ref.t0 }} />
}
