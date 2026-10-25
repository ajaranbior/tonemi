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
import { AnswerPreview } from './AnswerPreview'
import { ToneAnswer, Verdict } from './ToneAnswer'
import { useReview } from './useReview'

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
  const [cursor, setCursor] = useState<number | undefined>()
  const [autoReveal, setAutoReveal] = useState(() => getPref<boolean>('ear.auto', true))
  const review = useReview<BankItem>()
  const playToken = useRef(0)
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
      if (item && answered) review.record({ item, chosen })
      review.leave()
      autoplay.current = play
      setItem(pick)
      setChosen(pick.surface.map(() => null))
      setAnswered(false)
    },
    [manifest, item, chosen, answered, review.record, review.leave],
  )

  useEffect(() => {
    if (manifest && !item) next(kind, null, false)
  }, [manifest, item, kind, next])

  const rv = review.reviewing
  const shown = rv ? rv.item : item
  const shownChosen = rv ? rv.chosen : chosen
  const shownAnswered = rv ? true : answered

  const listen = useCallback(
    async (rate = 1) => {
      if (!shown) return
      const mine = ++playToken.current
      setPlaying(true)
      try {
        await playUrl(audioUrl(shown), rate, (t) => setCursor(Number.isNaN(t) ? undefined : t - shown.ref.t0))
      } catch (e) {
        setError(String(e))
      }
      if (mine === playToken.current) setPlaying(false)
    },
    [shown],
  )

  useEffect(() => {
    if (shown && autoplay.current) {
      autoplay.current = false
      void listen()
    }
    return () => stopPlayback()
  }, [shown, listen])

  const choose = (k: Kind) => {
    setKind(k)
    setPref('ear.kind', k)
    next(k, item)
  }

  const check = useCallback((answers: (Tone | null)[] = chosen) => {
    if (!item || answered || answers.some((c) => c === null)) return
    const g = grade(item.surface, answers)
    const key = comboKey(item)
    setEarCombo(key, updateStat(getEarCombos()[key], g.all))
    item.surface.forEach((t, i) => !g.correct[i] && addEarConfusion(`${t}>${answers[i]}`))
    trial.current++
    retry.current = g.all ? clearRetry(retry.current, item.id) : scheduleRetry(retry.current, item.id, trial.current)
    setAnswered(true)
    onAnswered(g.all)
    if (!g.all) void listen()
  }, [item, answered, chosen, onAnswered, listen])

  const pick = useCallback(
    (index: number, tone: Tone) => {
      if (answered) return
      const next = chosen.map((x, i) => (i === index ? tone : x))
      setChosen(next)
      if (autoReveal && next.every((c) => c !== null)) check(next)
    },
    [answered, chosen, autoReveal, check],
  )

  const advance = useCallback(() => {
    if (rv) review.forward()
    else next(kind, item)
  }, [rv, review, next, kind, item])

  // Keyboard: digits fill the next empty syllable, Enter checks/continues, Space or R replays,
  // ← goes back to the previous word, → forward / next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !item) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (shownAnswered) advance()
        else if (!autoReveal) check()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        review.back()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (shownAnswered) advance()
      } else if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (!e.repeat) void listen()
      } else if (!shownAnswered && /^[0-4]$/.test(e.key)) {
        const i = chosen.findIndex((c) => c === null)
        if (i >= 0 && !(i === 0 && e.key === '0')) pick(i, Number(e.key) as Tone)
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
  }, [item, shownAnswered, chosen, advance, check, listen, pick, review, autoReveal])

  const refRange: SpeakerRange | null = manifest && shown ? manifest.speakers[shown.speaker].range : null
  const complete = chosen.length > 0 && chosen.every((c) => c !== null)
  const g = useMemo(() => (shown && shownAnswered ? grade(shown.surface, shownChosen) : null), [shown, shownAnswered, shownChosen])

  if (error)
    return (
      <div className="card error">
        <p>{error}</p>
        <button onClick={() => setError(null)}>OK</button>
      </div>
    )
  if (!manifest || !shown || !refRange) return <div className="card">Loading word bank…</div>

  const pinyin = marked(shown.syllables, shown.surface)

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
        {rv && <div className="banner">Reviewing an earlier word ({(review.index ?? 0) + 1} of {review.count})</div>}
        <div className="item-head">
          <div>
            {shownAnswered || showHanzi ? (
              <>
                <div className="hanzi">{shown.hanzi}</div>
                {shownAnswered && (
                  <div className="pinyin">
                    {pinyin.map((s, i) => (
                      <span key={i} className={`t${shown.surface[i]}`}>{s} </span>
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

        {shownAnswered && g && <ReferenceChart item={shown} range={refRange} chosen={shownChosen} pinyin={pinyin} wrong={!g.all} cursor={cursor} />}

        <div className="controls ear-controls">
          <button className="primary" onClick={() => listen(1)} disabled={playing}>▶ Listen</button>
          <button onClick={() => listen(0.6)} disabled={playing}>🐢 Slow</button>
        </div>

        <h3 className="ear-q">{shownAnswered ? 'Answer' : `Which ${shown.syllables.length > 1 ? 'tones' : 'tone'} do you hear?`}</h3>
        <ToneAnswer chosen={shownChosen} expected={shownAnswered ? shown.surface : undefined} onPick={pick} />

        <div className="nav-row">
          <button onClick={review.back} disabled={!review.canBack}>← Back</button>
          {!shownAnswered && !autoReveal ? (
            <button className="primary" onClick={() => check()} disabled={!complete}>Check</button>
          ) : (
            <button className="primary" onClick={advance} disabled={!shownAnswered}>Next →</button>
          )}
        </div>
      </section>

      {shownAnswered && g && (
        <section className="card">
          <Verdict syllables={pinyin} expected={shown.surface} lexical={shown.lexical} chosen={shownChosen} />
          {!g.all && <AnswerPreview key={shown.id + shownChosen.join('')} chosen={shownChosen as Tone[]} exclude={shown.id} />}
        </section>
      )}

      <details className="card settings">
        <summary>Ear settings</summary>
        <Toggle label="Reveal the answer as soon as all tones are chosen" value={autoReveal} onChange={(v) => { setAutoReveal(v); setPref('ear.auto', v) }} />
        <Toggle label="Show the character before answering" value={showHanzi} onChange={(v) => { setShowHanzi(v); setPref('ear.hanzi', v) }} />
      </details>
    </>
  )
}

function ReferenceChart({ item, range, chosen, pinyin, wrong, cursor }: { item: BankItem; range: SpeakerRange; chosen: (Tone | null)[]; pinyin: string[]; wrong: boolean; cursor?: number }) {
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
      <PitchPlot lines={lines} duration={chao.length * hop} labels={labels} boundaries={boundaries} cursor={cursor} />
      <div className="legend">
        <span className="key ref" /> the speaker's pitch
        {guess && (
          <>
            <span className="key user" /> shape of the tone you picked
          </>
        )}
      </div>
      {wrong && <p className="muted small">Grey is what was said; blue is the tone you picked. Space replays it; the line follows the audio.</p>}
    </>
  )
}
