import { HOP, SR, WIN, type PitchTrack } from '../analysis/pitch'
import { segmentSyllables, sonorantMask } from '../analysis/segment'

const HAN = /\p{Script=Han}/u
/** Frame i describes the window centred this far after i * hop. */
export const FRAME_CENTER = WIN / 2 / SR
export const frameTime = (i: number) => i * (HOP / SR) + FRAME_CENTER

export interface CharRange {
  /** Code-point indices into the cue text, [from, to). */
  from: number
  to: number
}

/** Words of a text (Han only), split with Intl.Segmenter when available, else per character. */
export function wordRanges(text: string): CharRange[] {
  const chars = [...text]
  const out: CharRange[] = []
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter
  if (Seg) {
    let pos = 0
    for (const s of new Seg('zh', { granularity: 'word' }).segment(text)) {
      const len = [...s.segment].length
      if (s.isWordLike && [...s.segment].every((c) => HAN.test(c))) out.push({ from: pos, to: pos + len })
      pos += len
    }
    return out
  }
  chars.forEach((c, i) => HAN.test(c) && out.push({ from: i, to: i + 1 }))
  return out
}

/**
 * Tile a cue into clips of `wordsPerClip` consecutive words (0 = whole phrase), never
 * crossing punctuation and never exceeding `maxSyllables`.
 */
export function buildClips(text: string, wordsPerClip: number, maxSyllables = 6): CharRange[] {
  const chars = [...text]
  const words = wordRanges(text)
  const clips: CharRange[] = []
  let cur: CharRange | null = null
  let count = 0
  const flush = () => {
    if (cur) clips.push(cur)
    cur = null
    count = 0
  }
  for (const w of words) {
    const contiguous = cur !== null && chars.slice(cur.to, w.from).every((c) => !HAN.test(c) && /[\s]/.test(c))
    const size = w.to - w.from
    if (cur && (!contiguous || (wordsPerClip > 0 && count >= wordsPerClip) || cur.to - cur.from + size > maxSyllables)) flush()
    if (!cur) cur = { from: w.from, to: w.to }
    else cur.to = w.to
    count++
  }
  flush()
  return clips
}

export interface CharTimes {
  /** Start/end frame of every Han character, indexed by Han-character number within the cue. */
  start: number[]
  end: number[]
}

const MIN_RUN = 3
const SECTION_GAP = 20

/**
 * Estimate where each Han character of a cue sits in the audio. Pauses split the cue into
 * sections; if their number matches the number of punctuation-separated phrases each phrase
 * gets its own section, otherwise characters are spread evenly over the speech. Interior
 * boundaries are then snapped to the nearest energy valley.
 */
export function charTimes(track: PitchTrack, from: number, to: number, phraseSizes: number[]): CharTimes | null {
  const total = phraseSizes.reduce((a, b) => a + b, 0)
  if (!total) return null
  to = Math.min(to, track.hz.length)
  const son = sonorantMask(track)
  const runs: [number, number][] = []
  for (let i = from; i < to; ) {
    if (!son[i]) { i++; continue }
    let j = i
    while (j < to && son[j]) j++
    let pitched = 0
    for (let k = i; k < j; k++) if (!Number.isNaN(track.hz[k])) pitched++
    if (j - i >= MIN_RUN && pitched >= MIN_RUN) runs.push([i, j])
    i = j
  }
  if (!runs.length) return null

  const sections: [number, number][] = []
  for (const r of runs) {
    const last = sections[sections.length - 1]
    if (last && r[0] - last[1] < SECTION_GAP) last[1] = r[1]
    else sections.push([r[0], r[1]])
  }
  const spans: [number, number, number][] =
    sections.length === phraseSizes.length && phraseSizes.length > 1
      ? sections.map((s, i) => [s[0], s[1], phraseSizes[i]])
      : [[sections[0][0], sections[sections.length - 1][1], total]]

  const rms = smoothed(track.rms, 5)
  const start: number[] = []
  const end: number[] = []
  for (const [a, b, n] of spans) {
    const cuts = syllableCuts(track, a, b, n) ?? evenCuts(rms, a, b, n)
    for (let k = 0; k < n; k++) {
      start.push(cuts[k])
      end.push(cuts[k + 1])
    }
  }
  return { start, end }
}

/** The syllable segmenter's boundaries, if they look like real syllables (similar lengths). */
function syllableCuts(track: PitchTrack, a: number, b: number, n: number): number[] | null {
  if (n < 2 || n > 14) return null
  const slice: PitchTrack = {
    hop: track.hop,
    hz: track.hz.subarray(a, b),
    rms: track.rms.subarray(a, b),
    zcr: track.zcr.subarray(a, b),
    creak: track.creak.subarray(a, b),
  }
  const seg = segmentSyllables(slice, n)
  if (!seg?.confident) return null
  const lens = seg.segments.map(([s, e]) => e - s)
  if (Math.min(...lens) < 5 || Math.max(...lens) > 3 * Math.min(...lens)) return null
  return [a + seg.segments[0][0], ...seg.segments.map(([, e]) => a + e)]
}

/** Even split of [a, b) into n parts, each interior cut snapped to the nearest energy valley. */
function evenCuts(rms: Float32Array, a: number, b: number, n: number): number[] {
  const len = (b - a) / n
  const cuts = [a]
  for (let k = 1; k < n; k++) cuts.push(snap(rms, Math.round(a + len * k), Math.max(1, Math.floor(len * 0.4)), a, b))
  cuts.push(b)
  return cuts
}

function snap(rms: Float32Array, at: number, radius: number, lo: number, hi: number): number {
  let best = at
  for (let i = Math.max(lo + 1, at - radius); i <= Math.min(hi - 1, at + radius); i++) {
    if (rms[i] < rms[best] - 1e-9 || (Math.abs(rms[i] - rms[best]) < 1e-9 && Math.abs(i - at) < Math.abs(best - at))) best = i
  }
  return best
}

function smoothed(a: Float32Array, size: number): Float32Array {
  const h = size >> 1
  return Float32Array.from(a, (_, i) => {
    let s = 0
    let c = 0
    for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k++) { s += a[k]; c++ }
    return s / c
  })
}

/** Sizes (in Han characters) of the punctuation-separated phrases of a text. */
export function phraseSizes(text: string): number[] {
  const sizes: number[] = []
  let run = 0
  for (const c of text) {
    if (HAN.test(c)) run++
    else if (run && !/\s/.test(c)) { sizes.push(run); run = 0 }
  }
  if (run) sizes.push(run)
  return sizes
}

/** Index of each character among the Han characters of the text (-1 for others). */
export function hanIndex(text: string): number[] {
  let n = 0
  return [...text].map((c) => (HAN.test(c) ? n++ : -1))
}

const cache = new WeakMap<PitchTrack, Map<number, CharTimes | null>>()

/** `charTimes` for one cue of a track, memoised per track. */
export function cueCharTimes(track: PitchTrack, cueIndex: number, from: number, to: number, text: string): CharTimes | null {
  let perTrack = cache.get(track)
  if (!perTrack) cache.set(track, (perTrack = new Map()))
  if (!perTrack.has(cueIndex)) perTrack.set(cueIndex, charTimes(track, from, to, phraseSizes(text)))
  return perTrack.get(cueIndex)!
}
