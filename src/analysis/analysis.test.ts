import { describe, expect, it } from 'vitest'
import { chaoTrack, rangeWithin } from './normalize'
import { hzToSt, SR, stToHz, trackPitch, type PitchTrack } from './pitch'
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

describe('rangeWithin', () => {
  // 100 frames low (st 10..14), then 100 frames high (st 30..34).
  const st = (i: number) => (i < 100 ? 10 : 30) + (i % 5)
  const n = 200
  const track: PitchTrack = { hop: 0.01, hz: Float32Array.from({ length: n }, (_, i) => stToHz(st(i))), rms: new Float32Array(n), zcr: new Float32Array(n), creak: new Uint8Array(n) }

  it('uses only the voiced frames inside the spans', () => {
    const r = rangeWithin(track, [{ start: 0.1, end: 0.9 }])!
    expect(r.lo).toBeGreaterThan(9.99)
    expect(r.hi).toBeLessThanOrEqual(14.01)
  })

  it('uses the whole track when there are no spans', () => {
    const r = rangeWithin(track, [])!
    expect(r.lo).toBeLessThan(15)
    expect(r.hi).toBeGreaterThan(29)
  })

  it('is null without enough voiced speech in the spans', () => {
    expect(rangeWithin(track, [{ start: 0.5, end: 0.6 }])).toBeNull()
    expect(rangeWithin(track, [{ start: 5, end: 6 }])).toBeNull()
  })
})
