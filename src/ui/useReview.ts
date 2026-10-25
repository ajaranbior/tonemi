import { useCallback, useState } from 'react'
import type { Tone } from '../analysis/tones'
import type { TrialRecord } from '../ear/overrule'

export interface Trial<T> {
  item: T
  chosen: (Tone | null)[]
  /** The learner overruled the answer key for this trial. */
  accepted?: boolean
  rec?: TrialRecord
}

/** Answered trials kept in memory so the learner can step back and look at them again. */
export function useReview<T>() {
  const [history, setHistory] = useState<Trial<T>[]>([])
  const [index, setIndex] = useState<number | null>(null)

  const record = useCallback((t: Trial<T>) => setHistory((h) => [...h, t].slice(-50)), [])
  const reviewing = index !== null ? (history[index] ?? null) : null
  const canBack = (index ?? history.length) > 0
  const back = () => canBack && setIndex((index ?? history.length) - 1)
  /** Step toward the present; returns to the live trial after the last one. */
  const forward = () => setIndex(index !== null && index + 1 < history.length ? index + 1 : null)
  const leave = () => setIndex(null)
  const update = useCallback((i: number, patch: Partial<Trial<T>>) => setHistory((h) => h.map((t, k) => (k === i ? { ...t, ...patch } : t))), [])

  return { record, update, history, reviewing, canBack, back, forward, leave, count: history.length, index }
}
