import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpeakerRange } from '../analysis/normalize'
import type { Tone } from '../analysis/tones'
import { playSequence, playUrl, stopPlayback } from '../audio/playback'
import { jitterRate, canRetone } from '../audio/variants'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, ItemKind, Manifest } from '../bank/types'
import { manyVoices, pickVoice, usableItems, voiceCount, voiceLabel } from '../bank/voices'
import { clearRetry, duePattern, dueRetry, freshWeight, grade, melodyLevel, pickByCombo, pickWeighted, scheduleRetry, updateStat, type Retry } from '../ear/adapt'
import { overrule, type TrialRecord } from '../ear/overrule'
import { useFlag } from '../flags'
import { addEarConfusion, getEarCombos, getEarSeen, getPref, recordEarSeen, setEarCombo, setPref } from '../store'
import { answerUrl, prepareItem, realItem, type EarItem } from './earItem'
import { Toggle } from './Toggle'
import { LoopLength } from './LoopLength'
import { VoiceSettings } from './VoiceSettings'
import { PitchPlot, type PlotLine } from './PitchPlot'
import { answerOverlay } from './earPlot'
import { marked } from './tone'
import { EarStage, ResultChip } from './EarStage'
import { extendSketch, sketchLine, type Sketch } from './sketch'
import type { PreviewVoice } from './AnswerPreview'
import { SandhiNote, ToneAnswer } from './ToneAnswer'
import { turnedGreen } from '../ear/game'
import { useReview } from './useReview'
import { useSamples } from './useSamples'
import { FEEDBACK_SECONDS, playFeedback } from '../audio/sfx'

type Kind = ItemKind | 'mix'
const KINDS: [Kind, string][] = [['single', '1 syllable'], ['pair', '2'], ['triple', '3'], ['mix', 'Mix']]
const BASIC: ItemKind[] = ['single', 'pair', 'triple']

const comboKey = (i: BankItem) => i.surface.join('')
const LENGTH: Record<ItemKind, number> = { single: 1, pair: 2, triple: 3 }
/** Share of questions that are a word moved to other tones, when retoned questions are on. */
const RETONE_SHARE = 0.5

/** An asked word plus the learner's drawing of it (draw-the-pitch mode). */
type Asked = EarItem & { sketch?: Sketch | null }

export interface AnswerExtra {
  /** Right on a word that was missed a few trials earlier. */
  comeback: boolean
  /** Tone pattern (e.g. "3-4") that this answer pushed into the green. */
  milestone?: string
}

export interface EarProps {
  onAnswered: (correct: boolean, extra: AnswerExtra) => void
  onOverride: (delta: 1 | -1) => void
  /** Streaks & points enabled. */
  game: boolean
  onGame: (on: boolean) => void
}

