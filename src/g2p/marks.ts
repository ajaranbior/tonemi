import type { Tone } from '../analysis/tones'

const MARKS: Record<string, string[]> = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'], e: ['e', 'ē', 'é', 'ě', 'è'], i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'], u: ['u', 'ū', 'ú', 'ǔ', 'ù'], ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
}

export function markTone(syllable: string, tone: Tone): string {
  const s = syllable.replace(/v/g, 'ü')
  if (tone === 0) return s
  let idx = s.search(/[ae]/)
  if (idx < 0) idx = s.indexOf('ou')
  if (idx < 0) {
    // last vowel
    for (let k = s.length - 1; k >= 0; k--) if (MARKS[s[k]]) { idx = k; break }
  }
  if (idx < 0) return s
  return s.slice(0, idx) + MARKS[s[idx]][tone] + s.slice(idx + 1)
}
