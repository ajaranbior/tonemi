import type { Segment } from '../analysis/segment'
import { displayShape, type Tone } from '../analysis/tones'
import type { PlotLabel, PlotLine } from './PitchPlot'
import { toneName } from './tone'

/**
 * Chart extras for an answered ear trial: a label per syllable (✓ / "you: T2") and, for each
 * wrong answer, the textbook shape of the tone that was picked, drawn over the real contour.
 * `segments` are frames; times are (frame − offset) × hop.
 */
export function answerOverlay(
  segments: Segment[],
  expected: Tone[],
  chosen: (Tone | null)[],
  pinyin: string[],
  hop: number,
  offset: number,
  /** Per-frame Chao values (NaN when unvoiced); the tone shape is fitted to the voiced stretch of each syllable. */
  chao?: ArrayLike<number>,
): { labels: PlotLabel[]; guess: PlotLine | null; boundaries: number[] } {
  const t: number[] = []
  const v: number[] = []
  const labels = segments.map((seg0, i): PlotLabel => {
    const seg = voicedExtent(seg0, chao)
    const ok = chosen[i] === expected[i]
    const pick = chosen[i]
    if (!ok && pick !== null) {
      const tpl = displayShape(pick, segments.length, i)
      // One point per frame: the plot breaks lines across gaps longer than 50 ms.
      for (let f = seg[0]; f < seg[1]; f++) {
        const x = ((f - seg[0]) / Math.max(1, seg[1] - seg[0] - 1)) * (tpl.length - 1)
        const a = Math.floor(x)
        const b = Math.min(tpl.length - 1, a + 1)
        t.push((f - offset) * hop)
        v.push(tpl[a] + (tpl[b] - tpl[a]) * (x - a))
      }
      t.push(NaN)
      v.push(NaN)
    }
    return {
      t: ((seg[0] + seg[1]) / 2 - offset) * hop,
      text: pinyin[i],
      tone: expected[i],
      sub: ok ? '✓' : `✗ you: ${toneName(pick ?? 0)}`,
      ok,
      subTone: !ok && pick !== null ? pick : undefined,
      span: [(seg0[0] - offset) * hop, (seg0[1] - offset) * hop],
    }
  })
  return {
    labels,
    guess: t.length ? { t, v, kind: 'wrong' } : null,
    boundaries: segments.slice(1).map((s) => (s[0] - offset) * hop),
  }
}

/** The first..last voiced frames of a segment (the whole segment when there is no pitch). */
function voicedExtent(seg: Segment, chao?: ArrayLike<number>): Segment {
  if (!chao) return seg
  let a = seg[0]
  let b = seg[1]
  while (a < b && Number.isNaN(chao[a])) a++
  while (b > a && Number.isNaN(chao[b - 1])) b--
  return b - a >= 3 ? [a, b] : seg
}
