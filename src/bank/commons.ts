/** Helpers for reading Lingua Libre recordings on Wikimedia Commons (used by scripts/build-commons.ts). */

export interface CommonsFile {
  /** Language code in the file name, e.g. "cmn". */
  lang: string
  /** The recorder's Lingua Libre user name. */
  speaker: string
  /** The recorded word, Chinese characters only. */
  word: string
}

/** "File:LL-Q727694 (cmn)-Yue Tan-猫.wav" → its parts, or null for anything else. */
export function parseCommonsTitle(title: string): CommonsFile | null {
  const m = /^(?:File:)?LL-Q\d+ \(([a-z]{2,3})\)-(.+)-([一-鿿]+)\.(?:wav|flac|ogg|opus|mp3)$/i.exec(title.trim())
  return m ? { lang: m[1].toLowerCase(), speaker: m[2].trim(), word: m[3] } : null
}

/** Mandarin only; Lingua Libre files "zho" for unspecified Chinese, which the tone check then vets. */
export const isMandarinLang = (lang: string) => lang === 'cmn' || lang === 'zho'

/** Licences we can redistribute with credit: Creative Commons (BY, BY-SA, CC0) and public domain. */
export function licenseOk(shortName: string | undefined): boolean {
  if (!shortName) return false
  const s = shortName.trim()
  if (/\bNC\b|-NC|\bND\b|-ND/i.test(s)) return false
  return /^(CC BY|CC0|Public domain)/i.test(s)
}

/** A stable manifest id for a speaker: "ll-" plus the user name, lower-cased ASCII. */
export function speakerId(name: string): string {
  const slug = name.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  if (slug) return `ll-${slug}`
  // Non-Latin user name: a short hash keeps the id stable and unique.
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return `ll-${h.toString(36)}`
}

const unescapeHtml = (s: string) =>
  s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/**
 * One page of a Commons category as rendered HTML: its file titles (without "File:") and the
 * site-relative link to the next page, if any. Used when the API is rate-limited but pages are not.
 */
export function parseCategoryPage(html: string): { titles: string[]; next: string | null } {
  const titles = [...new Set([...html.matchAll(/title="File:([^"]+)"/g)].map((m) => unescapeHtml(m[1])))]
  const next = /href="([^"]*filefrom=[^"]*)"[^>]*>next page</.exec(html)?.[1]
  return { titles, next: next ? unescapeHtml(next).replace(/#.*$/, '') : null }
}

/** A Commons file page as rendered HTML → the original file's URL and its licence's short name. */
export function parseFilePage(html: string): { url: string | null; license: string | undefined } {
  const url = /href="(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/[^"]+)"/.exec(html)?.[1] ?? null
  const license = /class="licensetpl(?:_|&#95;)short"[^>]*>([^<]+)</.exec(html)?.[1]
  return { url: url && unescapeHtml(url), license: license && unescapeHtml(license).trim() }
}
