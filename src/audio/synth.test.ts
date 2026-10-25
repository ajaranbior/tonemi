import { describe, expect, it } from 'vitest'
import { trackPitch, hzToSt } from '../analysis/pitch'
import { synthTones } from './synth'

describe('synthTones', () => {
  it('produces a pitched hum whose 2nd tone rises and 4th tone falls', () => {
    const range = { lo: hzToSt(150), hi: hzToSt(300) }
    const t = trackPitch(synthTones([2, 4], range))
    const v = Array.from(t.hz)
    const voiced = v.map((h, i) => [i, h] as const).filter(([, h]) => !Number.isNaN(h))
    expect(voiced.length).toBeGreaterThan(40)
    const first = voiced.filter(([i]) => i < 40)
    expect(first.at(-1)![1]).toBeGreaterThan(first[0][1] * 1.1)
    const last = voiced.slice(-25)
    expect(last.at(-1)![1]).toBeLessThan(last[0][1] * 0.8)
  })
})
