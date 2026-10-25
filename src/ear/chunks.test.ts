import { describe, expect, it } from 'vitest'
import type { PitchTrack } from '../analysis/pitch'
import { buildClips, charTimes, hanIndex, phraseSizes, wordRanges } from './chunks'

const text = (t: string, r: { from: number; to: number }) => [...t].slice(r.from, r.to).join('')

describe('clip building', () => {
  it('splits Chinese into words', () => {
    const t = '我今天去图书馆学习汉语'
    expect(wordRanges(t).map((r) => text(t, r))).toEqual(['我', '今天', '去', '图书', '馆', '学习', '汉语'])
  })

  it('groups words, never across punctuation, and caps syllables', () => {
    const t = '我今天去图书馆，学习汉语。'
    expect(buildClips(t, 2).map((r) => text(t, r))).toEqual(['我今天', '去图书', '馆', '学习汉语'])
    expect(buildClips(t, 0).map((r) => text(t, r))).toEqual(['我今天去图书', '馆', '学习汉语'])
    expect(buildClips(t, 1).map((r) => text(t, r))).toEqual(['我', '今天', '去', '图书', '馆', '学习', '汉语'])
  })

  it('counts phrases and Han characters', () => {
    expect(phraseSizes('你好，世界！ OK 再见')).toEqual([2, 2, 2])
    expect(hanIndex('a你b好')).toEqual([-1, 0, -1, 1])
  })
})

/** Voiced "syllables" of the given frame lengths separated by short energy dips or long pauses. */
function track(parts: { len: number; gap: number }[]): PitchTrack {
  const total = parts.reduce((a, p) => a + p.len + p.gap, 0) + 20
  const hz = new Float32Array(total).fill(NaN)
  const rms = new Float32Array(total).fill(0.001)
  let i = 10
  for (const p of parts) {
    for (let k = 0; k < p.len; k++, i++) {
      hz[i] = 200
      rms[i] = 0.1 * Math.min(1, 0.3 + Math.sin((Math.PI * (k + 0.5)) / p.len))
    }
    i += p.gap
  }
  return { hop: 0.01, hz, rms, zcr: new Float32Array(total).fill(0.05), creak: new Uint8Array(total) }
}

describe('character timing', () => {
  it('spreads characters over the speech and snaps to energy valleys', () => {
    // three equal syllables of 20 frames, continuous speech
    const t = track([{ len: 20, gap: 0 }, { len: 20, gap: 0 }, { len: 20, gap: 0 }])
    const ct = charTimes(t, 0, t.hz.length, [3])!
    expect(ct.start).toHaveLength(3)
    expect(ct.start[0]).toBe(10)
    expect(ct.end[2]).toBe(70)
    expect(Math.abs(ct.end[0] - 30)).toBeLessThanOrEqual(1)
    expect(Math.abs(ct.end[1] - 50)).toBeLessThanOrEqual(1)
  })

  it('gives each punctuation-separated phrase its own section when pauses match', () => {
    // 2 chars, long pause, 3 chars: a 40/60 split would put the break in the wrong place
    const t = track([{ len: 40, gap: 40 }, { len: 60, gap: 0 }])
    const ct = charTimes(t, 0, t.hz.length, [2, 3])!
    expect(ct.end[1]).toBe(50)
    expect(ct.start[2]).toBe(90)
    expect(ct.end[4]).toBe(150)
  })

  it('returns null without speech', () => {
    const t = track([])
    expect(charTimes(t, 0, t.hz.length, [2])).toBeNull()
  })
})
