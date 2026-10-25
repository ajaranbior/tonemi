import { describe, expect, it } from 'vitest'
import { clearRetry, comboWeight, dueRetry, grade, pickByCombo, scheduleRetry, topConfusions, updateStat } from './adapt'

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

  it('grades per syllable and ranks confusions', () => {
    expect(grade([2, 3], [2, 4])).toEqual({ correct: [true, false], all: false })
    expect(grade([1], [1]).all).toBe(true)
    expect(topConfusions({ '3>2': 5, '2>3': 2, '4>1': 9 }, 2)).toEqual([[4, 1, 9], [3, 2, 5]])
  })
})
