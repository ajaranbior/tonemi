import type { Tone } from '../analysis/tones'

/** Icon polylines in a 24×16 box (y grows downward); the neutral tone is a dot. */
export const GLYPH_POINTS: Record<Exclude<Tone, 0>, [number, number][]> = {
  1: [[3, 3], [21, 3]],
  2: [[3, 12], [21, 3]],
  3: [[3, 4], [10, 13], [21, 3]],
  4: [[3, 3], [21, 14]],
}
