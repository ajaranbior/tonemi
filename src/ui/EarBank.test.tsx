// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankItem } from '../bank/types'
import { setPref } from '../store'
import { EarBank } from './EarBank'
import { playUrl } from '../audio/playback'
import { prepareItem, type EarItem } from './earItem'

const { base, manifest } = vi.hoisted(() => {
  const base = { id: 'word', hanzi: '你好', speaker: 'test', syllables: ['ni', 'hao'], surface: [2, 3], lexical: [3, 3], kind: 'pair', audio: 'audio/word.mp3', ref: { t0: 0, hop: 0.01, st: [20, 25], segments: [[0, 1], [1, 2]] } }
  return { base, manifest: { items: [base], speakers: { test: { range: { lo: 10, hi: 30 } } } } }
})
vi.mock('../bank/load', () => ({ loadManifest: async () => manifest, audioUrl: () => 'audio/word.mp3', refChao: () => new Float32Array(2) }))
vi.mock('../bank/voices', () => ({ usableItems: () => [base], pickVoice: () => base, voiceCount: () => 2, manyVoices: () => true, voiceLabel: () => 'test', useVoiceVersion: () => 0, recordingExcluded: () => false, setRecordingExcluded: vi.fn() }))
vi.mock('./earItem', async (original) => ({ ...await original<typeof import('./earItem')>(), prepareItem: vi.fn() }))
vi.mock('../flags', () => ({ useFlag: () => false }))
vi.mock('./useSamples', () => ({ useSamples: () => null }))
vi.mock('./EarStage', () => ({ EarStage: () => null, ResultChip: () => null }))
vi.mock('./PitchPlot', () => ({ PitchPlot: () => null }))
vi.mock('./VoiceSettings', () => ({ VoiceSettings: () => null }))
vi.mock('../audio/playback', () => ({ playUrl: vi.fn(async () => {}), stopPlayback: vi.fn(), playSequence: async () => {}, wavUrl: () => 'blob:unused' }))

let root: Root
let container: HTMLDivElement
let revoke: ReturnType<typeof vi.spyOn>
const generated = (n: number): EarItem => ({ ...base as BankItem, from: base as BankItem, seenKey: base.id, url: `blob:retone-${n}`, qUrl: `blob:melody-${n}` })
const button = (text: string) => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)!
const click = (text: string) => act(async () => button(text).click())
const resolveQuestion = async (n: number) => {
  let resolve!: (item: EarItem) => void
  vi.mocked(prepareItem).mockImplementationOnce(() => new Promise((r) => { resolve = r }))
  await click('Skip →')
  return () => act(async () => resolve(generated(n)))
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setPref('ear.kind', 'pair')
  setPref('ear.sound', false)
  setPref('ear.auto', true)
  vi.clearAllMocks()
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.mocked(prepareItem).mockResolvedValue(generated(0))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root.render(<EarBank onAnswered={vi.fn()} onOverride={vi.fn()} game={false} onGame={vi.fn()} />))
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('EarBank review', () => {
  it('replays the current question when stepping forward out of review', async () => {
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' })))
    vi.mocked(prepareItem).mockResolvedValueOnce(generated(1))
    await click('Next →')
    await click('← Back')
    vi.mocked(playUrl).mockClear()
    await click('Next →')
    expect(container.textContent).not.toContain('Review')
    expect(playUrl).toHaveBeenCalledTimes(1)
    expect(vi.mocked(playUrl).mock.calls[0][0]).toBe('blob:melody-1')
  })
})

describe('EarBank generated audio', () => {
  it('releases skipped questions and superseded preparations', async () => {
    const stale = await resolveQuestion(1)
    const latest = await resolveQuestion(2)
    await latest()
    expect(revoke.mock.calls.flat()).toEqual(['blob:retone-0', 'blob:melody-0'])
    await stale()
    expect(revoke.mock.calls.flat()).toEqual(['blob:retone-0', 'blob:melody-0', 'blob:retone-1', 'blob:melody-1'])
    act(() => root.render(null))
    expect(revoke.mock.calls.flat()).toContain('blob:retone-2')
    expect(revoke.mock.calls.flat()).toContain('blob:melody-2')
  })

  it('keeps answered audio for review and frees it along with late preparations on unmount', async () => {
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' })))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' })))
    vi.mocked(prepareItem).mockResolvedValueOnce(generated(1))
    await click('Next →')
    expect(revoke).not.toHaveBeenCalled()
    await click('← Back')
    expect(container.textContent).toContain('Review 1 of 1')
    await click('Next →')
    const late = await resolveQuestion(2)
    act(() => root.render(null))
    await late()
    expect(revoke.mock.calls.flat().sort()).toEqual([0, 1, 2].flatMap((n) => [`blob:melody-${n}`, `blob:retone-${n}`]).sort())
  })
})
