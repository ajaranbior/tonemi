import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpeakerRange } from '../analysis/normalize'
import type { Tone } from '../analysis/tones'
import { playUrl, stopPlayback } from '../audio/playback'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, ItemKind, Manifest } from '../bank/types'
import { clearRetry, dueRetry, grade, pickByCombo, scheduleRetry, updateStat, type Retry } from '../ear/adapt'
import { addEarConfusion, getEarCombos, getPref, setEarCombo, setPref } from '../store'
import { Toggle } from './Toggle'
import { PitchPlot, type PlotLine } from './PitchPlot'
import { answerOverlay } from './earPlot'
import { marked } from './tone'
import { ToneAnswer, Verdict } from './ToneAnswer'

type Kind = ItemKind | 'mix'
const KINDS: [Kind, string][] = [['single', '1 syllable'], ['pair', '2'], ['triple', '3'], ['mix', 'Mix']]
const BASIC: ItemKind[] = ['single', 'pair', 'triple']

const comboKey = (i: BankItem) => i.surface.join('')

interface Props {
  onAnswered: (correct: boolean) => void
}

export function EarBank({ onAnswered }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>(() => getPref('ear.kind', 'pair') as Kind)
  const [showHanzi, setShowHanzi] = useState(() => getPref<boolean>('ear.hanzi', false))
  const [item, setItem] = useState<BankItem | null>(null)
  const [chosen, setChosen] = useState<(Tone | null)[]>([])
  const [answered, setAnswered] = useState(false)
  const [playing, setPlaying] = useState(false)
  const trial = useRef(0)
  const retry = useRef<Retry[]>([])
  const autoplay = useRef(false)

  useEffect(() => {
    loadManifest().then(setManifest, (e) => setError(String(e)))
  }, [])

  const next = useCallback(
    (k: Kind, avoid?: BankItem | null, play = true) => {
      if (!manifest) return
      const byId = new Map(manifest.items.map((i) => [i.id, i]))
      const inKind = (i: BankItem) => k === 'mix' || i.kind === k
      const due = dueRetry(retry.current, trial.current, (id) => !!byId.get(id) && inKind(byId.get(id)!) && id !== avoid?.id)
      let pick = due ? byId.get(due) : undefined
      if (!pick) {
        const kindNow = k === 'mix' ? BASIC[Math.floor(Math.random() * BASIC.length)] : k
        let pool = manifest.items.filter((i) => i.kind === kindNow)
        if (pool.length > 1 && avoid) pool = pool.filter((i) => i.id !== avoid.id)
        pick = pickByCombo(pool, comboKey, getEarCombos())
      }
      if (!pick) return
      autoplay.current = play
      setItem(pick)
      setChosen(pick.surface.map(() => null))
      setAnswered(false)
    },
    [manifest],
  )

  useEffect(() => {
    if (manifest && !item) next(kind, null, false)
  }, [manifest, item, kind, next])

  const listen = useCallback(
    async (rate = 1) => {
      if (!item) return
      setPlaying(true)
      try {
        await playUrl(audioUrl(item), rate)
      } catch (e) {
        setError(String(e))
      }
      setPlaying(false)
    },
    [item],
  )

  useEffect(() => {
    if (item && autoplay.current) {
      autoplay.current = false
      void listen()
    }
    return () => stopPlayback()
  }, [item, listen])

  const choose = (k: Kind) => {
    setKind(k)
    setPref('ear.kind', k)
    next(k, item)
  }

  const pick = useCallback(
    (index: number, tone: Tone) => {
      if (answered) return
      setChosen((c) => c.map((x, i) => (i === index ? tone : x)))
    },
    [answered],
  )

  const check = useCallback(() => {
    if (!item || answered || chosen.some((c) => c === null)) return
    const g = grade(item.surface, chosen)
    const key = comboKey(item)
    setEarCombo(key, updateStat(getEarCombos()[key], g.all))
    item.surface.forEach((t, i) => !g.correct[i] && addEarConfusion(`${t}>${chosen[i]}`))
    trial.current++
    retry.current = g.all ? clearRetry(retry.current, item.id) : scheduleRetry(retry.current, item.id, trial.current)
    setAnswered(true)
    onAnswered(g.all)
  }, [item, answered, chosen, onAnswered])

  // Keyboard: digits fill the next empty syllable, Enter checks/continues, R replays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !item) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (answered) next(kind, item)
        else check()
      } else if (e.key === 'r' || e.key === 'R') void listen()
      else if (!answered && /^[0-4]$/.test(e.key)) {
        const i = chosen.findIndex((c) => c === null)
        if (i >= 0 && !(i === 0 && e.key === '0')) pick(i, Number(e.key) as Tone)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, answered, chosen, kind, next, check, listen, pick])

  const refRange: SpeakerRange | null = manifest && item ? manifest.speakers[item.speaker].range : null
  const complete = chosen.length > 0 && chosen.every((c) => c !== null)
  const g = useMemo(() => (item && answered ? grade(item.surface, chosen) : null), [item, answered, chosen])

  if (error)
    return (
      <div className="card error">
        <p>{error}</p>
        <button onClick={() => setError(null)}>OK</button>
      </div>
    )
  if (!manifest || !item || !refRange) return <div className="card">Loading word bank…</div>

  const pinyin = marked(item.syllables, item.surface)

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Word length">
        {KINDS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => choose(k)}>
            {label}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="item-head">
          <div>
            {answered || showHanzi ? (
              <>
                <div className="hanzi">{item.hanzi}</div>
                {answered && (
                  <div className="pinyin">
                    {pinyin.map((s, i) => (
                      <span key={i} className={`t${item.surface[i]}`}>{s} </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="hanzi muted" aria-label="Word hidden">？</div>
            )}
          </div>
          {g && <div className={`big-score ${g.all ? 'score-good' : 'score-bad'}`}>{g.all ? '✓' : '✗'}</div>}
        </div>

        <div className="controls ear-controls">
          <button className="primary" onClick={() => listen(1)} disabled={playing}>▶ Listen</button>
          <button onClick={() => listen(0.6)} disabled={playing}>🐢 Slow</button>
        </div>

        <h3 className="ear-q">{answered ? 'Answer' : `Which ${item.syllables.length > 1 ? 'tones' : 'tone'} do you hear?`}</h3>
        <ToneAnswer chosen={chosen} expected={answered ? item.surface : undefined} onPick={pick} />

        {!answered ? (
          <button className="primary wide" onClick={check} disabled={!complete}>Check</button>
        ) : (
          <button className="primary wide" onClick={() => next(kind, item)}>Next →</button>
        )}
      </section>

      {answered && g && (
        <section className="card">
          <Verdict syllables={pinyin} expected={item.surface} lexical={item.lexical} chosen={chosen} />
          <ReferenceChart item={item} range={refRange} chosen={chosen} pinyin={pinyin} wrong={!g.all} />
        </section>
      )}

      <details className="card settings">
        <summary>Ear settings</summary>
        <Toggle label="Show the character before answering" value={showHanzi} onChange={(v) => { setShowHanzi(v); setPref('ear.hanzi', v) }} />
      </details>
    </>
  )
}

function ReferenceChart({ item, range, chosen, pinyin, wrong }: { item: BankItem; range: SpeakerRange; chosen: (Tone | null)[]; pinyin: string[]; wrong: boolean }) {
  const { hop } = item.ref
  const chao = useMemo(() => refChao(item, range), [item, range])
  const { labels, guess, boundaries } = useMemo(
    () => answerOverlay(item.ref.segments, item.surface, chosen, pinyin, hop, 0),
    [item, chosen, pinyin, hop],
  )
  const lines: PlotLine[] = [{ t: Array.from(chao, (_, i) => i * hop), v: chao, kind: 'ref' }]
  if (guess) lines.push(guess)
  return (
    <>
      <PitchPlot lines={lines} duration={chao.length * hop} labels={labels} boundaries={boundaries} />
      <div className="legend">
        <span className="key ref" /> the speaker's pitch
        {guess && (
          <>
            <span className="key user" /> shape of the tone you picked
          </>
        )}
      </div>
      {wrong && <p className="muted small">Compare the grey line with the blue one: that is the difference your ear missed. Listen again while looking at the chart.</p>}
    </>
  )
}
