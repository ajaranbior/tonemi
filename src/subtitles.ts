export interface Cue {
  start: number
  end: number
  text: string
}

/** Parse SRT or WebVTT. */
export function parseSubtitles(src: string): Cue[] {
  const cues: Cue[] = []
  const blocks = src.replace(/\r/g, '').split(/\n\s*\n/)
  const time = /((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/
  for (const block of blocks) {
    const lines = block.split('\n')
    const idx = lines.findIndex((l) => time.test(l))
    if (idx < 0) continue
    const m = time.exec(lines[idx])!
    const text = lines
      .slice(idx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\{[^}]+\}/g, '')
      .trim()
    if (text) cues.push({ start: toSeconds(m[1]), end: toSeconds(m[2]), text })
  }
  return cues.sort((a, b) => a.start - b.start)
}

function toSeconds(s: string): number {
  const parts = s.replace(',', '.').split(':').map(Number)
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}
