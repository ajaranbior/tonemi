import { SR } from '../analysis/pitch'
import type { SpeakerRange } from '../analysis/normalize'
import type { Segment } from '../analysis/segment'
import { displayShape, type Tone } from '../analysis/tones'

/** A recording plus its pitch track: everything needed to make it say other tones. */
export interface Voice {
  /** 16 kHz mono. */
  samples: Float32Array
  /** Seconds per frame. */
  hop: number
  /** Time (s) in `samples` where the window of frame 0 starts. */
  t0: number
  /** Semitones re 55 Hz per frame; NaN / null when unvoiced. */
  st: ArrayLike<number | null>
  /** Syllables, as [start, end) frames. */
  segments: Segment[]
  /** The speaker's range, used to place the textbook tone shapes. */
  range: SpeakerRange
  /** Seconds of `samples` to render; defaults to the frames' extent. */
  from?: number
  to?: number
}

/** A YIN frame's pitch belongs roughly here, relative to the start of its window. */
export const FRAME_CENTER = 0.02
/** Grain spacing in unvoiced stretches (samples). */
const UNVOICED_STEP = 80
/** Largest pitch change applied (semitones); bigger shifts sound robotic. */
const MAX_SHIFT = 14

const num = (v: number | null | undefined) => (v === null || v === undefined ? NaN : v)

/**
 * Per-frame target pitch (semitones, NaN when unvoiced): the speaker's own contour, with each
 * syllable whose tone differs from `expected` replaced by the textbook shape of `chosen`, fitted to
 * that syllable's voiced stretch. The change is eased in and out so syllable joins stay smooth.
 */
export function targetContour(voice: Pick<Voice, 'st' | 'segments' | 'range'>, expected: Tone[], chosen: (Tone | null)[]): Float32Array {
  const n = voice.st.length
  const orig = Float32Array.from({ length: n }, (_, i) => num(voice.st[i]))
  const delta = new Float32Array(n)
  const { lo, hi } = voice.range
  const count = voice.segments.length
  voice.segments.forEach(([s, e], k) => {
    const pick = chosen[k]
    if (pick === null || pick === undefined || pick === expected[k]) return
    let a = Math.max(0, s)
    let b = Math.min(n, e)
    while (a < b && Number.isNaN(orig[a])) a++
    while (b > a && Number.isNaN(orig[b - 1])) b--
    if (b - a < 2) return
    const tpl = displayShape(pick, count, k)
    for (let f = a; f < b; f++) {
      if (Number.isNaN(orig[f])) continue
      const x = ((f - a) / (b - a - 1)) * (tpl.length - 1)
      const i = Math.floor(x)
      const j = Math.min(tpl.length - 1, i + 1)
      const chao = tpl[i] + (tpl[j] - tpl[i]) * (x - i)
      const st = lo + ((chao - 1) / 4) * (hi - lo)
      delta[f] = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, st - orig[f]))
    }
  })
  // Ease the shift over ±3 frames within each voiced run, so a changed syllable doesn't jump.
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    if (Number.isNaN(orig[f])) {
      out[f] = NaN
      continue
    }
    let sum = 0
    let w = 0
    for (let d = -3; d <= 3; d++) {
      const g = f + d
      if (g < 0 || g >= n || Number.isNaN(orig[g])) continue
      const wt = 4 - Math.abs(d)
      sum += wt * delta[g]
      w += wt
    }
    out[f] = orig[f] + sum / w
  }
  return out
}

/**
 * The recording re-pitched to `target` (semitones per frame, same frames as `voice.st`) with
 * TD-PSOLA: two-period grains cut at the speaker's glottal pulses are laid down again at the new
 * spacing, so the voice, timing and consonants stay and only the melody changes.
 */
