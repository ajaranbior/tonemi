import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BankItem, Manifest, RefPitch } from './types'
import { pickVoice, recordingExcluded, recordings, setRecordingExcluded, setTtsEnabled, setTtsKindEnabled, setVoiceOn, usableItems, voiceCount } from './voices'

const ref: RefPitch = { hop: 0.01, t0: 0, st: [], segments: [] }
const word = (id: string, speaker: string, alts: string[] = []): BankItem => ({
  id, hanzi: '妈', syllables: ['ma'], lexical: [1], surface: [1], combo: '1', kind: 'single', sonorant: true, level: 1,
  speaker, audio: `${speaker}/${id}.mp3`, ref, alts: alts.map((s) => ({ speaker: s, audio: `${s}/${id}.mp3`, ref })),
})
const speaker = (tts: boolean) => ({ name: 'x', source: '', license: '', range: { lo: 10, hi: 20 }, tts })
const manifest: Manifest = {
  version: 1,
  speakers: { yue: speaker(false), f1: speaker(true), m1: speaker(true) },
  items: [word('a', 'yue', ['f1', 'm1']), word('b', 'f1', ['m1'])],
}

describe('voices', () => {
  beforeEach(() => {
    setTtsEnabled(true)
    setVoiceOn('yue', true)
    setVoiceOn('m1', true)
  })
  afterEach(() => {
    for (const item of manifest.items) for (const rec of recordings(item)) setRecordingExcluded(item.id, rec.speaker, false)
  })

  it('starts with synthetic voices disabled in every category, ignoring the old master preference', async () => {
    vi.resetModules()
    const { setPref } = await import('../store')
    setPref('voices.tts', true)
    const { ttsEnabled } = await import('./voices')
    expect(['single', 'pair', 'triple'].map((k) => ttsEnabled(k as 'single' | 'pair' | 'triple'))).toEqual([false, false, false])
  })

  it('lists the own recording first', () => {
    expect(recordings(manifest.items[0]).map((r) => r.speaker)).toEqual(['yue', 'f1', 'm1'])
  })

  it('avoids the previous voice and keeps the id', () => {
    for (let k = 0; k < 10; k++) {
      const v = pickVoice(manifest, manifest.items[0], 'yue')
      expect(v.id).toBe('a')
      expect(v.speaker).not.toBe('yue')
      expect(v.audio).toBe(`${v.speaker}/a.mp3`)
    }
  })

  it('re-voices from the bank entry, not the re-voiced copy', () => {
    const asF1 = pickVoice(manifest, manifest.items[0], undefined, () => 0.5)
    expect(asF1.speaker).toBe('f1')
    expect(new Set(Array.from({ length: 30 }, () => pickVoice(manifest, asF1).speaker))).toEqual(new Set(['yue', 'f1', 'm1']))
  })

  it('switching synthetic voices off hides TTS-only words and voices', () => {
    setTtsEnabled(false)
    expect(usableItems(manifest).map((i) => i.id)).toEqual(['a'])
    expect(voiceCount(manifest, manifest.items[0])).toBe(1)
    expect(pickVoice(manifest, manifest.items[0]).speaker).toBe('yue')
    setTtsEnabled(true)
    setVoiceOn('m1', false)
    expect(voiceCount(manifest, manifest.items[0])).toBe(2)
    setVoiceOn('m1', true)
  })

  it('falls back to human recordings when all voices are off', () => {
    setVoiceOn('yue', false)
    setTtsEnabled(false)
    expect(usableItems(manifest).map((i) => i.id)).toEqual(['a'])
    expect(pickVoice(manifest, manifest.items[0], undefined, () => 0.99).speaker).toBe('yue')
    setVoiceOn('yue', true)
    setTtsEnabled(true)
  })

  it('enables synthetic voices only for the chosen syllable category', () => {
    setTtsEnabled(false)
    setTtsKindEnabled('pair', true)
    const mixed: Manifest = { ...manifest, items: [manifest.items[0], { ...manifest.items[0], id: 'pair', kind: 'pair' }, { ...manifest.items[0], id: 'triple', kind: 'triple' }] }
    expect(mixed.items.map((i) => voiceCount(mixed, i))).toEqual([1, 3, 1])
    expect(pickVoice(mixed, mixed.items[0], undefined, () => 0.99).speaker).toBe('yue')
    expect(pickVoice(mixed, mixed.items[1], undefined, () => 0.99).speaker).toBe('m1')
  })

  it('excludes only the selected word and voice, including re-voiced items and retries', () => {
    setRecordingExcluded('a', 'm1', true)
    expect(recordingExcluded('a', 'm1')).toBe(true)
    expect(voiceCount(manifest, manifest.items[0])).toBe(2)
    expect(pickVoice(manifest, manifest.items[0], 'f1', () => 0.99).speaker).toBe('yue')
    expect(pickVoice(manifest, { ...manifest.items[0], speaker: 'm1' }, undefined, () => 0.99).speaker).toBe('f1')
    expect(pickVoice(manifest, manifest.items[1], undefined, () => 0.99).speaker).toBe('m1')
    setTtsEnabled(false)
    setTtsEnabled(true)
    expect(voiceCount(manifest, manifest.items[0])).toBe(2)
    setRecordingExcluded('a', 'm1', false)
    expect(voiceCount(manifest, manifest.items[0])).toBe(3)
  })

  it('never falls back to excluded recordings, even if the last human recording is excluded', () => {
    setTtsEnabled(false)
    setRecordingExcluded('a', 'yue', true)
    expect(usableItems(manifest)).toEqual([])
    expect(() => pickVoice(manifest, manifest.items[0])).toThrow('No enabled recordings')
  })
})
