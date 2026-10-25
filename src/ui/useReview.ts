import { useCallback, useState } from 'react'
import type { Tone } from '../analysis/tones'

export interface Trial<T> {
  item: T
  chosen: (Tone | null)[]
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

  return { record, reviewing, canBack, back, forward, leave, count: history.length, index }
}
