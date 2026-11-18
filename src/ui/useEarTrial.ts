import { useCallback, useEffect, useRef, useState } from 'react'
import type { Tone } from '../analysis/tones'
import { FEEDBACK_SECONDS, playFeedback } from '../audio/sfx'
import { clearRetry, grade, scheduleRetry, updateStat, type Retry } from '../ear/adapt'
import { turnedGreen } from '../ear/game'
import { overrule, type TrialRecord } from '../ear/overrule'
import { addEarConfusion, getEarCombos, getPref, recordEarSeen, setEarCombo, setPref } from '../store'
import type { EarProps } from './EarBank'
import { inField } from './keys'
import { useReview } from './useReview'

export interface TrialSource<T> {
  tones: (item: T) => Tone[]
  id: (item: T) => string
  seenKey?: (item: T) => string
  /** Syllables whose tones are shown and pre-filled (partial questions); only the others are asked. */
  given?: (item: T) => boolean[] | undefined
}

/** Shared scoring, retries and review for bank words and clips. Audio stays with the source. */
export function useEarTrial<T>(item: T | null, source: TrialSource<T>, props: Pick<EarProps, 'onAnswered' | 'onOverride' | 'game'>, retryOther = false) {
  const { onAnswered, onOverride, game } = props
  const [chosen, setChosen] = useState<(Tone | null)[]>([])
  const [answered, setAnswered] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [comeback, setComeback] = useState(false)
  const [sound, setSoundState] = useState(() => getPref<boolean>('ear.sound', true))
  const [autoReveal, setAutoRevealState] = useState(() => getPref<boolean>('ear.auto', true))
  const lastRec = useRef<TrialRecord | null>(null)
  const archived = useRef(false)
  const trial = useRef(0)
  const retry = useRef<Retry[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cancelFeedback = useCallback(() => clearTimeout(timer.current), [])
  useEffect(() => cancelFeedback, [item, cancelFeedback])
  const review = useReview<T>(cancelFeedback)
  const { record, leave } = review

  const archive = useCallback((snapshot: T | null = item) => {
    if (snapshot && answered && !archived.current) {
      archived.current = true
      record({ item: snapshot, chosen, accepted, rec: lastRec.current ?? undefined })
    }
  }, [item, answered, chosen, accepted, record])

  const reset = useCallback((tones: Tone[], given?: boolean[]) => {
    cancelFeedback()
    leave()
    archived.current = false
    lastRec.current = null
    setChosen(tones.map((t, i) => (given?.[i] ? t : null)))
    setAnswered(false)
    setAccepted(false)
    setComeback(false)
  }, [cancelFeedback, leave])

  const submit = useCallback((answers: (Tone | null)[] = chosen) => {
    if (!item || answered || lastRec.current || review.reviewing || answers.length !== source.tones(item).length || answers.some((c) => c === null)) return
    const tones = source.tones(item)
    const g = grade(tones, answers)
    const key = tones.join('')
    const id = source.id(item)
    const conf = tones.flatMap((t, i) => g.correct[i] ? [] : [`${t}>${answers[i]}`])
    const first = source.seenKey ? recordEarSeen(source.seenKey(item), g.all) : undefined
    lastRec.current = { key, conf, first }
    // A partial question says little about hearing the whole pattern, so it leaves pattern stats alone.
    const partial = !!source.given?.(item)?.some(Boolean)
    const before = getEarCombos()[key]
    const stat = updateStat(before, g.all)
    if (!partial) setEarCombo(key, stat)
    const back = g.all && retry.current.some((r) => retryOther ? r.pattern === key : r.id === id)
    conf.forEach(addEarConfusion)
    trial.current++
    const pattern = retryOther ? key : undefined
    retry.current = g.all ? clearRetry(retry.current, id, pattern) : scheduleRetry(retry.current, id, trial.current, pattern)
    setChosen(answers)
    setAnswered(true)
    setComeback(back)
    onAnswered(g.all, { comeback: back, milestone: !partial && turnedGreen(before?.ema, stat.ema, stat.n) ? [...key].join('-') : undefined })
    if (sound) playFeedback(g.all, game && back)
    return g
  }, [item, answered, chosen, review.reviewing, source, retryOther, onAnswered, sound, game])

  const afterFeedback = useCallback((replay: () => void) => {
    cancelFeedback()
    timer.current = setTimeout(replay, sound ? FEEDBACK_SECONDS * 1000 : 0)
  }, [cancelFeedback, sound])

  const rv = review.reviewing
  const shown = rv ? rv.item : item
  const shownChosen = rv ? rv.chosen : chosen
  const shownAnswered = !!rv || answered
  const wrong = !!shown && shownAnswered && !grade(source.tones(shown), shownChosen).all

  const toggleAccept = useCallback(() => {
    if (!wrong) return
    if (rv && review.index !== null) {
      if (!rv.rec) return
      const key = rv.rec.key
      const later = review.history.slice(review.index + 1).filter((t) => t.rec?.key === key).length + (answered && lastRec.current?.key === key ? 1 : 0)
      const now = !rv.accepted
      overrule(rv.rec, later, now)
      review.update(review.index, { accepted: now })
      if (now) retry.current = clearRetry(retry.current, source.id(rv.item), retryOther ? key : undefined)
      onOverride(now ? 1 : -1)
    } else {
      const rec = lastRec.current
      if (!item || !answered || !rec) return
      const now = !accepted
      overrule(rec, 0, now)
      if (now) retry.current = clearRetry(retry.current, source.id(item), retryOther ? rec.key : undefined)
      setAccepted(now)
      onOverride(now ? 1 : -1)
    }
  }, [wrong, rv, review, item, answered, accepted, source, retryOther, onOverride])

  const given = (item && source.given?.(item)) || undefined
  const undo = useCallback(() => {
    if (answered || rv) return
    setChosen((c) => {
      const last = c.map((x, i) => x !== null && !given?.[i]).lastIndexOf(true)
      return last < 0 ? c : c.map((x, i) => i === last ? null : x)
    })
  }, [answered, rv, given])

  const setSound = (v: boolean) => { setSoundState(v); setPref('ear.sound', v) }
  const setAutoReveal = (v: boolean) => { setAutoRevealState(v); setPref('ear.auto', v) }
  return { chosen, setChosen, answered, accepted, comeback, sound, setSound, autoReveal, setAutoReveal,
    trial, retry, review, archive, reset, submit, afterFeedback, cancelFeedback,
    rv, shown, shownChosen, shownAnswered, wrong, toggleAccept, undo, given }
}

/** Buttons and keyboard share the same entry and navigation rules. */
export function useEarControls<T>(session: ReturnType<typeof useEarTrial<T>>, check: (answers?: (Tone | null)[]) => void, next: () => void, listen: () => void) {
  const { shown, shownAnswered, chosen, setChosen, autoReveal, rv, review, undo, toggleAccept, wrong, cancelFeedback, given } = session
  const pick = useCallback((index: number, tone: Tone) => {
    if (shownAnswered || given?.[index]) return
    const answers = chosen.map((x, i) => i === index ? (x === tone ? null : tone) : x)
    setChosen(answers)
    if (autoReveal && answers.every((c) => c !== null)) check(answers)
  }, [shownAnswered, chosen, setChosen, autoReveal, check, given])
  /** Set when stepping forward out of review, so the live question is played again once it is on screen. */
  const replay = useRef(false)
  const advance = useCallback(() => {
    cancelFeedback()
    if (rv) {
      replay.current = review.index !== null && review.index + 1 >= review.count
      review.forward()
    } else next()
  }, [cancelFeedback, rv, review, next])
  useEffect(() => {
    if (rv || !replay.current) return
    replay.current = false
    listen()
  }, [rv, listen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !shown || inField(e)) return
      if (e.key === 'Enter') {
        e.preventDefault()
        if (shownAnswered) advance()
        else if (!autoReveal) check()
      } else if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        cancelFeedback()
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
        if (!e.repeat) { cancelFeedback(); listen() }
      } else if (!shownAnswered && /^[0-5]$/.test(e.key)) {
        const i = chosen.findIndex((c) => c === null)
        if (i >= 0 && !(i === 0 && (e.key === '0' || e.key === '5'))) pick(i, (e.key === '5' ? 0 : Number(e.key)) as Tone)
      }
    }
    const onUp = (e: KeyboardEvent) => e.key === ' ' && !inField(e) && e.preventDefault()
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [shown, shownAnswered, chosen, advance, check, listen, pick, review, autoReveal, undo, toggleAccept, wrong, cancelFeedback])
  return { pick, advance }
}
