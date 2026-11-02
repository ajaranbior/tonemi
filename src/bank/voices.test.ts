import { describe, expect, it } from 'vitest'
import type { BankItem, Manifest, RefPitch } from './types'
import { pickVoice, recordings, setTtsEnabled, setVoiceOn, usableItems, voiceCount } from './voices'

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

  it('never leaves the bank empty', () => {
    setVoiceOn('yue', false)
    setTtsEnabled(false)
    expect(usableItems(manifest)).toHaveLength(2)
    setVoiceOn('yue', true)
    setTtsEnabled(true)
  })
})
