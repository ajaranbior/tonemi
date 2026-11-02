/** Optional gamification for ear training: daily practice streak, combo and points. */

/** Answers per day (right or wrong) that keep the daily streak going. */
export const DAILY_GOAL = 10

export const POINTS = {
  /** Any answer: effort counts. */
  attempt: 2,
  /** A fully correct answer (includes the attempt points). */
  correct: 10,
  /** Correct on a word you missed a few trials earlier. */
  comeback: 25,
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Days since the most recent Monday (0 on Mondays). */
export function sinceMonday(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number)
  return dayKey(new Date(y, m - 1, d + delta))
}

/**
 * Days in a row that met the goal, ending today (or yesterday while today is still open).
 * One missed day per rolling week is forgiven (a "freeze") when the day before it met the goal.
 */
export function dailyStreak(days: Record<string, number>, today: string, goal = DAILY_GOAL): number {
  const met = (k: string) => (days[k] ?? 0) >= goal
  let day = met(today) ? today : addDays(today, -1)
  let streak = 0
  let lastFreeze = -Infinity
  for (let i = 0; i < 3650; i++, day = addDays(day, -1)) {
    if (met(day)) streak++
    else if (streak > 0 && i - lastFreeze >= 7 && met(addDays(day, -1))) lastFreeze = i
    else break
  }
  return streak
}

export function pointsFor(correct: boolean, comeback: boolean): number {
  return comeback ? POINTS.comeback : correct ? POINTS.correct : POINTS.attempt
}

/** A tone pattern counts as learned once its accuracy reaches this (after enough tries). */
export const GREEN = 0.8
export const GREEN_MIN_TRIES = 5

/** True when this answer pushed a pattern from below into the green. */
export function turnedGreen(before: number | undefined, after: number, n: number): boolean {
  return n >= GREEN_MIN_TRIES && (before ?? 0) < GREEN && after >= GREEN
}
