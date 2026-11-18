import { describe, expect, it } from 'vitest'
import { isMandarinLang, licenseOk, parseCategoryPage, parseCommonsTitle, parseFilePage, speakerId } from './commons'

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

describe('commons HTML pages', () => {
  it('reads file titles and the next-page link from a category page', () => {
    const html = '<a href="/wiki/File:LL-Q9192_(cmn)-A-%E7%8C%AB.wav" title="File:LL-Q9192 (cmn)-A-猫.wav">x</a>' +
      '<a href="/w/index.php?title=Category:X&amp;filefrom=%E4%B8%96#mw-category-media" title="Category:X">next page</a>'
    expect(parseCategoryPage(html)).toEqual({ titles: ['LL-Q9192 (cmn)-A-猫.wav'], next: '/w/index.php?title=Category:X&filefrom=%E4%B8%96' })
    expect(parseCategoryPage('<p>none</p>')).toEqual({ titles: [], next: null })
  })
  it('reads the original URL and licence from a file page', () => {
    const html = '<a href="https://upload.wikimedia.org/wikipedia/commons/e/e2/LL-Q9192_%28cmn%29-A-%E7%8C%AB.wav">Original file</a>' +
      '<span class="licensetpl&#95;short" style="display:none;">CC BY-SA 4.0</span>'
    expect(parseFilePage(html)).toEqual({ url: 'https://upload.wikimedia.org/wikipedia/commons/e/e2/LL-Q9192_%28cmn%29-A-%E7%8C%AB.wav', license: 'CC BY-SA 4.0' })
  })
})
