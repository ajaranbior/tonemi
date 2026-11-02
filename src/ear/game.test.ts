import { describe, expect, it } from 'vitest'
import { addDays, dailyStreak, dayKey, pointsFor, turnedGreen } from './game'

const days = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, 10]))

describe('ear game', () => {
  it('formats and shifts local days across month ends', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('counts consecutive goal days, keeping yesterday alive while today is open', () => {
    expect(dailyStreak({}, '2026-11-02')).toBe(0)
    expect(dailyStreak(days('2026-11-01', '2026-10-31'), '2026-11-02')).toBe(2)
    expect(dailyStreak(days('2026-11-02', '2026-11-01'), '2026-11-02')).toBe(2)
    expect(dailyStreak({ '2026-11-02': 3, ...days('2026-11-01') }, '2026-11-02')).toBe(1)
  })

  it('forgives one missed day a week, not two in a row', () => {
    expect(dailyStreak(days('2026-11-02', '2026-10-31', '2026-10-30'), '2026-11-02')).toBe(3)
    expect(dailyStreak(days('2026-11-02', '2026-10-30'), '2026-11-02')).toBe(1)
    // two single gaps within a week: only the first is forgiven
    expect(dailyStreak(days('2026-11-02', '2026-10-31', '2026-10-29'), '2026-11-02')).toBe(2)
  })

  it('scores effort, correctness and comebacks', () => {
    expect(pointsFor(false, false)).toBeGreaterThan(0)
    expect(pointsFor(true, false)).toBeGreaterThan(pointsFor(false, false))
    expect(pointsFor(true, true)).toBeGreaterThan(pointsFor(true, false))
  })

  it('detects a pattern turning green only once enough tries exist', () => {
    expect(turnedGreen(0.7, 0.85, 6)).toBe(true)
    expect(turnedGreen(0.85, 0.9, 6)).toBe(false)
    expect(turnedGreen(0.7, 0.85, 3)).toBe(false)
  })
})
