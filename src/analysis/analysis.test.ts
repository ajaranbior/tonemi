import { describe, expect, it } from 'vitest'
import { chaoTrack } from './normalize'
import { hzToSt, SR, trackPitch } from './pitch'
import { compareToReference } from './score'
import { segmentSyllables } from './segment'
import { recognizeTone } from './tones'

/** Harmonic-rich voiced signal following a pitch curve, with optional silent gaps. */
function synth(parts: { dur: number; f0?: (x: number) => number }[]): Float32Array {
  const total = parts.reduce((a, p) => a + p.dur, 0)
  const out = new Float32Array(Math.round(total * SR))
  let i = 0
  let phase = 0
  for (const p of parts) {
    const n = Math.round(p.dur * SR)
    for (let k = 0; k < n; k++, i++) {
      if (!p.f0) continue
      const x = k / n
      phase += (2 * Math.PI * p.f0(x)) / SR
      const env = Math.min(1, x * 20, (1 - x) * 20)
      out[i] = 0.3 * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase))
    }
  }
  return out
}

const range = { lo: hzToSt(150), hi: hzToSt(300) }

describe('pitch tracking', () => {
  it('tracks a steady and a gliding tone within 1%', () => {
    const t = trackPitch(synth([{ dur: 0.1 }, { dur: 0.4, f0: () => 220 }, { dur: 0.1 }]))
    const voiced = Array.from(t.hz).filter((h) => !Number.isNaN(h))
    expect(voiced.length).toBeGreaterThan(25)
    for (const h of voiced) expect(Math.abs(h - 220) / 220).toBeLessThan(0.01)

    const g = trackPitch(synth([{ dur: 0.1 }, { dur: 0.4, f0: (x) => 300 - 150 * x }, { dur: 0.1 }]))
    const gv = Array.from(g.hz).filter((h) => !Number.isNaN(h))
    expect(gv[0]).toBeGreaterThan(260)
    expect(gv.at(-1)!).toBeLessThan(180)
  })

  it('reports silence as unvoiced', () => {
    const t = trackPitch(new Float32Array(SR / 2))
    expect(Array.from(t.hz).every(Number.isNaN)).toBe(true)
  })
})

describe('segmentation + recognition', () => {
  // 2+4 with a consonant gap: rise, then fall.
  const word = synth([
    { dur: 0.1 },
    { dur: 0.25, f0: (x) => 190 + 100 * x * x },
    { dur: 0.06 },
    { dur: 0.25, f0: (x) => 300 - 140 * x },
    { dur: 0.1 },
  ])

  it('splits at the gap and recognises the tones', () => {
    const t = trackPitch(word)
    const seg = segmentSyllables(t, 2)!
    expect(seg.confident).toBe(true)
    const gapFrame = (0.1 + 0.25 + 0.03) / t.hop
    expect(Math.abs(seg.segments[1][0] - gapFrame)).toBeLessThan(4)

    const chao = chaoTrack(t, range)
    const c5 = (i: number) => {
      const [a, b] = seg.segments[i]
      const v = Array.from(chao.subarray(a, b)).filter((x) => !Number.isNaN(x))
      return [0, 0.25, 0.5, 0.75, 1].map((p) => v[Math.round(p * (v.length - 1))])
    }
    expect(recognizeTone(c5(0), false).tone).toBe(2)
    expect(recognizeTone(c5(1), true).tone).toBe(4)
  })

  it('scores an identical attempt ~100 and a flat one lower', () => {
    const t = trackPitch(word)
    const seg = segmentSyllables(t, 2)!
    const ref = { chao: chaoTrack(t, range), segments: seg.segments }
    expect(compareToReference(ref, ref, [2, 4]).score).toBeGreaterThanOrEqual(98)

    const flat = trackPitch(synth([{ dur: 0.1 }, { dur: 0.25, f0: () => 230 }, { dur: 0.06 }, { dur: 0.25, f0: () => 230 }, { dur: 0.1 }]))
    const fseg = segmentSyllables(flat, 2)!
    const res = compareToReference({ chao: chaoTrack(flat, range), segments: fseg.segments }, ref, [2, 4])
    expect(res.score!).toBeLessThan(70)
    expect(res.rangeRatio!).toBeLessThan(0.5)
  })
})
