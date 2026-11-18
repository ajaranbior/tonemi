import { describe, expect, it } from 'vitest'
import { givenMask, levelProgress, newPath, parsePath, PASS_MIN, PATH, pathAnswer } from './path'

describe('learning path', () => {
  it('asks exactly `hide` syllables and gives the rest', () => {
    for (let s = 0; s < 20; s++) {
      const m = givenMask(3, 1, () => (s % 10) / 10)
      expect(m.filter((g) => !g)).toHaveLength(1)
    }
    expect(givenMask(3, 2).filter((g) => !g)).toHaveLength(2)
    expect(givenMask(2, 5)).toEqual([false, false])
    expect(givenMask(1, 1)).toEqual([false])
  })

  it('moves up only after enough answers at a high enough score', () => {
    let state = newPath()
    let ups = 0
    for (let i = 0; i < PASS_MIN - 1; i++) ({ state } = pathAnswer(state, true))
    expect(state.level).toBe(0)
    let r = pathAnswer(state, true)
    ups += Number(r.levelUp)
    state = r.state
    expect(ups).toBe(1)
    expect(state.level).toBe(1)
    expect(state.reached).toBe(1)
    // Practising an earlier, already passed level never jumps ahead again.
    r = pathAnswer({ ...state, level: 0 }, true)
    expect(r.levelUp).toBe(false)
    expect(r.state.level).toBe(0)
    expect(r.state.reached).toBe(1)
  })

  it('does not pass with poor accuracy', () => {
    let state = newPath()
    for (let i = 0; i < 60; i++) state = pathAnswer(state, i % 2 === 0).state
    expect(state.level).toBe(0)
    expect(levelProgress(state.stats[0])).toBeLessThan(1)
  })

  it('stays on the last level', () => {
    let state = { ...newPath(), level: PATH.length - 1, reached: PATH.length - 1 }
    for (let i = 0; i < 40; i++) state = pathAnswer(state, true).state
    expect(state.level).toBe(PATH.length - 1)
  })

  it('reads saved state defensively', () => {
    expect(parsePath('nope')).toEqual(newPath())
    expect(parsePath(JSON.stringify({ level: 99, reached: 99, stats: {} })).level).toBe(PATH.length - 1)
  })
})
