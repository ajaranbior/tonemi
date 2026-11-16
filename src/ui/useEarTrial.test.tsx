// @vitest-environment happy-dom
import { act, useLayoutEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tone } from '../analysis/tones'
import { getEarCombos, getEarConfusions, getEarSeen } from '../store'
import { useEarControls, useEarTrial, type TrialSource } from './useEarTrial'

vi.mock('../audio/sfx', () => ({ FEEDBACK_SECONDS: 0.2, playFeedback: vi.fn() }))

interface Item { id: string; tones: Tone[] }
const source: TrialSource<Item> = { id: (i) => i.id, tones: (i) => i.tones }
const bankSource = { ...source, seenKey: (i: Item) => i.id }
const first: Item = { id: 'trial-first', tones: [1, 4] }
let session: ReturnType<typeof useEarTrial<Item>>
let controls: ReturnType<typeof useEarControls<Item>>
let setItem: (i: Item) => void
let root: Root
let container: HTMLDivElement
const onAnswered = vi.fn()
const onOverride = vi.fn()
const listen = vi.fn()
const advance = vi.fn()

function Harness({ bank = false, patterns = false }: { bank?: boolean; patterns?: boolean }) {
  const [item, update] = useState(first)
  const currentSession = useEarTrial(item, bank ? bankSource : source, { onAnswered, onOverride, game: true }, patterns)
  const currentControls = useEarControls(currentSession, (answers) => { currentSession.submit(answers) }, advance, listen)
  useLayoutEffect(() => { setItem = update; session = currentSession; controls = currentControls }, [update, currentSession, currentControls])
  return null
}

const key = (value: string, target: EventTarget = window) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })) })
const start = (item = first) => act(() => { setItem(item); session.reset(item.tones) })
const mount = (bank = false, patterns = false) => {
  act(() => root.render(<Harness bank={bank} patterns={patterns} />))
  start()
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('shared Ear trials', () => {
  it('enters tones, undoes, checks once, and ignores shortcuts in form fields', () => {
    mount()
    act(() => session.setAutoReveal(false))
    key('0')
    expect(session.chosen).toEqual([null, null])
    key('1')
    key('5')
    expect(session.chosen).toEqual([1, 0])
    key('Backspace')
    expect(session.chosen).toEqual([1, null])
    const input = document.createElement('input')
    container.append(input)
    key('4', input)
    expect(session.chosen).toEqual([1, null])
    key('4')
    key('Enter')
    expect(session.answered).toBe(true)
    expect(onAnswered).toHaveBeenCalledExactlyOnceWith(true, expect.objectContaining({ comeback: false }))
    act(() => { session.submit(); session.submit() })
    expect(onAnswered).toHaveBeenCalledTimes(1)
    key('Enter')
    expect(advance).toHaveBeenCalledOnce()
    key('r')
    expect(listen).toHaveBeenCalledOnce()
  })

  it('shares auto reveal, scoring, retries, overrule and undo-overrule with clips', () => {
    mount()
    act(() => session.setAutoReveal(true))
    const before = getEarCombos()['14']?.n ?? 0
    const confusion = getEarConfusions()['4>3'] ?? 0
    act(() => controls.pick(0, 1))
    act(() => controls.pick(1, 3))
    expect(session.answered).toBe(true)
    expect(getEarCombos()['14'].n).toBe(before + 1)
    expect(getEarConfusions()['4>3']).toBe(confusion + 1)
    expect(session.retry.current).toEqual([{ id: first.id, due: 4 }])
    const ema = getEarCombos()['14'].ema
    key('m')
    expect(session.accepted).toBe(true)
    expect(session.retry.current).toEqual([])
    expect(getEarConfusions()['4>3'] ?? 0).toBe(confusion)
    key('m')
    expect(session.accepted).toBe(false)
    expect(getEarCombos()['14'].ema).toBeCloseTo(ema)
    expect(onOverride.mock.calls).toEqual([[1], [-1]])
  })

  it('keeps bank first-listen tracking, pattern retries and comeback scoring', () => {
    mount(true, true)
    act(() => session.submit([1, 3]))
    expect(getEarSeen()[first.id].n).toBe(1)
    expect(session.retry.current[0].pattern).toBe('14')
    act(() => session.archive())
    start({ id: 'another-word', tones: [1, 4] })
    act(() => session.submit([1, 4]))
    expect(session.comeback).toBe(true)
    expect(session.retry.current).toEqual([])
    expect(onAnswered).toHaveBeenLastCalledWith(true, expect.objectContaining({ comeback: true }))
  })

  it('reviews without editing the live answer, and adjusts older scores by later trials', () => {
    mount()
    act(() => session.submit([1, 3]))
    act(() => { session.archive(); session.archive() })
    expect(session.review.count).toBe(1)
    start({ id: 'later', tones: [1, 4] })
    act(() => session.submit([1, 4]))
    const ema = getEarCombos()['14'].ema
    key('ArrowLeft')
    expect(session.rv?.item.id).toBe(first.id)
    key('m')
    expect(getEarCombos()['14'].ema).toBeCloseTo(Math.min(1, ema + 0.3 * 0.7))
    key('m')
    expect(getEarCombos()['14'].ema).toBeCloseTo(ema)
    key('Enter')
    expect(session.rv).toBe(null)
    expect(session.chosen).toEqual([1, 4])
  })

  it('bounds review history and cancels delayed replays on navigation and unmount', () => {
    vi.useFakeTimers()
    mount()
    const replay = vi.fn()
    act(() => session.submit([1, 4]))
    act(() => session.archive())
    start({ id: 'live', tones: [2] })
    act(() => session.afterFeedback(replay))
    act(() => session.review.back())
    act(() => vi.runAllTimers())
    expect(replay).not.toHaveBeenCalled()
    key('Backspace')
    expect(session.chosen).toEqual([null])
    act(() => session.review.leave())
    for (let i = 0; i < 55; i++) {
      start({ id: String(i), tones: [2] })
      act(() => session.submit([2]))
      act(() => session.archive())
    }
    expect(session.review.count).toBe(50)
    expect(session.review.history[0].item.id).toBe('5')
    act(() => session.afterFeedback(replay))
    act(() => root.render(null))
    act(() => vi.runAllTimers())
    expect(replay).not.toHaveBeenCalled()
  })
})
