import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpeakerRange } from '../analysis/normalize'
import type { Tone } from '../analysis/tones'
import { playUrl, stopPlayback } from '../audio/playback'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, ItemKind, Manifest } from '../bank/types'
import { clearRetry, dueRetry, grade, pickByCombo, scheduleRetry, updateStat, type Retry } from '../ear/adapt'
import { overrule, type TrialRecord } from '../ear/overrule'
import { addEarConfusion, getEarCombos, getPref, setEarCombo, setPref } from '../store'
import { Toggle } from './Toggle'
import { PitchPlot, type PlotLine } from './PitchPlot'
import { answerOverlay } from './earPlot'
import { marked } from './tone'
import { AnswerPreview } from './AnswerPreview'
import { ResultBanner, ToneAnswer, Verdict } from './ToneAnswer'
import { useReview } from './useReview'
import { FEEDBACK_SECONDS, playFeedback } from '../audio/sfx'

type Kind = ItemKind | 'mix'
const KINDS: [Kind, string][] = [['single', '1 syllable'], ['pair', '2'], ['triple', '3'], ['mix', 'Mix']]
const BASIC: ItemKind[] = ['single', 'pair', 'triple']

const comboKey = (i: BankItem) => i.surface.join('')

interface Props {
  onAnswered: (correct: boolean) => void
  onOverride: (delta: 1 | -1) => void
}

export function EarBank({ onAnswered, onOverride }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>(() => getPref('ear.kind', 'pair') as Kind)
  const [showHanzi, setShowHanzi] = useState(() => getPref<boolean>('ear.hanzi', false))
  const [item, setItem] = useState<BankItem | null>(null)
  const [chosen, setChosen] = useState<(Tone | null)[]>([])
  const [answered, setAnswered] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<number | undefined>()
  const [accepted, setAccepted] = useState(false)
  const lastRec = useRef<TrialRecord | null>(null)
  const [sound, setSound] = useState(() => getPref<boolean>('ear.sound', true))
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
      if (item && answered) review.record({ item, chosen, accepted, rec: lastRec.current ?? undefined })
      review.leave()
      setAccepted(false)
      lastRec.current = null
      autoplay.current = play
      setItem(pick)
      setChosen(pick.surface.map(() => null))
      setAnswered(false)
    },
    [manifest, item, chosen, answered, accepted, review.record, review.leave],
  )

  useEffect(() => {
    if (manifest && !item) next(kind, null, false)
  }, [manifest, item, kind, next])

  const rv = review.reviewing
  const shown = rv ? rv.item : item
  const shownChosen = rv ? rv.chosen : chosen
  const shownAnswered = rv ? true : answered

  const wrong = !!shown && shownAnswered && !grade(shown.surface, shownChosen).all

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
    const conf = item.surface.flatMap((t, i) => (g.correct[i] ? [] : [`${t}>${answers[i]}`]))
    lastRec.current = { key, conf }
    setEarCombo(key, updateStat(getEarCombos()[key], g.all))
    conf.forEach(addEarConfusion)
    trial.current++
    retry.current = g.all ? clearRetry(retry.current, item.id) : scheduleRetry(retry.current, item.id, trial.current)
    setAnswered(true)
    onAnswered(g.all)
    if (sound) playFeedback(g.all)
    if (!g.all) setTimeout(() => void listen(), sound ? FEEDBACK_SECONDS * 1000 : 0)
  }, [item, answered, chosen, onAnswered, listen, sound])

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
      if (!item || !answered || !rec) return
      const now = !accepted
      overrule(rec, 0, now)
      if (now) retry.current = clearRetry(retry.current, item.id)
      setAccepted(now)
      onOverride(now ? 1 : -1)
    }
  }, [rv, review, item, answered, accepted, onOverride])

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
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        undo()
      } else if ((e.key === 'm' || e.key === 'M') && wrong) {
        toggleAccept()
      } else if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (!e.repeat) void listen()
      } else if (!shownAnswered && /^[0-5]$/.test(e.key)) {
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
  }, [item, shownAnswered, chosen, advance, check, listen, pick, review, autoReveal, undo, toggleAccept, wrong])

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

      <section className={`card ${g ? (g.all || (rv ? !!rv.accepted : accepted) ? 'flash-ok' : 'flash-bad') : ''}`}>
        {rv && <div className="banner">Reviewing an earlier word ({(review.index ?? 0) + 1} of {review.count})</div>}
        {g && <ResultBanner key={shown.id + shownChosen.join('') + String((rv ? !!rv.accepted : accepted))} grade={g} accepted={(rv ? !!rv.accepted : accepted)} />}
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
        {g && !g.all && (
          <button className="link small" onClick={toggleAccept}>{(rv ? !!rv.accepted : accepted) ? 'Undo: count this as incorrect again (M)' : 'I was right — mark my answer as correct (M)'}</button>
        )}
      </section>

      {shownAnswered && g && (
        <section className="card">
          <Verdict syllables={pinyin} expected={shown.surface} lexical={shown.lexical} chosen={shownChosen} />
          {!g.all && !(rv ? !!rv.accepted : accepted) && <AnswerPreview key={shown.id + shownChosen.join('')} chosen={shownChosen as Tone[]} exclude={shown.id} syllables={shown.syllables} />}
        </section>
      )}

      <details className="card settings">
        <summary>Ear settings</summary>
        <Toggle label="Sound effects and vibration for right/wrong" value={sound} onChange={(v) => { setSound(v); setPref('ear.sound', v) }} />
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
    () => answerOverlay(item.ref.segments, item.surface, chosen, pinyin, hop, 0, chao),
    [item, chosen, pinyin, hop, chao],
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
