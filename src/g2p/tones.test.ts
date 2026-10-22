import { describe, expect, it } from 'vitest'
import { lexicalTones, markTone, sentenceTones, surfaceTones } from './tones'

const surface = (w: string) => surfaceTones([...w], lexicalTones(w)).tones

describe('tones', () => {
  it('applies neutral overrides and suffixes', () => {
    expect(lexicalTones('朋友')).toEqual([2, 0])
    expect(lexicalTones('桌子')).toEqual([1, 0])
    expect(lexicalTones('妈妈')).toEqual([1, 0])
  })
  it('applies 3-3 sandhi', () => {
    expect(surface('你好')).toEqual([2, 3])
    expect(surfaceTones([...'展览馆'], [3, 3, 3])).toEqual({ tones: [2, 2, 3], approximate: true })
  })
  it('applies 一 and 不 sandhi', () => {
    expect(surface('不对')).toEqual([2, 4])
    expect(surface('一样')).toEqual([2, 4])
    expect(surface('一天')).toEqual([4, 1])
    expect(surface('第一')).toEqual([4, 1])
    expect(surface('看一看')).toEqual([4, 0, 4])
  })
  it('marks tones', () => {
    expect(markTone('hao', 3)).toBe('hǎo')
    expect(markTone('gui', 4)).toBe('guì')
    expect(markTone('liu', 2)).toBe('liú')
    expect(markTone('lv', 4)).toBe('lǜ')
    expect(markTone('ma', 0)).toBe('ma')
  })
  it('handles running text', () => {
    const r = sentenceTones('我的朋友, 你好!')
    expect(r.tones).toEqual([3, 0, 2, 0, null, null, 2, 3, null])
  })
})
