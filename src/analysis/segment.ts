import type { PitchTrack } from './pitch'

/** [startFrame, endFrame) of one syllable. */
export type Segment = [number, number]

export interface Segmentation {
  segments: Segment[]
  /** False when we had to fall back to an even split. */
  confident: boolean
}

interface Candidate {
  at: number
  strength: number
}

const MIN_FRAMES = 3

/**
 * Frames that belong to a syllable nucleus: pitched, creaky, or loud with a low
 * zero-crossing rate (vowel-like but unpitched, e.g. a devoiced neutral 识).
 */
export function sonorantMask(track: PitchTrack): boolean[] {
  let maxRms = 0
  for (const r of track.rms) maxRms = Math.max(maxRms, r)
  return Array.from(
    track.hz,
    (h, i) => !Number.isNaN(h) || track.creak[i] === 1 || (track.rms[i] >= maxRms * 0.1 && track.zcr[i] < 0.2),
  )
}

/** Sonorant runs that carry pitch, or sit close to ones that do. */
function utteranceRuns(track: PitchTrack, son: boolean[]): [number, number][] {
  const runs: [number, number][] = []
  let i = 0
  while (i < son.length) {
    if (!son[i]) { i++; continue }
    let j = i
    while (j < son.length && son[j]) j++
    if (j - i >= MIN_FRAMES) runs.push([i, j])
    i = j
  }
  const pitched = (r: [number, number]) => {
    let c = 0
    for (let k = r[0]; k < r[1]; k++) if (!Number.isNaN(track.hz[k])) c++
    return c >= MIN_FRAMES
  }
  const anchors = runs.filter(pitched)
  return runs.filter(
    (r) => pitched(r) || (r[1] - r[0] >= 5 && anchors.some((a) => Math.min(Math.abs(r[0] - a[1]), Math.abs(a[0] - r[1])) <= 30)),
  )
}

/**
 * Split an utterance with a known number of syllables at gaps, energy valleys
 * and pitch breaks, preferring strong boundaries and balanced syllable lengths.
 */
export function segmentSyllables(track: PitchTrack, n: number): Segmentation | null {
  const son = sonorantMask(track)
  const runs = utteranceRuns(track, son)
  if (!runs.length) return null
  const start = runs[0][0]
  const end = runs[runs.length - 1][1]
  const inRun = new Array(son.length).fill(false)
  for (const [a, b] of runs) for (let k = a; k < b; k++) inRun[k] = true

  if (n === 1) return { segments: [[start, end]], confident: true }

  const rms = smooth(track.rms, 5)
  const cands: Candidate[] = []

  // Gaps between runs (consonants, pauses).
  for (let r = 1; r < runs.length; r++) {
    const len = runs[r][0] - runs[r - 1][1]
    cands.push({ at: (runs[r - 1][1] + runs[r][0]) >> 1, strength: 1 + Math.min(len, 15) / 10 })
  }

  for (const [a, b] of runs) {
    // Energy valleys (e.g. 妈妈, 毛衣).
    for (let k = a + 3; k < b - 3; k++) {
      if (!(rms[k] <= rms[k - 1] && rms[k] <= rms[k + 1])) continue
      const left = maxIn(rms, Math.max(a, k - 20), k)
      const right = maxIn(rms, k + 1, Math.min(b, k + 21))
      const depth = Math.min(left, right) / Math.max(rms[k], 1e-6)
      if (depth > 1.25) cands.push({ at: k, strength: Math.min(0.95, depth - 1) })
    }
    // Pitch breaks: short unpitched stretches between pitched frames (e.g. the l in 漂亮).
    let k = a
    while (k < b) {
      if (!Number.isNaN(track.hz[k])) { k++; continue }
      let j = k
      while (j < b && Number.isNaN(track.hz[j])) j++
      if (k > a && j < b && j - k <= 12) cands.push({ at: (k + j) >> 1, strength: 0.7 })
      k = j
    }
  }

  const prefix = new Int32Array(son.length + 1)
  for (let k = 0; k < son.length; k++) prefix[k + 1] = prefix[k] + (inRun[k] ? 1 : 0)
  const framesIn = (a: number, b: number) => prefix[b] - prefix[a]

  const pool = cands
    .filter((c) => c.at > start && c.at < end)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 16)
    .sort((a, b) => a.at - b.at)

  let best: { score: number; cuts: number[] } | null = null
  for (const combo of combinations(pool, n - 1)) {
    const cuts = combo.map((c) => c.at)
    const bounds = [start, ...cuts, end]
    const lens: number[] = []
    let ok = true
    for (let s = 0; s < n; s++) {
      const v = framesIn(bounds[s], bounds[s + 1])
      if (v < MIN_FRAMES) { ok = false; break }
      lens.push(v)
    }
    if (!ok) continue
    const mean = lens.reduce((a, b) => a + b, 0) / n
    const cv = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n) / mean
    const score = combo.reduce((a, c) => a + c.strength, 0) - 1.5 * cv
    if (!best || score > best.score) best = { score, cuts }
  }

  if (best) {
    const bounds = [start, ...best.cuts, end]
    return { segments: bounds.slice(0, -1).map((b, s) => [b, bounds[s + 1]] as Segment), confident: true }
  }

  // Fallback: split sonorant frames evenly.
  const total = framesIn(start, end)
  if (total < n * MIN_FRAMES) return null
  const bounds = [start]
  let target = 1
  for (let k = start; k < end && target < n; k++) {
    if (framesIn(start, k) >= (total * target) / n) { bounds.push(k); target++ }
  }
  bounds.push(end)
  return { segments: bounds.slice(0, -1).map((b, s) => [b, bounds[s + 1]] as Segment), confident: false }
}

function smooth(a: Float32Array, size: number): Float32Array {
  const h = size >> 1
  return Float32Array.from(a, (_, i) => {
    let s = 0
    let c = 0
    for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k++) { s += a[k]; c++ }
    return s / c
  })
}

function maxIn(a: Float32Array, from: number, to: number): number {
  let m = 0
  for (let k = from; k < to; k++) m = Math.max(m, a[k])
  return m
}

function* combinations<T>(items: T[], k: number, from = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === k) { yield acc.slice(); return }
  for (let i = from; i <= items.length - (k - acc.length); i++) {
    acc.push(items[i])
    yield* combinations(items, k, i + 1, acc)
    acc.pop()
  }
}
