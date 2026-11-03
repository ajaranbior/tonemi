import { describe, expect, it } from 'vitest'
import { hzToSt, SR, trackPitch } from '../analysis/pitch'
import { canRetone, humFromContour, humTrack, jitterRate, muffle } from './variants'

describe('melody-only audio', () => {
  it('hums the pitch track it is given', () => {
    const hop = 0.01
    // 20 unvoiced frames, 40 frames rising 200 → 250 Hz, 20 unvoiced.
    const st = [...Array(20).fill(null), ...Array.from({ length: 40 }, (_, i) => hzToSt(200 + (50 * i) / 39)), ...Array(20).fill(null)]
    const hum = humFromContour(st, hop)
    const hz = Array.from(trackPitch(hum).hz).filter((h) => !Number.isNaN(h))
    expect(hz.length).toBeGreaterThan(20)
    expect(Math.min(...hz)).toBeGreaterThan(185)
    expect(Math.max(...hz)).toBeLessThan(265)
    // Silent where unvoiced.
    expect(Math.max(...Array.from(hum.subarray(0, Math.round(0.1 * SR)), Math.abs))).toBe(0)
  })

  it('bridges pitch dropouts inside a syllable and fades pieces out instead of clicking', () => {
    // 爸爸-like: a fall with a tracker hole in the middle, then a 3-frame neutral syllable.
    const st: (number | null)[] = Array(45).fill(null)
    for (let f = 5; f < 12; f++) st[f] = 30 - (f - 5)
    for (let f = 16; f < 19; f++) st[f] = 22
    for (let f = 25; f < 28; f++) st[f] = 20
    const { pitch, amp } = humTrack(st, [[0, 22], [22, 45]])
    // The hole at 12–15 is filled: one piece over the whole first syllable.
    for (let f = 5; f < 19; f++) expect(amp[f]).toBe(1)
    expect(pitch[13]).toBeGreaterThan(22)
    expect(pitch[13]).toBeLessThan(24)
    // The 3-frame neutral is held to a short note, then fades out.
    for (let f = 25; f < 34; f++) expect(amp[f]).toBe(1)
    expect(amp[35]).toBeGreaterThan(0)
    expect(amp[35]).toBeLessThan(1)
    expect(amp[40]).toBe(0)
  })

  it('muffling keeps a low tone and removes a high one', () => {
    const n = SR / 2
    const tone = (hz: number) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SR))
    // Energy at a frequency (Goertzel-style projection).
    const power = (x: Float32Array, hz: number) => {
      let re = 0
      let im = 0
      x.forEach((v, i) => {
        re += v * Math.cos((2 * Math.PI * hz * i) / SR)
        im += v * Math.sin((2 * Math.PI * hz * i) / SR)
      })
      return re * re + im * im
    }
    const high = tone(3000)
    const out = muffle(tone(150).map((v, i) => v + high[i]))
    const corr = power(out, 150) / (power(out, 150) + power(out, 3000))
    expect(corr).toBeGreaterThan(0.999)
  })
})

describe('retoning rules and jitter', () => {
  it('only retones to patterns with the same length and neutral tones in place', () => {
    expect(canRetone([2, 4], [3, 1])).toBe(true)
    expect(canRetone([1, 0], [4, 0])).toBe(true)
    expect(canRetone([1, 0], [4, 1])).toBe(false)
    expect(canRetone([1, 1], [1])).toBe(false)
  })

  it('keeps the rate within ±10%', () => {
    expect(jitterRate(() => 0)).toBeCloseTo(0.9)
    expect(jitterRate(() => 1)).toBeCloseTo(1.1)
  })
})
