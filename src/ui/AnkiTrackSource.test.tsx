// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AnkiTrackSource } from './AnkiTrackSource'
import { AnkiConnect } from '../anki/connect'

vi.mock('../audio/context', () => ({ audioContext: () => ({}) }))
vi.mock('../audio/resample', () => ({ decodeTo16k: async () => new Float32Array([0.1, 0.2]) }))
let root: Root
let container: HTMLDivElement
const click = async (label: string) => act(async () => {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label)!
  button.click()
})
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  localStorage.clear()
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

it('imports only the chosen Anki attachment and passes its transcript into the shared editor', async () => {
  vi.spyOn(AnkiConnect.prototype, 'requestPermission').mockResolvedValue()
  // Arrow properties are installed per instance; mock invoke rather than prototype properties.
  const invoke = vi.spyOn(AnkiConnect.prototype, 'invoke').mockImplementation(async (action) => {
    if (action === 'deckNames') return ['Chinese']
    if (action === 'findNotes') return [7]
    if (action === 'notesInfo') return [{ noteId: 7, fields: { Sentence: { value: '今天天气很好。', order: 0 }, Audio: { value: '[sound:a.mp3] [sound:b.mp3]', order: 1 } } }]
    if (action === 'retrieveMediaFile') return btoa('audio')
    throw new Error(`Unexpected ${action}`)
  })
  const onLoad = vi.fn().mockResolvedValue(undefined)
  await act(async () => root.render(<AnkiTrackSource busy={false} onLoad={onLoad} />))
  await click('Connect to Anki')
  const deck = container.querySelector<HTMLSelectElement>('[aria-label="Deck"]')!
  await act(async () => { deck.value = 'Chinese'; deck.dispatchEvent(new Event('change', { bubbles: true })) })
  await click('Find audio tracks')
  expect(invoke).toHaveBeenCalledWith('findNotes', { query: 'deck:"Chinese"' })
  expect(invoke.mock.calls.some(([action]) => action === 'retrieveMediaFile')).toBe(false)
  const tracks = [...container.querySelectorAll('button')].filter((b) => b.textContent === 'Import track')
  expect(tracks).toHaveLength(2)
  await act(async () => tracks[1].click())
  expect(invoke.mock.calls.filter(([action]) => action === 'retrieveMediaFile')).toEqual([['retrieveMediaFile', { filename: 'b.mp3' }]])
  expect(onLoad).toHaveBeenCalledWith(expect.any(Float32Array), '今天天气很好。', 'Anki · Chinese · b.mp3')
})
