import { describe, expect, it } from 'vitest'
import { createFrameAnalyzer, SR, WIN } from './pitch'
import { createFrameAnalyzer as directAnalyzer } from './test/directYin'
import { createYinDifference } from './yinDifference'

let seed = 12345
const noise = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5 }

describe('FFT YIN', () => {
  it('matches the fixed-window difference at every lag, including changing energy and DC', () => {
    const difference = createYinDifference(512, 268)
    const out = new Float32Array(269)
    for (const length of [600, 780, WIN]) {
      const x = Float32Array.from({ length }, (_, i) => 0.2 + noise() * (i < 400 ? 0.1 : 0.8))
      const maxLag = Math.min(268, length - 512)
      difference(x, maxLag, out)
      for (let lag = 1; lag <= maxLag; lag++) {
        let expected = 0
        for (let j = 0; j < 512; j++) expected += (x[j] - x[j + lag]) ** 2
        expect(Math.abs(out[lag] - expected)).toBeLessThan(0.00001)
      }
    }
  })

  it('preserves pitch and voicing for harmonics, glides, noise, DC and silence', () => {
    const direct = directAnalyzer()
    const fft = createFrameAnalyzer()
    for (const hz of [61, 75, 100, 220, 400, 640]) {
      for (const amplitude of [0, 0.001, 0.01, 0.5]) {
        for (const noisy of [false, true]) {
          let phase = 0
          const x = Float32Array.from({ length: WIN }, (_, i) => {
            phase += 2 * Math.PI * (hz + i * 0.005) / SR
            return amplitude * (Math.sin(phase) + 0.3 * Math.sin(2 * phase) + (noisy ? noise() : 0)) + 0.01
          })
          const a = direct(x)
          const b = fft(x)
          expect(b.rms).toBe(a.rms)
          expect(b.zcr).toBe(a.zcr)
          if (Number.isNaN(a.hz)) expect(b.hz).toBeNaN()
          else expect(Math.abs(1200 * Math.log2(a.hz / b.hz))).toBeLessThan(0.01)
        }
      }
    }
    expect(fft(new Float32Array(100).fill(0.1)).hz).toBeNaN()
  })
})