export function repitch(voice: Voice, target: ArrayLike<number>): Float32Array {
  const x = voice.samples
  const n = voice.st.length
  const center = voice.t0 + FRAME_CENTER
  const start = Math.max(0, Math.round((voice.from ?? voice.t0) * SR))
  const end = Math.min(x.length, Math.round((voice.to ?? voice.t0 + n * voice.hop + 0.05) * SR))
  if (end - start < 2 * UNVOICED_STEP) return new Float32Array(0)

  // Frame-interpolated pitch (Hz) at a sample; NaN when the nearest frame is unvoiced.
  const at = (arr: (i: number) => number, pos: number) => {
    const f = (pos / SR - center) / voice.hop
    const r = Math.round(f)
    if (r < 0 || r >= n || Number.isNaN(arr(r))) return NaN
    const a = Math.floor(f)
    const b = a + 1
    const va = a >= 0 && a < n ? arr(a) : NaN
    const vb = b >= 0 && b < n ? arr(b) : NaN
    if (Number.isNaN(va)) return vb
    if (Number.isNaN(vb)) return va
    return va + (vb - va) * (f - a)
  }
  const stToHz = (st: number) => 55 * 2 ** (st / 12)
  const origHz = (pos: number) => stToHz(at((i) => num(voice.st[i]), pos))
  const goalHz = (pos: number) => stToHz(at((i) => target[i], pos))

  // 1. Analysis marks: one per glottal pulse in voiced stretches, evenly spaced elsewhere.
  const marks: { pos: number; period: number; voiced: boolean }[] = []
  let pos = start
  while (pos < end) {
    const hz = origHz(pos)
    if (Number.isNaN(hz)) {
      marks.push({ pos, period: UNVOICED_STEP, voiced: false })
      pos += UNVOICED_STEP
      continue
    }
    // Entering a voiced run: lock onto the strongest peak of the first period, then follow pulses.
    let period = Math.round(SR / hz)
    const sign = polarity(x, pos, Math.min(end, pos + 3 * period))
    let mark = peak(x, pos, Math.min(end, pos + period), sign)
    while (mark < end) {
      marks.push({ pos: mark, period, voiced: true })
      const nextHz = origHz(mark + period)
      if (Number.isNaN(nextHz)) break
      period = Math.round(SR / nextHz)
      const guess = mark + period
      const q = Math.max(1, Math.round(period / 4))
      mark = peak(x, Math.max(mark + 1, guess - q), Math.min(end, guess + q + 1), sign)
    }
    pos = Math.max(pos + 1, mark + period)
  }
  if (!marks.length) return x.slice(start, end)

  // 2. Synthesis: walk the output at the target period, overlap-adding the nearest analysis grain.
  const len = end - start
  const out = new Float32Array(len)
  const wsum = new Float32Array(len)
  let k = 0
  let ts = marks[0].pos
  while (ts < end) {
    while (k + 1 < marks.length && Math.abs(marks[k + 1].pos - ts) <= Math.abs(marks[k].pos - ts)) k++
    const m = marks[k]
    const { voiced } = m
    const goal = goalHz(ts)
    // Unvoiced: copy the noise from where it is (no pulse to move).
    const src = voiced ? m.pos : ts
    const pa = voiced ? m.period : UNVOICED_STEP
    const ps = voiced && !Number.isNaN(goal) ? Math.max(SR / 650, Math.min(SR / 60, SR / goal)) : pa
    for (let j = -pa; j <= pa; j++) {
      const o = ts + j - start
      const s = src + j
      if (o < 0 || o >= len || s < 0 || s >= x.length) continue
      const w = 0.5 * (1 + Math.cos((Math.PI * j) / pa))
      out[o] += w * x[s]
      wsum[o] += w
    }
    ts += Math.max(1, Math.round(ps))
  }
  // Raising pitch stacks grains; divide that back out (gaps from lowering pitch stay gaps).
  let peakAbs = 0
  for (let i = 0; i < len; i++) {
    if (wsum[i] > 1) out[i] /= wsum[i]
    peakAbs = Math.max(peakAbs, Math.abs(out[i]))
  }
  const gain = peakAbs > 0.95 ? 0.95 / peakAbs : 1
  const fade = Math.min(len >> 2, Math.round(0.01 * SR))
  for (let i = 0; i < len; i++) {
    const env = Math.min(1, i / fade, (len - 1 - i) / fade)
    out[i] *= gain * env
  }
  return out
}

/** "The same word with your tones": `voice` re-pitched so syllables follow `chosen`. */
export function retone(voice: Voice, expected: Tone[], chosen: (Tone | null)[]): Float32Array {
  return repitch(voice, targetContour(voice, expected, chosen))
}

/** +1 or −1: which way the glottal pulses point in x[a, b). */
function polarity(x: Float32Array, a: number, b: number): 1 | -1 {
  let max = 0
  let min = 0
  for (let i = a; i < b; i++) {
    if (x[i] > max) max = x[i]
    if (x[i] < min) min = x[i]
  }
  return max >= -min ? 1 : -1
}

/** Index of the largest sign·x in [a, b). */
function peak(x: Float32Array, a: number, b: number, sign: 1 | -1): number {
  let best = a
  for (let i = a + 1; i < b; i++) if (sign * x[i] > sign * x[best]) best = i
  return b > a ? best : a
}
