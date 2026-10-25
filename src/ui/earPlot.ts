import type { Segment } from '../analysis/segment'
import { toneTemplate, type Tone } from '../analysis/tones'
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
): { labels: PlotLabel[]; guess: PlotLine | null; boundaries: number[] } {
  const t: number[] = []
  const v: number[] = []
  const labels = segments.map((seg, i): PlotLabel => {
    const ok = chosen[i] === expected[i]
    const pick = chosen[i]
    if (!ok && pick) {
      const tpl = toneTemplate(pick, i === segments.length - 1)
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
      sub: ok ? '✓' : `you: ${toneName(pick ?? 0)}`,
      ok,
    }
  })
  return {
    labels,
    guess: t.length ? { t, v, kind: 'user' } : null,
    boundaries: segments.slice(1).map((s) => (s[0] - offset) * hop),
  }
}
