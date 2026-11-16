import { describe, expect, it } from 'vitest'
import { trackPitch, SR } from '../analysis/pitch'
import { trimSilence } from './audio'
import { alignCharacters, makeExercise, selectionLabels } from './editor'
import { ankiTracks } from './anki'
import type { AnkiNote } from '../anki/connect'

const voice = (seconds: number) => Float32Array.from({ length: Math.round(seconds * SR) }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 180 * i / SR))

describe('snippet preparation', () => {
  it('trims quiet edges and long pauses while preserving unvoiced consonants and brief gaps', () => {
    const samples = new Float32Array(4 * SR)
    samples.set(voice(0.7), 0.5 * SR)
    samples.set(voice(0.7), 2.5 * SR)
    samples.fill(0.008, 0.4 * SR, 0.5 * SR) // quiet consonant before voicing
    const trimmed = trimSilence(samples)
    expect(trimmed.length / SR).toBeCloseTo(1.98, 1)
    expect(trimmed.some((v) => v === Math.fround(0.008))).toBe(true)
    expect(() => trimSilence(new Float32Array(SR))).toThrow('No audible speech')
  })
  it('keeps sentence sandhi when taking a word out of its context', () => {
    expect(selectionLabels('我不要这个。', 1, 2)).toMatchObject({ hanzi: '不要', lexical: [4, 4], surface: [2, 4], syllables: ['bu', 'yao'] })
    expect(selectionLabels('你好！', 0, 1)).toMatchObject({ lexical: [3, 3], surface: [2, 3] })
    expect(selectionLabels('重庆很好。', 0, 1).syllables).toEqual(['chong', 'qing'])
  })
  it('uses sentence timestamps and falls back safely after a transcript edit', () => {
    const samples = voice(3)
    const track = trackPitch(samples)
    const transcript = { text: '你好。谢谢。', chunks: [{ text: '你好。', timestamp: [0, 1] as [number, number] }, { text: '谢谢。', timestamp: [2, 3] as [number, number] }] }
    const aligned = alignCharacters(transcript.text, track, 3, transcript)
    expect(aligned.map((c) => c.index)).toEqual([0, 1, 3, 4])
    expect(aligned[1].end).toBeLessThanOrEqual(1)
    expect(aligned[2].start).toBeGreaterThanOrEqual(2)
    const edited = alignCharacters('你好。谢谢你。', track, 3, transcript)
    expect(edited).toHaveLength(5)
    for (const t of edited) { expect(t.start).toBeLessThan(t.end); expect(t.start).toBeGreaterThanOrEqual(0); expect(t.end).toBeLessThanOrEqual(3) }
  })
  it('accepts short single-syllable tracks without requiring a calibration-length recording', () => {
    const samples = voice(0.25)
    const track = trackPitch(samples)
    expect(makeExercise(samples, track, selectionLabels('妈', 0, 0), track).item.kind).toBe('single')
  })
  it('creates a playable bank item with reference pitch, context range and correct length', async () => {
    const samples = voice(1.2)
    const track = trackPitch(samples)
    const labels = selectionLabels('你好。', 0, 1)
    const saved = makeExercise(samples, track, labels, track)
    expect(saved.item).toMatchObject({ kind: 'pair', hanzi: '你好', combo: '33', surface: [2, 3] })
    expect(saved.item.ref.segments).toHaveLength(2)
    expect(saved.item.ref.st.some((s) => s !== null)).toBe(true)
    expect(saved.speaker.range.hi).toBeGreaterThan(saved.speaker.range.lo)
    expect(saved.audio.type).toBe('audio/wav')
    expect(new TextDecoder().decode((await saved.audio.arrayBuffer()).slice(0, 4))).toBe('RIFF')
    expect(() => makeExercise(samples, track, selectionLabels('你好谢谢。', 0, 3), track)).toThrow('1–3')
  })
})

describe('Anki track selection', () => {
  const note: AnkiNote = { noteId: 7, modelName: 'Chinese', tags: [], fields: {
    Sentence: { value: '你好！', order: 0 }, Audio: { value: '[sound:first.mp3] [sound:second.mp3]', order: 1 }, Word: { value: '[sound:first.mp3]', order: 2 },
  } }
  it('lists all attachments once per note with a card transcript', () => {
    expect(ankiTracks([note]).map((t) => [t.filename, t.text])).toEqual([['first.mp3', '你好！'], ['second.mp3', '你好！']])
    expect(ankiTracks([note], 'Word')).toHaveLength(1)
  })
  it('supports audio-only notes so they can go through speech recognition', () => {
    expect(ankiTracks([{ ...note, fields: { Audio: note.fields.Audio } }])).toMatchObject([{ text: '', filename: 'first.mp3' }, { text: '', filename: 'second.mp3' }])
  })
})
