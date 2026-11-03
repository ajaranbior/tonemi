import { describe, expect, it } from 'vitest'
import { isMandarinLang, licenseOk, parseCommonsTitle, speakerId } from './commons'

describe('commons helpers', () => {
  it('parses Lingua Libre file titles', () => {
    expect(parseCommonsTitle('File:LL-Q727694 (cmn)-Yue Tan-猫.wav')).toEqual({ lang: 'cmn', speaker: 'Yue Tan', word: '猫' })
    expect(parseCommonsTitle('File:LL-Q727694 (zho)-A-B-中国.ogg')).toEqual({ lang: 'zho', speaker: 'A-B', word: '中国' })
  })
  it('rejects other files', () => {
    expect(parseCommonsTitle('File:Cat.jpg')).toBeNull()
    expect(parseCommonsTitle('File:LL-Q727694 (cmn)-Yue-hello.wav')).toBeNull()
  })
  it('accepts Mandarin only', () => {
    expect(isMandarinLang('cmn')).toBe(true)
    expect(isMandarinLang('yue')).toBe(false)
  })
  it('accepts redistributable licences only', () => {
    expect(licenseOk('CC BY-SA 4.0')).toBe(true)
    expect(licenseOk('CC0')).toBe(true)
    expect(licenseOk('CC BY-NC 4.0')).toBe(false)
    expect(licenseOk(undefined)).toBe(false)
  })
  it('makes stable ASCII ids', () => {
    expect(speakerId('Yue Tan')).toBe('ll-yue-tan')
    expect(speakerId('小明')).toBe(speakerId('小明'))
    expect(speakerId('小明')).not.toBe(speakerId('小红'))
  })
})
