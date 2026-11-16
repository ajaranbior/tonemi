// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ShadowPage from './ShadowPage'

vi.mock('../audio/context', () => ({ audioContext: () => ({}) }))
vi.mock('../audio/resample', () => ({ decodeTo16k: async () => new Float32Array(0) }))
vi.mock('../analysis/trackInWorker', () => ({ trackInWorker: async () => ({ hop: 0.01, hz: new Float32Array(0), rms: new Float32Array(0), zcr: new Float32Array(0), creak: new Uint8Array(0) }) }))

let root: Root
let container: HTMLDivElement
let paused: boolean
let frame: FrameRequestCallback
let play: ReturnType<typeof vi.spyOn>
const button = (text: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)!
const tick = async () => act(async () => { container.querySelector('audio')!.currentTime = 1; frame(0) })
const toggle = () => act(() => {
  const input = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === 'Loop line')!.querySelector('input')!
  input.click()
})

async function load(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.useFakeTimers()
  paused = true
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => { paused = true })
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => { paused = false })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<ShadowPage range={{ lo: 10, hi: 30 }} />))
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type=file]')
  await load(inputs[0], new File(['audio'], 'speech.mp3', { type: 'audio/mp3' }))
  await load(inputs[1], new File(['1\n00:00:00,000 --> 00:00:01,000\n你好\n'], 'speech.srt'))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Shadow loop controls', () => {
  it('turns looping off during the line and returns to idle after the current play', async () => {
    toggle()
    await act(async () => button('▶ Line').click())
    toggle()
    await tick()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(play).toHaveBeenCalledTimes(1)
    expect(button('▶ Line')).toBeDefined()
  })

  it('turns looping off during the pause between repeats', async () => {
    toggle()
    await act(async () => button('▶ Line').click())
    await tick()
    expect(button('■ Stop')).toBeDefined()
    toggle()
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(play).toHaveBeenCalledTimes(1)
    expect(button('▶ Line')).toBeDefined()
  })

  it('can enable looping mid-line and Stop still ends it', async () => {
    await act(async () => button('▶ Line').click())
    toggle()
    await tick()
    await act(async () => vi.advanceTimersByTimeAsync(600))
    expect(play).toHaveBeenCalledTimes(2)
    act(() => button('■ Stop').click())
    await tick()
    expect(button('▶ Line')).toBeDefined()
    await act(async () => vi.advanceTimersByTimeAsync(1000))
    expect(play).toHaveBeenCalledTimes(2)
  })
})
