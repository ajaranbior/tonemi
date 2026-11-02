import { describe, expect, it } from 'vitest'
import { AUTO, NONE, noteClip, plainText, sample, soundFiles, type AnkiNote } from './connect'
import { stitch, wavBlob } from './stitch'

const note = (fields: Record<string, string>): AnkiNote => ({
  noteId: 1,
  modelName: 'Basic',
  tags: [],
  fields: Object.fromEntries(Object.entries(fields).map(([k, value], order) => [k, { value, order }])),
})

describe('anki fields', () => {
  it('finds sound tags', () => {
    expect(soundFiles('x [sound:a b.mp3] y [sound:c&amp;d.ogg]')).toEqual(['a b.mp3', 'c&d.ogg'])
    expect(soundFiles('no audio')).toEqual([])
  })

  it('strips html, ruby readings and sound tags', () => {
    expect(plainText('<div>你好<br>世界</div>[sound:x.mp3]&nbsp;!')).toBe('你好 世界 !')
    expect(plainText('<ruby>中<rt>zhōng</rt></ruby><ruby>国<rt>guó</rt></ruby>')).toBe('中国')
  })

  it('picks the audio and Chinese text automatically', () => {
    const n = note({ English: 'hello', Pinyin: 'nǐ hǎo', Hanzi: '<b>你好</b>', Audio: '[sound:nihao.mp3]' })
    expect(noteClip(n)).toEqual({ noteId: 1, audio: 'nihao.mp3', text: '你好' })
  })

  it('honours chosen fields and skips notes without audio or Chinese', () => {
    const n = note({ Front: '你好 [sound:a.mp3]', Sentence: '我很好。', SentenceAudio: '[sound:b.mp3]' })
    expect(noteClip(n, 'SentenceAudio', 'Sentence')).toEqual({ noteId: 1, audio: 'b.mp3', text: '我很好。' })
    expect(noteClip(n)?.text).toBe('我很好。')
    expect(noteClip(note({ Front: 'hello', Back: 'world' }))).toBeNull()
    expect(noteClip(note({ Front: 'hello', Audio: '[sound:a.mp3]' }))).toBeNull()
  })

  it('finds the word being learned in the sentence, with tones from its pinyin', () => {
    const n = note({ Word: '学习 xuéxí', Sentence: '我在<b>学习</b>中文。', Audio: '[sound:s.mp3]' })
    expect(noteClip(n)).toEqual({ noteId: 1, audio: 's.mp3', text: '我在学习中文。', word: '学习', focus: [2, 4], wordTones: [2, 2] })
    expect(noteClip(n, AUTO, AUTO, NONE)).toEqual({ noteId: 1, audio: 's.mp3', text: '我在学习中文。' })
    const missing = note({ Word: '学习 xuéxí', Sentence: '我在读书。', Audio: '[sound:s.mp3]' })
    expect(noteClip(missing, AUTO, AUTO, 'Word')).toMatchObject({ word: '学习', focus: undefined })
    expect(noteClip(missing)?.word).toBeUndefined()
  })

  it('samples without repeats, in order', () => {
    const s = sample([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)
    expect(s).toHaveLength(4)
    expect(new Set(s).size).toBe(4)
    expect([...s].sort((a, b) => a - b)).toEqual(s)
    expect(sample([1, 2], 5)).toEqual([1, 2])
  })
})

describe('stitching', () => {
  it('joins clips with gaps and one cue each', () => {
    const { samples, cues } = stitch(
      [
        { samples: new Float32Array(10).fill(1), text: '一' },
        { samples: new Float32Array(20).fill(1), text: '二' },
      ],
      10,
      1,
    )
    expect(samples.length).toBe(10 + 10 + 10 + 20 + 10)
    expect(cues).toEqual([
      { start: 1, end: 2, text: '一' },
      { start: 3, end: 5, text: '二' },
    ])
    expect(samples[9]).toBe(0)
    expect(samples[10]).toBe(1)
  })

  it('writes a wav header', () => {
    expect(wavBlob(new Float32Array(100), 16000).size).toBe(244)
  })
})
