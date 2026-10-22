import { describe, expect, it } from 'vitest'
import { parseSubtitles } from './subtitles'

describe('parseSubtitles', () => {
  it('parses SRT', () => {
    const cues = parseSubtitles('1\r\n00:00:01,500 --> 00:00:03,000\r\n你好\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,250\r\n<i>谢谢</i>\r\n')
    expect(cues).toEqual([
      { start: 1.5, end: 3, text: '你好' },
      { start: 62, end: 64.25, text: '谢谢' },
    ])
  })
  it('parses VTT with short timestamps', () => {
    const cues = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500 align:start\n我们\n走吧\n')
    expect(cues).toEqual([{ start: 1, end: 2.5, text: '我们 走吧' }])
  })
})
