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
}

/** "If it were 2-3, it would sound like this": a real recording with that tone pattern, else a synthesized hum. */
export function AnswerPreview({ chosen, exclude }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [round, setRound] = useState(0)
  const [cursor, setCursor] = useState<number | undefined>()
  const [playing, setPlaying] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    loadManifest().then(setManifest, () => {})
    return () => stopPlayback()
  }, [])

  const matches = useMemo(
    () => manifest?.items.filter((i) => same(i.surface, chosen) && i.id !== exclude) ?? [],
    [manifest, chosen, exclude],
  )
  const item: BankItem | null = matches.length ? matches[round % matches.length] : null
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
      <h3>Your answer ({label}) sounds like this</h3>
      {item ? (
        <>
          <p>
            <span className="hanzi-sm">{item.hanzi}</span>{' '}
            <span className="pinyin">
              {marked(item.syllables, item.surface).map((s, i) => (
                <span key={i} className={`t${item.surface[i]}`}>{s} </span>
              ))}
            </span>
          </p>
          <PreviewChart item={item} range={speaker} cursor={cursor} />
        </>
      ) : (
        <p className="muted small">No recording has this exact pattern, so this is a synthesized hum of the tone shapes.</p>
      )}
      <div className="controls ear-controls">
        <button className="primary" onClick={play} disabled={playing}>▶ Play {label}</button>
        {matches.length > 1 && (
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
