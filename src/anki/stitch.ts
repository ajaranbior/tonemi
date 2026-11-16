import type { Cue } from '../subtitles'

/**
 * Join short clips into one track with silence between them, and a cue per clip, so a deck of
 * snippets can be trained exactly like a subtitled video.
 */
export function stitch(clips: ({ samples: Float32Array } & Omit<Cue, 'start' | 'end'>)[], rate: number, gap = 0.5): { samples: Float32Array; cues: Cue[] } {
  const pad = Math.round(gap * rate)
  const total = clips.reduce((n, c) => n + c.samples.length + pad, pad)
  const samples = new Float32Array(total)
  const cues: Cue[] = []
  let pos = pad
  for (const { samples: s, ...cue } of clips) {
    samples.set(s, pos)
    cues.push({ ...cue, start: pos / rate, end: (pos + s.length) / rate })
    pos += s.length + pad
  }
  return { samples, cues }
}
