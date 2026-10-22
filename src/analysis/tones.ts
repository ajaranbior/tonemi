import { mean } from './contour'

/** 1–4 lexical tones, 0 = neutral. */
export type Tone = 0 | 1 | 2 | 3 | 4

/**
 * Five-point Chao-scale templates, several per tone to cover context variants.
 * Word-final variants include the citation-form shapes measured on the native
 * bank: final T2 starts low with a late rise; final T3 dips lower, earlier.
 */
const TEMPLATES: Record<1 | 2 | 3 | 4, { final: number[][]; nonFinal: number[][] }> = {
  1: {
    final: [[5, 5, 5, 5, 5], [4.5, 4.5, 4.5, 4.4, 4.3], [4, 4, 3.9, 3.8, 3.7]],
    nonFinal: [[5, 5, 5, 5, 5], [4.5, 4.5, 4.5, 4.5, 4.5]],
  },
  2: {
    final: [[3, 3, 3.4, 4.2, 5], [1.6, 1.4, 1.7, 2.3, 3], [2.6, 1.4, 1.4, 2, 3], [1.6, 1.7, 2, 2.9, 3.7]],
    nonFinal: [[3, 3, 3.4, 4.2, 5], [2.5, 2.5, 3, 3.7, 4.3], [2.2, 1.9, 1.9, 2.7, 4]],
  },
  3: {
    final: [[2, 1.2, 0.8, 1.2, 2.2], [2, 1.5, 1.1, 1, 1.4], [1.8, 1, 0.6, 1.4, 2.6]],
    nonFinal: [[2, 1.6, 1.2, 1, 1], [2.6, 2.6, 2.4, 2, 1.8], [2.2, 1.8, 1.5, 1.3, 1.3]],
  },
  4: {
    final: [[5, 4.6, 3.6, 2.4, 1], [4.5, 4.2, 3.4, 2.4, 1.5], [4.8, 4.2, 3.4, 2.4, 1.4]],
    nonFinal: [[5, 4.7, 4, 3.4, 3], [5, 4.6, 3.6, 2.4, 1.2]],
  },
}

export interface Recognition {
  tone: 1 | 2 | 3 | 4
  /** 0..1, softmax over template distances. */
  confidence: number
}

/** Nearest-template tone label for a 5-point Chao contour. */
export function recognizeTone(c5: number[], final: boolean): Recognition {
  const dists = ([1, 2, 3, 4] as const).map((t) => {
    const set = final ? TEMPLATES[t].final : TEMPLATES[t].nonFinal
    return Math.min(...set.map((tpl) => distance(c5, tpl)))
  })
  const w = dists.map((d) => Math.exp(-d / 0.35))
  const total = w.reduce((a, b) => a + b, 0)
  let best = 0
  for (let i = 1; i < 4; i++) if (dists[i] < dists[best]) best = i
  return { tone: (best + 1) as 1 | 2 | 3 | 4, confidence: w[best] / total }
}

/** Mean squared distance after a small allowed register shift (±0.3 Chao). */
function distance(c: number[], tpl: number[]): number {
  const shift = Math.max(-0.3, Math.min(0.3, mean(c) - mean(tpl)))
  let s = 0
  for (let i = 0; i < c.length; i++) {
    // weight the slope-carrying ends a bit more than the middle
    const w = i === 0 || i === c.length - 1 ? 1.3 : 1
    s += w * (c[i] - shift - tpl[i]) ** 2
  }
  return s / c.length
}
