import type { Segment } from './segment'

/** Voiced values of one syllable, optionally trimmed at both ends, resampled to `points`. */
export function syllableContour(values: ArrayLike<number>, seg: Segment, points: number, trim = 0): number[] | null {
  const v: number[] = []
  for (let i = seg[0]; i < seg[1]; i++) if (!Number.isNaN(values[i])) v.push(values[i])
  if (v.length < 3) return null
  const cut = Math.floor(v.length * trim)
  const core = cut > 0 && v.length - 2 * cut >= 3 ? v.slice(cut, v.length - cut) : v
  return resample(core, points)
}

export function resample(v: number[], points: number): number[] {
  if (v.length === 1) return Array(points).fill(v[0])
  return Array.from({ length: points }, (_, i) => {
    const x = (i * (v.length - 1)) / (points - 1)
    const a = Math.floor(x)
    const b = Math.min(v.length - 1, a + 1)
    return v[a] + (v[b] - v[a]) * (x - a)
  })
}

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
