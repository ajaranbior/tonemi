import { pinyin } from 'pinyin-pro'
import type { Tone } from '../analysis/tones'

const HAN_RUN = /\p{Script=Han}+/u

/** "学习 xuéxí", "学习 (xue2 xi2) to study" → the first run of characters and the text after it. */
export function parseWordField(text: string): { word: string; rest: string } | null {
  const m = HAN_RUN.exec(text)
  return m ? { word: m[0], rest: text.slice(m.index + m[0].length) } : null
}

const MARKED: Record<string, [string, Tone]> = {}
// Vowels carry tones 1–4; syllabic m and n only appear with tones 2–4 (ḿ, ń ň ǹ).
for (const [base, marks, first] of [['a', 'āáǎà', 1], ['e', 'ēéěè', 1], ['i', 'īíǐì', 1], ['o', 'ōóǒò', 1], ['u', 'ūúǔù', 1], ['v', 'ǖǘǚǜ', 1], ['m', '\u1E3F', 2], ['n', 'ńňǹ', 2]] as const) {
  ;[...marks].forEach((c, i) => (MARKED[c] = [base, (first + i) as Tone]))
}
MARKED['ü'] = ['v', 0]

type Tok = { c: string; tone: Tone | 0 | null } | { digit: number } | { sep: true }

function tokenize(s: string): Tok[] {
  const out: Tok[] = []
  for (const ch of s.normalize('NFC').toLowerCase()) {
    if (/[a-z]/.test(ch)) out.push({ c: ch, tone: null })
    else if (MARKED[ch]) {
      const [c, t] = MARKED[ch]
      out.push({ c, tone: t || null })
    } else if (/[0-5]/.test(ch)) out.push({ digit: Number(ch) })
    else out.push({ sep: true })
  }
  return out
}

/**
 * Tones of `word` read from the pinyin that follows it on the card, written with tone marks
 * (xuéxí, xué xí) or numbers (xue2xi2, xue2 xi2); a syllable without a mark or digit is neutral.
 * Syllables are matched against each character's dictionary readings, so missing spaces are fine.
 * Returns null when the pinyin can't be lined up with the characters.
 */
export function pinyinTones(word: string, text: string): Tone[] | null {
  const chars = [...word]
  const toks = tokenize(text)
  let pos = 0
  const tones: Tone[] = []
  for (const ch of chars) {
    while (pos < toks.length && !('c' in toks[pos])) pos++
    const readings = pinyin(ch, { multiple: true, type: 'array', toneType: 'none', v: true }) as string[]
    const cands = [...new Set([...readings, ...readings.map((r) => r.replace(/v/g, 'u')), ...(ch === '儿' ? ['r'] : [])])].sort((a, b) => b.length - a.length)
    const hit = cands.find((r) => [...r].every((c, k) => { const t = toks[pos + k]; return !!t && 'c' in t && t.c === c }))
    if (!hit) return null
    let tone: Tone | null = null
    for (let k = 0; k < hit.length; k++) {
      const t = toks[pos + k] as { tone: Tone | null }
      if (t.tone) tone = t.tone
    }
    pos += hit.length
    const next = toks[pos]
    if (next && 'digit' in next) {
      tone = (next.digit === 5 ? 0 : next.digit) as Tone
      pos++
    }
    tones.push(tone ?? 0)
  }
  return tones
}
