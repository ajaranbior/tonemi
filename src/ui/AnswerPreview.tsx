import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tone } from '../analysis/tones'
import { playUrl, stopPlayback, wavUrl } from '../audio/playback'
import { synthTones } from '../audio/synth'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, Manifest } from '../bank/types'
import { PitchPlot, type PlotLabel, type PlotLine } from './PitchPlot'
import { marked } from './tone'

const same = (a: Tone[], b: Tone[]) => a.length === b.length && a.every((t, i) => t === b[i])

interface Props {
  /** The tones the learner picked. */
  chosen: Tone[]
  /** Bank word to leave out (the one that was just played). */
  exclude?: string
  /** Toneless syllables of the word that was asked; recordings sharing them are preferred. */
  syllables?: string[]
}

const plain = (s: string) => s.toLowerCase().replace(/ü/g, 'v')

/** "If it were 2-3, it would sound like this": a real recording with that tone pattern, else a synthesized hum. */
export function AnswerPreview({ chosen, exclude, syllables }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [round, setRound] = useState(0)
  const [cursor, setCursor] = useState<number | undefined>()
  const [playing, setPlaying] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    loadManifest().then(setManifest, () => {})
    return () => stopPlayback()
  }, [])

  // Recordings with the chosen tones, those sharing the most syllables with the asked word first.
  const matches = useMemo(() => {
    const asked = syllables?.map(plain) ?? []
    const shared = (i: BankItem) => i.syllables.filter((s, k) => plain(s) === asked[k]).length
    return (manifest?.items ?? [])
      .filter((i) => same(i.surface, chosen) && i.id !== exclude)
      .map((i) => ({ i, score: shared(i), r: Math.random() }))
      .sort((a, b) => b.score - a.score || a.r - b.r)
      .map((x) => x.i)
  }, [manifest, chosen, exclude, syllables])
  // Two 3rd tones in a row are never pronounced as 3-3 (the first becomes a 2nd tone), so there is no
  // recording of that surface pattern. Offer a word that is *written* with these tones instead.
  const written = useMemo(
    () => (matches.length ? [] : (manifest?.items ?? []).filter((i) => same(i.lexical, chosen) && i.id !== exclude)),
    [manifest, matches, chosen, exclude],
  )
  const pool = matches.length ? matches : written
  const item: BankItem | null = pool.length ? pool[round % pool.length] : null
  const isWritten = !matches.length && !!item
  const sharedCount = item && syllables ? item.syllables.filter((s, k) => plain(s) === plain(syllables[k] ?? '')).length : 0
  const range = manifest ? Object.values(manifest.speakers)[0].range : null

  const play = async () => {
    if (!manifest || !range) return
    const mine = ++latest.current
    setPlaying(true)
    try {
      if (item) await playUrl(audioUrl(item), 1, (t) => setCursor(Number.isNaN(t) ? undefined : t - item.ref.t0))
      else await playUrl(wavUrl(synthTones(chosen, range)))
    } catch {
      // ignore: nothing useful to show for a failed preview
    }
    if (mine === latest.current) setPlaying(false)
  }

  if (!manifest || !range) return null
  const label = chosen.join('-')
  const speaker = item ? manifest.speakers[item.speaker].range : range

  return (
    <div className="preview">
      <h3>{isWritten ? `A word written ${label}` : `Your answer (${label}) sounds like this`}</h3>
      {item ? (
        <>
          {isWritten && (
            <p className="small">
              Two 3rd tones in a row are never pronounced 3-3: the first becomes a 2nd tone, so there is no recording of a spoken {label}.
              This word is <em>written</em> {label}, and this is how it really sounds.
            </p>
          )}
          <p>
            <span className="hanzi-sm">{item.hanzi}</span>{' '}
            <span className="pinyin">
              {marked(item.syllables, item.surface).map((s, i) => (
                <span key={i} className={`t${item.surface[i]}`}>{s} </span>
              ))}
            </span>
          </p>
          {syllables && sharedCount > 0 && (
            <p className="muted small">
              {sharedCount === item.syllables.length && sharedCount === syllables.length
                ? 'Same syllables as the word you heard, with your tones.'
                : 'Shares some syllables with the word you heard.'}
            </p>
          )}
          <PreviewChart item={item} range={speaker} cursor={cursor} />
        </>
      ) : (
        <p className="muted small">No recording has this exact pattern, so this is a synthesized hum of the tone shapes.</p>
      )}
      <div className="controls ear-controls">
        <button className="primary" onClick={play} disabled={playing}>▶ Play {label}</button>
        {pool.length > 1 && (
          <button onClick={() => setRound((r) => r + 1)} disabled={playing}>Another {label}</button>
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
  const lines: PlotLine[] = [{ t: Array.from(chao, (_, i) => i * hop), v: chao, kind: 'ref' }]
  return <PitchPlot lines={lines} duration={chao.length * hop} labels={labels} boundaries={boundaries} cursor={cursor} height={170} />
}
