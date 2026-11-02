import { describe, expect, it } from 'vitest'
import { parseWordField, pinyinTones } from './word'

describe('word field', () => {
  it('splits characters from what follows', () => {
    expect(parseWordField('学习 xuéxí')).toEqual({ word: '学习', rest: ' xuéxí' })
    expect(parseWordField('xuéxí')).toBeNull()
  })

  it('reads tone marks with or without spaces', () => {
    expect(pinyinTones('学习', 'xuéxí')).toEqual([2, 2])
    expect(pinyinTones('学习', ' xué xí — to study')).toEqual([2, 2])
    expect(pinyinTones('东西', 'dōngxi')).toEqual([1, 0])
    expect(pinyinTones('西安', "Xī'ān")).toEqual([1, 1])
    expect(pinyinTones('绿色', 'lǜsè')).toEqual([4, 4])
    expect(pinyinTones('长城', 'Chángchéng')).toEqual([2, 2])
    expect(pinyinTones('一点儿', 'yìdiǎnr')).toEqual([4, 3, 0])
  })

  it('reads tone numbers', () => {
    expect(pinyinTones('学习', '(xue2 xi2)')).toEqual([2, 2])
    expect(pinyinTones('东西', 'dong1xi5')).toEqual([1, 0])
    expect(pinyinTones('女儿', 'nv3er2')).toEqual([3, 2])
  })

  it('gives up when the pinyin does not fit', () => {
    expect(pinyinTones('学习', 'to study')).toBeNull()
    expect(pinyinTones('学习', 'xué')).toBeNull()
  })
})