export function EarBank({ onAnswered, onOverride, game, onGame }: EarProps) {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>(() => getPref('ear.kind', 'pair') as Kind)
  const [showHanzi, setShowHanzi] = useState(() => getPref<boolean>('ear.hanzi', false))
  const [item, setItem] = useState<Asked | null>(null)
  const [sketch, setSketch] = useState<Sketch | null>(null)
  /** Auto A/B after a miss: 0 right, 1 yours, 2 right again; null when not playing. */
  const [abStep, setAbStep] = useState<number | null>(null)
  const flags = {
    retryOther: useFlag('retryOther'),
    fresh: useFlag('fresh'),
    retoned: useFlag('retoned'),
    jitter: useFlag('jitter'),
    autoAB: useFlag('autoAB'),
    melody: useFlag('melody'),
    draw: useFlag('draw'),
  }
  const [chosen, setChosen] = useState<(Tone | null)[]>([])
  const [answered, setAnswered] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<number | undefined>()
  const [accepted, setAccepted] = useState(false)
  const [comeback, setComeback] = useState(false)
  const lastRec = useRef<TrialRecord | null>(null)
  const [sound, setSound] = useState(() => getPref<boolean>('ear.sound', true))
  const [, setVoiceTick] = useState(0)
  const [autoReveal, setAutoReveal] = useState(() => getPref<boolean>('ear.auto', true))
  const review = useReview<Asked>()
  const playToken = useRef(0)
  const trial = useRef(0)
  const retry = useRef<Retry[]>([])
  const autoplay = useRef(false)
  /** Last voice each word was played in, so a missed word comes back in another voice. */
  const lastVoice = useRef(new Map<string, string>())
  /** Bumped per question so a slow-to-prepare question doesn't land after a newer one. */
  const nextToken = useRef(0)
  const recorded = useRef<Asked | null>(null)

  useEffect(() => {
    loadManifest().then(setManifest, (e) => setError(String(e)))
  }, [])

  const next = useCallback(
    (k: Kind, avoid?: Asked | null, play = true) => {
      if (!manifest) return
      const usable = usableItems(manifest)
      const byId = new Map(usable.map((i) => [i.id, i]))
      const inKind = (i: BankItem) => k === 'mix' || i.kind === k
      const avoidId = avoid ? realItem(avoid).id : undefined
      const seen = getEarSeen()
      const heard = (key: string) => seen[key]?.n ?? 0
      const weight = flags.fresh ? (i: BankItem) => freshWeight(heard(i.id)) : undefined
      let pick: BankItem | undefined
      let target: Tone[] | undefined

      if (flags.retryOther) {
        // A missed pattern comes back in another word (or the same word moved to it, or as a last resort the same word).
        const fits = (pattern: string) => k === 'mix' || pattern.length === LENGTH[k]
        const due = duePattern(retry.current, trial.current, (r) => fits(r.pattern!))
        if (due) {
          const pattern = [...due.pattern!].map(Number) as Tone[]
          const others = usable.filter((i) => comboKey(i) === due.pattern && i.id !== due.id && i.id !== avoidId)
          if (others.length) pick = weight ? pickWeighted(others, weight) : others[Math.floor(Math.random() * others.length)]
          else if (flags.retoned) {
            const movable = usable.filter((i) => canRetone(i.surface, pattern) && i.id !== due.id && i.id !== avoidId)
            pick = pickWeighted(movable, (i) => (flags.fresh ? freshWeight(heard(`${i.id}~${due.pattern}`)) : 1))
            if (pick) target = pattern
          }
          pick ??= byId.get(due.id)
        }
      } else {
        const due = dueRetry(retry.current, trial.current, (id) => !!byId.get(id) && inKind(byId.get(id)!) && id !== avoidId)
        pick = due ? byId.get(due) : undefined
      }
      if (!pick) {
        const kindNow = k === 'mix' ? BASIC[Math.floor(Math.random() * BASIC.length)] : k
        let pool = usable.filter((i) => i.kind === kindNow)
        if (pool.length > 1 && avoidId) pool = pool.filter((i) => i.id !== avoidId)
        pick = pickByCombo(pool, comboKey, getEarCombos(), Math.random, weight)
        // Retoned questions: keep the pattern chosen above, but say it with another word moved to it.
        if (pick && flags.retoned && Math.random() < RETONE_SHARE) {
          const pattern = pick.surface
          const key = comboKey(pick)
          const movable = pool.filter((i) => comboKey(i) !== key && canRetone(i.surface, pattern))
          const word = pickWeighted(movable, (i) => (flags.fresh ? freshWeight(heard(`${i.id}~${key}`)) : 1))
          if (word) {
            pick = word
            target = pattern
          }
        }
      }
      if (!pick) return
      pick = pickVoice(manifest, pick, lastVoice.current.get(pick.id))
      lastVoice.current.set(pick.id, pick.speaker)
      if (item && answered && recorded.current !== item) {
        recorded.current = item
        review.record({ item: { ...item, sketch }, chosen, accepted, rec: lastRec.current ?? undefined })
      }
      const level = flags.melody ? melodyLevel(getEarCombos()[(target ?? pick.surface).join('')]) : 'full'
      const mine = ++nextToken.current
      ++playToken.current
      stopPlayback()
      void prepareItem(manifest, pick, target, level).then((ready) => {
        if (mine !== nextToken.current) return
        review.leave()
        setAccepted(false)
        setComeback(false)
        setSketch(null)
        setAbStep(null)
        lastRec.current = null
        autoplay.current = play
        setItem(ready)
        setChosen(ready.surface.map(() => null))
        setAnswered(false)
      })
    },
    [manifest, item, chosen, answered, accepted, sketch, review.record, review.leave, flags.fresh, flags.retryOther, flags.retoned, flags.melody],
  )

  const started = useRef(false)
  useEffect(() => {
    if (manifest && !item && !started.current) {
      started.current = true
      next(kind, null, false)
    }
  }, [manifest, item, kind, next])

  const rv = review.reviewing
  const shown = rv ? rv.item : item
  const shownChosen = rv ? rv.chosen : chosen
  const shownAnswered = rv ? true : answered

  const wrong = !!shown && shownAnswered && !grade(shown.surface, shownChosen).all

  /** Play what is asked: the hum / muffled version before answering, the full word after. */
  const listen = useCallback(
    async (rate = 1, full = shownAnswered) => {
      if (!shown) return
      const mine = ++playToken.current
      setAbStep(null)
      setPlaying(true)
      const reduced = !full && shown.qUrl
      const url = reduced ? shown.qUrl! : shown.url
      const t0 = reduced ? (shown.qT0 ?? 0) : shown.ref.t0
      // Jitter speeds/slows like a tape, so pitch moves too; the slow button keeps the pitch.
      const r = flags.jitter && rate === 1 ? jitterRate() : rate
      try {
        await playUrl(url, r, (t) => setCursor(Number.isNaN(t) ? undefined : t - t0), r === rate)
      } catch (e) {
        setError(String(e))
      }
      if (mine === playToken.current) setPlaying(false)
    },
    [shown, shownAnswered, flags.jitter],
  )

  useEffect(() => {
    if (shown && autoplay.current) {
      autoplay.current = false
      void listen()
    }
  }, [shown, listen])
  useEffect(() => () => stopPlayback(), [])

  /** Same word, another voice (before or after answering); a retoned or melody-only question stays so. */
  const otherVoice = () => {
    if (!manifest || !item || rv) return
    const real = realItem(item)
    const v = pickVoice(manifest, real, item.speaker)
    lastVoice.current.set(v.id, v.speaker)
    const mine = ++nextToken.current
    void prepareItem(manifest, v, item.from ? item.surface : undefined, item.melody ?? 'full').then((ready) => {
      if (mine !== nextToken.current) return
      autoplay.current = true
      setItem({ ...ready, sketch: item.sketch })
    })
  }

  /** After a miss: the right tones, then the same recording moved to the answer, then the right ones again. */
  const playAB = useCallback(
    async (asked: EarItem, answers: Tone[]) => {
      if (!manifest) return
      const mine = ++playToken.current
      const yours = await answerUrl(manifest, asked, answers)
      if (mine !== playToken.current) return
      if (!yours) return void listen(1, true)
      setPlaying(true)
      await playSequence([asked.url, yours, asked.url], () => mine === playToken.current, (i) => setAbStep(i < 0 ? null : i))
      if (mine === playToken.current) setPlaying(false)
    },
    [manifest, listen],
  )

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
    const first = recordEarSeen(item.seenKey, g.all)
    lastRec.current = { key, conf, first }
    const before = getEarCombos()[key]
    const stat = updateStat(before, g.all)
    setEarCombo(key, stat)
    const realId = realItem(item).id
    const back = g.all && retry.current.some((r) => (flags.retryOther ? r.pattern === key : r.id === realId))
    conf.forEach(addEarConfusion)
    trial.current++
    if (flags.retryOther) retry.current = g.all ? clearRetry(retry.current, realId, key) : scheduleRetry(retry.current, realId, trial.current, key)
    else retry.current = g.all ? clearRetry(retry.current, realId) : scheduleRetry(retry.current, realId, trial.current)
    setAnswered(true)
    setComeback(back)
    onAnswered(g.all, { comeback: back, milestone: turnedGreen(before?.ema, stat.ema, stat.n) ? [...key].join('-') : undefined })
    if (sound) playFeedback(g.all, game && back)
    const wait = sound ? FEEDBACK_SECONDS * 1000 : 0
    // A miss replays the word (or right → yours → right); a melody-only question plays the full word either way.
    if (!g.all && flags.autoAB) setTimeout(() => void playAB(item, answers as Tone[]), wait)
    else if (!g.all || item.melody) setTimeout(() => void listen(1, true), wait)
  }, [item, answered, chosen, onAnswered, listen, playAB, sound, game, flags.retryOther, flags.autoAB])

  /** The learner disagrees with the answer key (or takes that back): flip this trial's result. */
  const toggleAccept = useCallback(() => {
    if (rv && review.index !== null) {
      if (!rv.rec) return
      const key = rv.rec.key
      const later = review.history.slice(review.index + 1).filter((t) => t.rec?.key === key).length + (answered && lastRec.current?.key === key ? 1 : 0)
      const now = !rv.accepted
      overrule(rv.rec, later, now)
      review.update(review.index, { accepted: now })
      if (now) retry.current = clearRetry(retry.current, realItem(rv.item).id, flags.retryOther ? key : undefined)
      onOverride(now ? 1 : -1)
    } else {
      const rec = lastRec.current
      if (!item || !answered || !rec) return
      const now = !accepted
      overrule(rec, 0, now)
      if (now) retry.current = clearRetry(retry.current, realItem(item).id, flags.retryOther ? rec.key : undefined)
      setAccepted(now)
      onOverride(now ? 1 : -1)
    }
  }, [rv, review, item, answered, accepted, onOverride, flags.retryOther])

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
  // ← or Q goes back to the previous word, → or E forward / next.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !item) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (shownAnswered) advance()
        else if (!autoReveal) check()
      } else if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        review.back()
      } else if (e.key === 'ArrowRight' || e.key === 'e' || e.key === 'E') {
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
  // The asked recording, for "your answer in the same voice".
  // A retoned question previews from the real recording, with the real tones as the starting point.
  const voice = useMemo<PreviewVoice | undefined>(() => {
    if (!shown || !refRange) return undefined
    const real = realItem(shown)
    return { url: real === shown ? shown.url : audioUrl(real), hop: real.ref.hop, t0: real.ref.t0, st: real.ref.st, segments: real.ref.segments, range: refRange, expected: real.surface }
  }, [shown, refRange])
  const shownSketch = rv ? (rv.item.sketch ?? null) : sketch
  const sketchPlot = useMemo(() => sketchLine(shownSketch), [shownSketch])
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
  const ok = rv ? !!rv.accepted : accepted

  return (
    <>
      <section className={`card ${g ? (g.all || ok ? 'flash-ok' : 'flash-bad') : ''}`}>
        <div className="item-head ear-head">
          <div>
            {shownAnswered || showHanzi ? (
              <>
                <div className="hanzi">
                  {shown.hanzi}
                  {shown.from && <span className="tag-retoned" title="Resynthesized with other tones">retoned</span>}
                </div>
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
          {rv && <div className="review-slot"><span className="review-pill" title="Reviewing an earlier word">↩ Review {(review.index ?? 0) + 1} of {review.count}</span></div>}
          {g && <ResultChip key={shown.id + shownChosen.join('') + String(ok)} grade={g} accepted={ok} comeback={game && !rv && comeback} />}
        </div>

        <EarStage
          key={shown.id + String(review.index)}
          answered={shownAnswered && !!g}
          chart={g && <ReferenceChart item={shown} range={refRange} chosen={shownChosen} pinyin={pinyin} cursor={cursor} sketch={sketchPlot} />}
          slots={shown.syllables.length}
          duration={shown.ref.st.length * shown.ref.hop}
          cursor={cursor}
          playing={playing}
          onPlay={() => void listen()}
          preview={g && !g.all && !ok ? { chosen: shownChosen as Tone[], exclude: realItem(shown).id, syllables: shown.syllables, voice } : null}
          sketch={
            flags.draw && !shownAnswered
              ? { line: sketchPlot, onDraw: (pt, start) => setSketch((sk) => extendSketch(sk, pt, start)), onClear: () => setSketch(null) }
              : undefined
          }
        />

        <div className="controls ear-controls">
          <button className="primary" onClick={() => listen(1)} disabled={playing}>▶ Listen</button>
          <button onClick={() => listen(0.6)} disabled={playing}>🐢 Slow</button>
          {manyVoices(manifest) && (
            <button onClick={otherVoice} disabled={playing || !!rv || voiceCount(manifest, shown) < 2} title="Same word, another voice">🔀 Voice</button>
          )}
        </div>
        {manyVoices(manifest) && <div className="muted small voice-tag">Voice: {voiceLabel(manifest, shown.speaker)}</div>}
        {!shownAnswered && shown.melody && (
          <div className="muted small voice-tag">{shown.melody === 'hum' ? '🎵 Melody only: a hum of the speaker’s pitch' : '🔉 Muffled: listen for the melody'}</div>
        )}
        {abStep !== null && (
          <div className="ab-status small" role="status">
            {['Right tones', 'Your answer', 'Right tones'].map((label, i) => (
              <span key={i} className={i === abStep ? 'on' : ''}>{label}</span>
            ))}
          </div>
        )}
        {shownAnswered && shown.from && (
          <p className="muted small retoned-note">
            🎛 Retoned: {shown.hanzi} is really{' '}
            {marked(shown.from.syllables, shown.from.surface).map((p, i) => (
              <span key={i} className={`t${shown.from!.surface[i]}`}>{p} </span>
            ))}
            ({shown.from.surface.join('-')}); for this question the app moved its pitch to {shown.surface.join('-')}.
          </p>
        )}

        <h3 className="ear-q">{shownAnswered ? 'Answer' : `Which ${shown.syllables.length > 1 ? 'tones' : 'tone'} do you hear?`}</h3>
        <ToneAnswer chosen={shownChosen} expected={shownAnswered ? shown.surface : undefined} onPick={pick} />

        <div className="nav-row">
          <button onClick={review.back} disabled={!review.canBack}>← Back</button>
          {!shownAnswered && !autoReveal ? (
            <button className="primary" onClick={() => check()} disabled={!complete}>Check</button>
          ) : shownAnswered ? (
            <button className="primary" onClick={advance}>Next →</button>
          ) : (
            <button onClick={() => next(kind, item)}>Skip →</button>
          )}
        </div>
        {g && !g.all && (
          <button className="link small" onClick={toggleAccept}>{ok ? 'Undo: count this as incorrect again (M)' : 'I was right — mark my answer as correct (M)'}</button>
        )}
        {shownAnswered && <SandhiNote syllables={pinyin} expected={shown.surface} lexical={shown.lexical} />}
      </section>

      <div className="options">
        <p className="muted small">Word length</p>
        <div className="segmented compact" role="tablist" aria-label="Word length">
          {KINDS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => choose(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <details className="card settings">
        <summary>Ear settings</summary>
        <Toggle label="Streaks and points" value={game} onChange={onGame} />
        <Toggle label="Sound effects and vibration for right/wrong" value={sound} onChange={(v) => { setSound(v); setPref('ear.sound', v) }} />
        <Toggle label="Reveal the answer as soon as all tones are chosen" value={autoReveal} onChange={(v) => { setAutoReveal(v); setPref('ear.auto', v) }} />
        <Toggle label="Show the character before answering" value={showHanzi} onChange={(v) => { setShowHanzi(v); setPref('ear.hanzi', v) }} />
        <LoopLength />
        <VoiceSettings manifest={manifest} onChange={() => setVoiceTick((x) => x + 1)} />
      </details>
    </>
  )
}

export function ReferenceChart({ item, range, chosen, pinyin, cursor, sketch, focus }: { item: EarItem; range: SpeakerRange; chosen: (Tone | null)[]; pinyin: string[]; cursor?: number; sketch?: PlotLine | null; focus?: [number, number] }) {
  const { hop } = item.ref
  const chao = useMemo(() => refChao(item, range), [item, range])
  const { labels, guess, boundaries } = useMemo(
    () => answerOverlay(item.ref.segments, item.surface, chosen, pinyin, hop, 0, chao),
    [item, chosen, pinyin, hop, chao],
  )
  const lines = useMemo<PlotLine[]>(
    () => [{ t: Array.from(chao, (_, i) => i * hop), v: chao, kind: 'ref' as const }, ...(guess ? [guess] : []), ...(sketch ? [sketch] : [])],
    [chao, hop, guess, sketch],
  )
  const samples = useSamples(item.url)
  return (
    <>
      <div className="stage-plot">
        <PitchPlot lines={lines} duration={chao.length * hop} labels={labels} boundaries={boundaries} cursor={cursor} height="100%" scrub={{ samples, offset: item.ref.t0 }} focus={focus} />
      </div>
      <div className="legend">
        <span className="key ref" /> the speaker's pitch
        {guess && (
          <>
            <span className="key wrong" /> the tone you picked
          </>
        )}
        {sketch && (
          <>
            <span className="key user" /> your drawing
          </>
        )}
        <span className="legend-hint">Space replays · hold & drag on the chart to loop a spot</span>
      </div>
    </>
  )
}
