import type { EarStat } from '../store'
import type { Tone } from '../analysis/tones'

/** Accuracy assumed for a combo that has never been tried. */
const PRIOR = 0.5
const ALPHA = 0.3

export function updateStat(prev: EarStat | undefined, allCorrect: boolean): EarStat {
  const ema = prev ? prev.ema : PRIOR
  return { n: (prev?.n ?? 0) + 1, ema: (1 - ALPHA) * ema + ALPHA * (allCorrect ? 1 : 0) }
}

/**
 * Re-score one past trial after the learner overruled (or un-overruled) the answer key. A trial
 * contributes ALPHA·(1-ALPHA)^later to the moving average, where `later` counts newer trials of the
 * same pattern, so its result can be flipped without replaying history.
 */
export function adjustStat(stat: EarStat, later: number, toCorrect: boolean): EarStat {
  const weight = ALPHA * (1 - ALPHA) ** later
  return { n: stat.n, ema: Math.min(1, Math.max(0, stat.ema + (toCorrect ? weight : -weight))) }
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

/**
 * Combos are chosen first (by weakness), then an item within the combo, so rare combos aren't drowned
 * out. `itemWeight` biases the second step (e.g. toward words heard least); uniform by default.
 */
export function pickByCombo<T>(
  items: T[],
  comboOf: (t: T) => string,
  stats: Record<string, EarStat>,
  rand: () => number = Math.random,
  itemWeight?: (t: T) => number,
): T | undefined {
  const combos = [...new Set(items.map(comboOf))]
  const combo = pickWeighted(combos, (c) => comboWeight(stats[c]), rand)
  const pool = items.filter((i) => comboOf(i) === combo)
  return itemWeight ? pickWeighted(pool, itemWeight, rand) : pool[Math.floor(rand() * pool.length)]
}

/** Item weight from how often it was answered: a never-heard word is 9× as likely as one heard twice. */
export const freshWeight = (timesHeard: number) => 1 / (1 + timesHeard) ** 2

/**
 * Missed items come back after a few other trials until they are answered correctly. With `pattern`
 * set, what comes back is the tone pattern (in another word), and `id` is the word that was missed.
 */
export interface Retry {
  id: string
  due: number
  pattern?: string
}

export const RETRY_GAP = 3

export function scheduleRetry(queue: Retry[], id: string, trial: number, pattern?: string): Retry[] {
  const rest = queue.filter((r) => (pattern ? r.pattern !== pattern : r.id !== id))
  return [...rest, pattern ? { id, due: trial + RETRY_GAP, pattern } : { id, due: trial + RETRY_GAP }]
}

/** Drop the retry for a word, or for a tone pattern when `pattern` is given. */
export function clearRetry(queue: Retry[], id: string, pattern?: string): Retry[] {
  return queue.filter((r) => r.id !== id && (pattern === undefined || r.pattern !== pattern))
}

export function dueRetry(queue: Retry[], trial: number, avail: (id: string) => boolean): string | undefined {
  return queue.find((r) => !r.pattern && r.due <= trial && avail(r.id))?.id
}

/** The first due pattern retry that `avail` can serve. */
export function duePattern(queue: Retry[], trial: number, avail: (r: Retry) => boolean): Retry | undefined {
  return queue.find((r) => r.pattern && r.due <= trial && avail(r))
}

/** Unordered tone pair of the most frequent confusion, e.g. [2, 3]; null when there are none. */
export function topPair(conf: Record<string, number>): [Tone, Tone] | null {
  const totals = new Map<string, number>()
  for (const [k, c] of Object.entries(conf)) {
    const a = Number(k[0])
    const b = Number(k[2])
    if (a === b) continue
    const key = a < b ? `${a}${b}` : `${b}${a}`
    totals.set(key, (totals.get(key) ?? 0) + c)
  }
  const best = [...totals].sort((x, y) => y[1] - x[1])[0]
  return best ? [Number(best[0][0]) as Tone, Number(best[0][1]) as Tone] : null
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

/** How much of the word to play before answering, from accuracy on its tone pattern (melody-first mode). */
export type Melody = 'hum' | 'muffled' | 'full'

export function melodyLevel(stat: EarStat | undefined): Melody {
  if (!stat || stat.n < 3) return 'muffled'
  return stat.ema < 0.6 ? 'hum' : stat.ema < 0.85 ? 'muffled' : 'full'
}
