import { describe, expect, it } from 'vitest'
import { HOP, hzToSt, SR, trackPitch } from '../analysis/pitch'
import { segmentSyllables } from '../analysis/segment'
import { synthTones } from './synth'
import { retone, targetContour, type Voice } from './retone'

const range = { lo: hzToSt(150), hi: hzToSt(300) }

function voiceOf(samples: Float32Array, syllables: number): Voice {
  const track = trackPitch(samples)
  const st = Array.from(track.hz, (h) => (Number.isNaN(h) ? NaN : hzToSt(h)))
  const seg = segmentSyllables(track, syllables)
  const n = st.length
  const segments = seg?.segments ?? Array.from({ length: syllables }, (_, i) => [Math.round((n * i) / syllables), Math.round((n * (i + 1)) / syllables)] as [number, number])
  return { samples, hop: track.hop, t0: 0, st, segments, range, from: 0, to: samples.length / SR }
}

const voicedHz = (s: Float32Array) => Array.from(trackPitch(s).hz).filter((h) => !Number.isNaN(h))

describe('retone', () => {
  it('leaves the pitch alone when the answer was right', () => {
    const v = voiceOf(synthTones([2, 4], range), 2)
    const t = targetContour(v, [2, 4], [2, 4])
    for (let i = 0; i < t.length; i++) if (!Number.isNaN(t[i])) expect(t[i]).toBeCloseTo(v.st[i] as number, 5)
  })

  it('turns a level 1st tone into a falling 4th tone, keeping the length', () => {
    const src = synthTones([1], range)
    const out = retone(voiceOf(src, 1), [1], [4])
    expect(Math.abs(out.length - src.length)).toBeLessThan(HOP)
    const before = voicedHz(src)
    const after = voicedHz(out)
    expect(after.length).toBeGreaterThan(before.length * 0.6)
    // Original is flat; the new one starts high and ends clearly lower.
    expect(Math.abs(before.at(-3)! / before[3] - 1)).toBeLessThan(0.03)
    expect(after.at(-3)!).toBeLessThan(after[3] * 0.8)
  })

  it('changes only the syllable that was wrong', () => {
    const src = synthTones([4, 1], range)
    const v = voiceOf(src, 2)
    const out = retone(v, [4, 1], [4, 2])
    const t = trackPitch(out)
    const [a, b] = v.segments[0]
    const firstBefore = Array.from(v.st, Number).slice(a + 3, b - 3)
    const firstAfter = Array.from(t.hz.subarray(a + 3, b - 3), hzToSt)
    firstAfter.forEach((s, i) => !Number.isNaN(s) && !Number.isNaN(firstBefore[i]) && expect(Math.abs(s - firstBefore[i])).toBeLessThan(1))
    // Second syllable now rises.
    const [c, d] = v.segments[1]
    const second = Array.from(t.hz.subarray(c, d)).filter((h) => !Number.isNaN(h))
    expect(second.at(-2)!).toBeGreaterThan(second[2] * 1.1)
  })
})
