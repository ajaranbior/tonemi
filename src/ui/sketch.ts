import type { PlotLine } from './PitchPlot'

/** A hand-drawn melody: strokes as points, NaN between strokes. */
export interface Sketch {
  t: number[]
  v: number[]
}

export const sketchLine = (s: Sketch | null): PlotLine | null => (s && s.t.length ? { t: s.t, v: s.v, kind: 'user', joined: true } : null)

/** Add a point to a sketch; a new stroke is separated from the last by a NaN. */
export function extendSketch(s: Sketch | null, pt: { t: number; v: number }, start: boolean): Sketch {
  const t = s ? [...s.t] : []
  const v = s ? [...s.v] : []
  if (start && t.length) {
    t.push(pt.t)
    v.push(NaN)
  }
  t.push(pt.t)
  v.push(pt.v)
  return { t, v }
}
