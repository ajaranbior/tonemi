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
