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
  it('keeps 一 in digit strings, compound-number endings and dates at first tone', () => {
    for (const text of ['一九九八年', '一九一八年', '一二三', '一零一', '一月', '十一月', '一月一日', '一号', '十一天', '一百零一个']) {
      const result = sentenceTones(text)
      result.chars.forEach((c, i) => {
        if (c === '一' && !(text === '一百零一个' && i === 0)) expect(result.tones[i], `${text} at ${i}`).toBe(1)
      })
    }
  })
  it('still changes 一 before classifiers and number units', () => {
    expect(surface('一个')).toEqual([2, 4])
    expect(surface('一天')).toEqual([4, 1])
    expect(surface('一百')).toEqual([4, 3])
    expect(surface('一万')).toEqual([2, 4])
    expect(sentenceTones('一个月').tones).toEqual([2, 4, 4])
    expect(sentenceTones('一日三餐').tones).toEqual([2, 4, 1, 1])
    expect(surface('看一看')).toEqual([4, 0, 4])
  })
  it('handles running text', () => {
    const r = sentenceTones('我的朋友, 你好!')
    expect(r.tones).toEqual([3, 0, 2, 0, null, null, 2, 3, null])
  })
})
