import { describe, expect, it } from 'vitest'
import { loopGrain } from './scrub'

const SR = 16000

describe('loopGrain', () => {
  it('loops a whole number of pitch periods so the tone is seamless', () => {
    const x = Float32Array.from({ length: SR }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 200 * i) / SR))
    const g = loopGrain(x, 0.5)!
    expect(g.length % 80).toBe(0)
    expect(g.length / SR).toBeGreaterThan(0.04)
    expect(g.length / SR).toBeLessThan(0.08)
    // Wrap-around step is no bigger than a normal sample-to-sample step.
    let maxStep = 0
    for (let i = 1; i < g.length; i++) maxStep = Math.max(maxStep, Math.abs(g[i] - g[i - 1]))
    expect(Math.abs(g[0] - g[g.length - 1])).toBeLessThanOrEqual(maxStep * 1.05)
  })

  it('handles the very start and end of a recording', () => {
    const x = Float32Array.from({ length: SR / 4 }, () => Math.random() - 0.5)
    expect(loopGrain(x, 0)).not.toBeNull()
    expect(loopGrain(x, 0.25)).not.toBeNull()
  })
})
