import type { EarStat } from '../store'
import type { Tone } from '../analysis/tones'

/** Accuracy assumed for a combo that has never been tried. */
const PRIOR = 0.5
const ALPHA = 0.3

export function updateStat(prev: EarStat | undefined, allCorrect: boolean): EarStat {
  const ema = prev ? prev.ema : PRIOR
  return { n: (prev?.n ?? 0) + 1, ema: (1 - ALPHA) * ema + ALPHA * (allCorrect ? 1 : 0) }
}

/** Sampling weight: weak and untried combos come up most; mastered ones still appear. */
export function comboWeight(stat: EarStat | undefined): number {
  const acc = stat ? stat.ema : PRIOR
  return 0.08 + (1 - acc) ** 2
}

export function pickWeighted<T>(items: T[], weight: (t: T) => number, rand: () => number = Math.random): T | undefined {
  if (!items.length) return undefined
  const w = items.map(weight)
  let r = rand() * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < items.length; i++) {
    r -= w[i]
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/** Combos are chosen first (by weakness), then an item within the combo, so rare combos aren't drowned out. */
export function pickByCombo<T>(items: T[], comboOf: (t: T) => string, stats: Record<string, EarStat>, rand: () => number = Math.random): T | undefined {
  const combos = [...new Set(items.map(comboOf))]
  const combo = pickWeighted(combos, (c) => comboWeight(stats[c]), rand)
  const pool = items.filter((i) => comboOf(i) === combo)
  return pool[Math.floor(rand() * pool.length)]
}

/** Missed items come back after a few other trials until they are answered correctly. */
export interface Retry {
  id: string
  due: number
}

export const RETRY_GAP = 3

export function scheduleRetry(queue: Retry[], id: string, trial: number): Retry[] {
  return [...queue.filter((r) => r.id !== id), { id, due: trial + RETRY_GAP }]
}

export function clearRetry(queue: Retry[], id: string): Retry[] {
  return queue.filter((r) => r.id !== id)
}

export function dueRetry(queue: Retry[], trial: number, avail: (id: string) => boolean): string | undefined {
  return queue.find((r) => r.due <= trial && avail(r.id))?.id
}

export interface Grade {
  correct: boolean[]
  all: boolean
}

export function grade(expected: Tone[], chosen: (Tone | null)[]): Grade {
  const correct = expected.map((t, i) => chosen[i] === t)
  return { correct, all: correct.every(Boolean) }
}

/** Most frequent wrong answers as `[expected, chosen, count]`. */
export function topConfusions(conf: Record<string, number>, n = 3): [Tone, Tone, number][] {
  return Object.entries(conf)
    .map(([k, c]) => [Number(k[0]) as Tone, Number(k[2]) as Tone, c] as [Tone, Tone, number])
    .sort((a, b) => b[2] - a[2])
    .slice(0, n)
}
