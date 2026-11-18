import type { ItemKind } from '../bank/types'

/**
 * Partial questions: some syllables of a word are given (their tones shown), the rest are asked.
 * The learning path walks from single syllables to naming every tone of a three-syllable word.
 */
export interface PathLevel {
  kind: ItemKind
  /** Number of syllables to name; the others are given. */
  hide: number
  label: string
}

export const PATH: PathLevel[] = [
  { kind: 'single', hide: 1, label: '1 syllable' },
  { kind: 'pair', hide: 1, label: '1 of 2' },
  { kind: 'pair', hide: 2, label: '2 of 2' },
  { kind: 'triple', hide: 1, label: '1 of 3' },
  { kind: 'triple', hide: 2, label: '2 of 3' },
  { kind: 'triple', hide: 3, label: '3 of 3' },
]

/** Answers needed at a level, and the recent accuracy, before the next one opens. */
export const PASS_MIN = 20
export const PASS_SCORE = 0.85
const ALPHA = 0.1
const PRIOR = 0.5

export interface LevelStat {
  n: number
  ema: number
}

export interface PathState {
  /** Level being practised. */
  level: number
  /** Highest level unlocked so far. */
  reached: number
  stats: Record<number, LevelStat>
}

export const newPath = (): PathState => ({ level: 0, reached: 0, stats: {} })

/** Score one answer at the current level; moves up a level (once) when it is passed. */
export function pathAnswer(state: PathState, correct: boolean): { state: PathState; levelUp: boolean } {
  const prev = state.stats[state.level]
  const stat = { n: (prev?.n ?? 0) + 1, ema: (1 - ALPHA) * (prev?.ema ?? PRIOR) + ALPHA * (correct ? 1 : 0) }
  const stats = { ...state.stats, [state.level]: stat }
  const levelUp = passed(stat) && state.level === state.reached && state.level < PATH.length - 1
  const level = levelUp ? state.level + 1 : state.level
  return { state: { level, reached: Math.max(state.reached, level), stats }, levelUp }
}

export const passed = (s: LevelStat | undefined) => !!s && s.n >= PASS_MIN && s.ema >= PASS_SCORE

/** How far the level is toward passing, 0–1: the lower of answer count and accuracy progress. */
export function levelProgress(s: LevelStat | undefined): number {
  if (!s) return 0
  const count = Math.min(1, s.n / PASS_MIN)
  const score = Math.min(1, Math.max(0, (s.ema - PRIOR) / (PASS_SCORE - PRIOR)))
  return Math.min(count, score)
}

/**
 * Which syllables are given (true) for a word of `length` syllables with `hide` asked, chosen at random.
 * Never more asked than syllables, and at least one.
 */
export function givenMask(length: number, hide: number, rand: () => number = Math.random): boolean[] {
  const asked = Math.max(1, Math.min(length, hide))
  const order = Array.from({ length }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const hidden = new Set(order.slice(0, asked))
  return order.map((_, i) => !hidden.has(i))
}

export function parsePath(raw: string): PathState {
  try {
    const p = JSON.parse(raw) as PathState
    if (typeof p.level === 'number' && typeof p.reached === 'number' && p.stats) {
      const clamp = (n: number) => Math.max(0, Math.min(PATH.length - 1, Math.floor(n)))
      return { level: clamp(p.level), reached: clamp(p.reached), stats: p.stats }
    }
  } catch {
    // fall through
  }
  return newPath()
}
