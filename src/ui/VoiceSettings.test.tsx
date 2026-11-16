// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { Manifest } from '../bank/types'
import { pickVoice, recordingExcluded, setRecordingExcluded, setTtsEnabled, ttsEnabled } from '../bank/voices'
import { SyntheticVoiceSettings, VoiceSettings } from './VoiceSettings'

const ref = { hop: 0.01, t0: 0, st: [], segments: [] }
const manifest: Manifest = {
  version: 1,
  speakers: {
    human: { name: 'Human', source: '', license: '', range: { lo: 10, hi: 30 } },
    robot: { name: 'Robot', source: '', license: '', range: { lo: 10, hi: 30 }, tts: true },
  },
  items: [{ id: 'settings-word', hanzi: '妈妈', syllables: ['ma', 'ma'], lexical: [1, 0], surface: [1, 0], combo: '10', kind: 'pair', sonorant: true, level: 1,
    speaker: 'human', audio: 'human.mp3', ref, alts: [{ speaker: 'robot', audio: 'robot.mp3', ref }] }],
}
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  setTtsEnabled(false)
  setRecordingExcluded('settings-word', 'robot', false)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('lets Experiments enable only tone pairs and updates the sampler immediately', async () => {
  await act(async () => root.render(<SyntheticVoiceSettings manifest={manifest} />))
  const checkbox = Array.from(container.querySelectorAll('label')).find((el) => el.textContent === 'Tone pairs (2 syllables)')!.querySelector('input')!
  await act(async () => checkbox.click())
  expect(ttsEnabled('pair')).toBe(true)
  expect(ttsEnabled('single')).toBe(false)
  expect(ttsEnabled('triple')).toBe(false)
  expect(pickVoice(manifest, manifest.items[0], undefined, () => 0.99).speaker).toBe('robot')
  expect(JSON.parse(localStorage.getItem('tonemi.v1')!).prefs['voices.tts.pair']).toBe(true)
})

it('persists individual exclusions, shows them after remounting and restores them', async () => {
  setRecordingExcluded('settings-word', 'robot', true)
  expect(JSON.parse(localStorage.getItem('tonemi.v1')!).prefs['voice.excluded.settings-word.robot']).toBe(true)
  await act(async () => root.render(<VoiceSettings manifest={manifest} />))
  expect(container.textContent).toContain('Excluded recordings (1)')
  expect(container.textContent).toContain('妈妈 · Robot')
  await act(async () => root.render(null))
  await act(async () => root.render(<VoiceSettings manifest={manifest} />))
  expect(container.textContent).toContain('Excluded recordings (1)')
  await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Restore')!.click())
  expect(recordingExcluded('settings-word', 'robot')).toBe(false)
  expect(container.textContent).not.toContain('Excluded recordings (1)')
})
