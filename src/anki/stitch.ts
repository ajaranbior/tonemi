import type { Cue } from '../subtitles'

/**
 * Join short clips into one track with silence between them, and a cue per clip, so a deck of
 * snippets can be trained exactly like a subtitled video.
 */
export function stitch(clips: { samples: Float32Array; text: string }[], rate: number, gap = 0.5): { samples: Float32Array; cues: Cue[] } {
  const pad = Math.round(gap * rate)
  const total = clips.reduce((n, c) => n + c.samples.length + pad, pad)
  const samples = new Float32Array(total)
  const cues: Cue[] = []
  let pos = pad
  for (const c of clips) {
    samples.set(c.samples, pos)
    cues.push({ start: pos / rate, end: (pos + c.samples.length) / rate, text: c.text })
    pos += c.samples.length + pad
  }
  return { samples, cues }
}

/** 16-bit mono PCM WAV, playable by any <audio> element. */
export function wavBlob(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}
