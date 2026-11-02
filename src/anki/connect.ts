import type { Tone } from '../analysis/tones'
import { parseWordField, pinyinTones } from './word'

/**
 * Minimal client for AnkiConnect (https://foosoft.net/projects/anki-connect/, add-on 2055492159),
 * which serves Anki's collection over HTTP on 127.0.0.1:8765 while Anki is open.
 */

export const DEFAULT_URL = 'http://127.0.0.1:8765'

export interface AnkiNote {
  noteId: number
  modelName: string
  tags: string[]
  fields: Record<string, { value: string; order: number }>
}

export class AnkiError extends Error {}

export class AnkiConnect {
  private readonly url: string
  private readonly key?: string

  constructor(url = DEFAULT_URL, key?: string) {
    this.url = url
    this.key = key
  }

  async invoke<T>(action: string, params: object = {}): Promise<T> {
    let res: Response
    try {
      // text/plain keeps this a "simple" request (no CORS preflight); AnkiConnect parses the body as JSON anyway.
      res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, version: 6, params, ...(this.key ? { key: this.key } : {}) }),
      })
    } catch {
      throw new AnkiError(
        `Can't reach Anki at ${this.url}. Is Anki open with the AnkiConnect add-on installed? ` +
          'If it is, this site may not be allowed yet (see the setup steps), or your browser blocks pages from talking to this computer (Safari does).',
      )
    }
    if (!res.ok) throw new AnkiError(`AnkiConnect: HTTP ${res.status}`)
    const body = (await res.json()) as { result: T; error: string | null }
    if (body.error) throw new AnkiError(`AnkiConnect: ${body.error}`)
    return body.result
  }

  /** Asks Anki to trust this site; the first time, Anki shows a Yes/No dialog. */
  async requestPermission(): Promise<void> {
    const r = await this.invoke<{ permission: string }>('requestPermission')
    if (r.permission !== 'granted') throw new AnkiError('Anki did not allow this site. Click "Yes" in the dialog Anki shows, then try again.')
  }

  deckNames = () => this.invoke<string[]>('deckNames')
  findNotes = (query: string) => this.invoke<number[]>('findNotes', { query })
  notesInfo = (notes: number[]) => this.invoke<AnkiNote[]>('notesInfo', { notes })
  /** Base64 of a file in collection.media, or false when it is missing. */
  retrieveMediaFile = (filename: string) => this.invoke<string | false>('retrieveMediaFile', { filename })
}

const SOUND = /\[sound:([^\]]+)\]/g

/** File names of the [sound:…] tags in a field. */
export function soundFiles(field: string): string[] {
  return [...field.matchAll(SOUND)].map((m) => decodeEntities(m[1]).trim())
}

/** Field HTML → plain text (no tags, sound tags, furigana readings or entities). */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(SOUND, ' ')
      .replace(/<(rt|rp)\b[^>]*>.*?<\/\1>/gis, '')
      .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase()
    if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)))
    return { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k] ?? ''
  })
}

const HAN = /\p{Script=Han}/u
const hanCount = (s: string) => [...s].filter((c) => HAN.test(c)).length
export const AUTO = ''
/** Word field setting: don't use one. */
export const NONE = '-'

export interface NoteClip {
  noteId: number
  audio: string
  /** What is said in the audio. */
  text: string
  /** The word being learned, as written on the card. */
  word?: string
  /** Its code-point range in `text`, when found there. */
  focus?: [number, number]
  /** Its tones from the card's pinyin, or null when there is no readable pinyin. */
  wordTones?: Tone[] | null
}

/**
 * The audio file, the sentence said in it and the word being learned, from one note.
 * AUTO picks: audio = the first field with a sound tag; sentence = the field with the most Chinese
 * characters; word = the first other field whose characters occur in the sentence (its pinyin may
 * follow it in the same field, e.g. "学习 xuéxí").
 */
export function noteClip(note: AnkiNote, audioField = AUTO, textField = AUTO, wordField = AUTO): NoteClip | null {
  const fields = Object.entries(note.fields)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name, f]) => ({ name, html: f.value, text: plainText(f.value) }))
  const audioEntry = audioField ? fields.find((f) => f.name === audioField) : fields.find((f) => soundFiles(f.html).length)
  const audio = audioEntry && soundFiles(audioEntry.html)[0]
  if (!audio) return null
  const sentence = textField
    ? fields.find((f) => f.name === textField)
    : fields.reduce<(typeof fields)[number] | undefined>((best, f) => (hanCount(f.text) > (best ? hanCount(best.text) : 0) ? f : best), undefined)
  const text = sentence?.text ?? ''
  if (!HAN.test(text)) return null
  const out: NoteClip = { noteId: note.noteId, audio, text }
  if (wordField === NONE) return out

  const chars = [...text]
  const find = (word: string): [number, number] | undefined => {
    const w = [...word]
    for (let i = 0; i + w.length <= chars.length; i++) if (w.every((c, k) => chars[i + k] === c)) return [i, i + w.length]
  }
  let wf: { word: string; rest: string } | null = null
  if (wordField) {
    const f = fields.find((x) => x.name === wordField)
    wf = f ? parseWordField(f.text) : null
  } else {
    for (const f of fields) {
      if (f === sentence) continue
      const p = parseWordField(f.text)
      if (p && p.word.length <= 8 && p.word !== text && find(p.word)) {
        wf = p
        break
      }
    }
  }
  if (!wf) return out
  out.word = wf.word
  out.focus = find(wf.word)
  out.wordTones = pinyinTones(wf.word, wf.rest)
  return out
}

/** Up to `n` items, picked at random (keeps the input order). */
export function sample<T>(items: T[], n: number, random = Math.random): T[] {
  if (items.length <= n) return items
  const idx = items.map((_, i) => i)
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (idx.length - i))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => items[i])
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
