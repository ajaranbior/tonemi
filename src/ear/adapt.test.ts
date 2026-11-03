import { describe, expect, it } from 'vitest'
import { adjustStat, clearRetry, comboWeight, duePattern, dueRetry, freshWeight, grade, pickByCombo, scheduleRetry, topConfusions, topPair, updateStat } from './adapt'

describe('ear adaptation', () => {
  it('moves accuracy toward results and weights weak combos higher', () => {
    let s = updateStat(undefined, true)
    expect(s.n).toBe(1)
    expect(s.ema).toBeGreaterThan(0.5)
    for (let i = 0; i < 6; i++) s = updateStat(s, false)
    expect(s.ema).toBeLessThan(0.2)
    expect(comboWeight(s)).toBeGreaterThan(comboWeight({ n: 9, ema: 0.95 }))
    expect(comboWeight({ n: 9, ema: 1 })).toBeGreaterThan(0) // mastered combos still appear
  })

  it('samples weak combos more often than strong ones', () => {
    const items = ['23', '23', '11', '11']
    const stats = { '23': { n: 8, ema: 0.2 }, '11': { n: 8, ema: 0.95 } }
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let weak = 0
    for (let i = 0; i < 400; i++) if (pickByCombo(items, (x) => x, stats, rand) === '23') weak++
    expect(weak).toBeGreaterThan(300)
  })

  it('brings missed items back after a gap, until answered correctly', () => {
    let q = scheduleRetry([], 'a', 5)
    expect(dueRetry(q, 7, () => true)).toBeUndefined()
    expect(dueRetry(q, 8, () => true)).toBe('a')
    expect(dueRetry(q, 8, () => false)).toBeUndefined()
    q = clearRetry(q, 'a')
    expect(dueRetry(q, 99, () => true)).toBeUndefined()
  })

  it('flips a past trial exactly as if it had been answered differently', () => {
    const replay = (results: boolean[]) => results.reduce<ReturnType<typeof updateStat> | undefined>((s, r) => updateStat(s, r), undefined)!
    const actual = replay([false, true, true, false])
    const fixed = adjustStat(actual, 3, true) // three newer trials of the same pattern
    expect(fixed.ema).toBeCloseTo(replay([true, true, true, false]).ema, 10)
    expect(adjustStat(fixed, 3, false).ema).toBeCloseTo(actual.ema, 10)
  })

  it('grades per syllable and ranks confusions', () => {
    expect(grade([2, 3], [2, 4])).toEqual({ correct: [true, false], all: false })
    expect(grade([1], [1]).all).toBe(true)
    expect(topConfusions({ '3>2': 5, '2>3': 2, '4>1': 9 }, 2)).toEqual([[4, 1, 9], [3, 2, 5]])
  })

  it('brings a missed tone pattern back in another word', () => {
    let q = scheduleRetry([], 'w1', 5, '21')
    q = scheduleRetry(q, 'w2', 6, '21') // same pattern missed again: one entry, latest word
    expect(q).toHaveLength(1)
    expect(dueRetry(q, 99, () => true)).toBeUndefined() // not a word retry
    expect(duePattern(q, 8, () => true)).toBeUndefined()
    expect(duePattern(q, 9, () => true)).toEqual({ id: 'w2', due: 9, pattern: '21' })
    expect(duePattern(q, 9, () => false)).toBeUndefined()
    expect(clearRetry(q, '', '21')).toHaveLength(0)
  })

  it('prefers words heard least within a pattern', () => {
    const items = ['a', 'b']
    const heard: Record<string, number> = { a: 0, b: 5 }
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let fresh = 0
    for (let i = 0; i < 400; i++) if (pickByCombo(items, () => 'x', {}, rand, (t) => freshWeight(heard[t])) === 'a') fresh++
    expect(fresh).toBeGreaterThan(360)
  })

  it('finds the most confused pair regardless of direction', () => {
    expect(topPair({ '3>2': 4, '2>3': 3, '4>1': 5 })).toEqual([2, 3])
    expect(topPair({})).toBeNull()
  })
})
