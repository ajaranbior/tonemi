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
export const AUTO = ''

export interface NoteClip {
  noteId: number
  audio: string
  text: string
}

/**
 * The audio file and Chinese text of a note. With AUTO the audio is the first field with a sound tag
 * and the text the first other field containing Chinese characters (in field order).
 */
export function noteClip(note: AnkiNote, audioField = AUTO, textField = AUTO): NoteClip | null {
  const fields = Object.entries(note.fields).sort((a, b) => a[1].order - b[1].order)
  const audioEntry = audioField ? fields.find(([n]) => n === audioField) : fields.find(([, f]) => soundFiles(f.value).length)
  const audio = audioEntry && soundFiles(audioEntry[1].value)[0]
  if (!audio) return null
  const textEntry = textField
    ? fields.find(([n]) => n === textField)
    : fields.find(([n, f]) => n !== audioEntry[0] && HAN.test(plainText(f.value)))
  const text = textEntry ? plainText(textEntry[1].value) : ''
  return HAN.test(text) ? { noteId: note.noteId, audio, text } : null
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
