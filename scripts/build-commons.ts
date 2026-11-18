/**
 * Adds real-speaker recordings from Lingua Libre (Wikimedia Commons, CC BY-SA) to the word bank as
 * extra voices (`alts`), and optionally as new single-syllable words. Existing ids are untouched, so
 * saved progress stays valid. Re-running replaces the Lingua Libre recordings (speaker ids starting
 * "ll-") of the items in scope; a word added by an earlier run keeps its id.
 *
 *   npm run build-commons              # search Commons, download, validate, write
 *   LIST=1 npm run build-commons       # only list speakers and clip counts (after searching)
 *   CLIPS=/path npm run build-commons  # reuse downloads from an earlier run (skips the network)
 *
 * Environment:
 *   SPEAKERS=a,b   only these Lingua Libre user names
 *   EXCLUDE=a,b    skip these user names (e.g. speakers whose accent isn't Mainland Putonghua)
 *   MIN_KEPT=15    a speaker needs this many validated clips to become a voice (default 15)
 *   MAX_PER_WORD=4 at most this many Commons voices per word (default 4)
 *   LISTING=category  list files from the rendered category pages and file pages instead of the API
 *                  search (for when the API answers 429). Also finds words that aren't in the bank.
 *   KIND=single    only add recordings to words of this kind (single, pair, triple)
 *   TONES=1        only add recordings to words whose lexical tones are all in this set (e.g. 1 or 34)
 *   NEW_WORDS=1    with LISTING=category and KIND=single: also add single characters that aren't in
 *                  the bank yet (one reading only, in GB2312, so simplified), each as a new item
 *                  whose main recording is the first accepted Lingua Libre clip.
 *   HSK=/path/audio-cmn  an audio-cmn clone, for the HSK level of new words (otherwise 7)
 *   RANGE_CLIPS=40 in category mode, up to this many other single-character clips per speaker are
 *                  downloaded only to measure the speaker's pitch range (so a tone-1-only run still
 *                  sees their low tones)
 *   DELAY_MS=1500  pause between requests to Wikimedia
 *
 * Every clip is pitch-analysed with the app's own pipeline exactly like the other voices: a clip whose
 * contour contradicts the expected tones, or that can't be split into the right number of syllables,
 * is dropped. That also weeds out other accents, wrong readings and noisy recordings.
 * Needs ffmpeg and curl (curl so the sandbox/corporate proxy settings apply).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pinyin } from 'pinyin-pro'
import { chaoTrack, rangeFromSemitones, voicedSemitones } from '../src/analysis/normalize'
import { hzToSt, trackPitch, type PitchTrack } from '../src/analysis/pitch'
import { segmentSyllables, type Segmentation } from '../src/analysis/segment'
import { syllableContour } from '../src/analysis/contour'
import { recognizeTone, type Tone } from '../src/analysis/tones'
import { isMandarinLang, licenseOk, parseCategoryPage, parseCommonsTitle, parseFilePage, speakerId } from '../src/bank/commons'
import type { BankItem, ItemKind, Manifest, Recording } from '../src/bank/types'

const OUT = resolve('public/bank')
const API = 'https://commons.wikimedia.org/w/api.php'
const SITE = 'https://commons.wikimedia.org'
const CATEGORY = '/wiki/Category:Lingua_Libre_pronunciation-cmn'
const UA = 'tonemi-bank-builder/1.0 (https://github.com/ajaranbior/tonemi; personal language-learning app)'
const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const ONLY = new Set(list(process.env.SPEAKERS))
const SKIP = new Set(list(process.env.EXCLUDE))
const MIN_KEPT = Number(process.env.MIN_KEPT ?? 15)
const MAX_PER_WORD = Number(process.env.MAX_PER_WORD ?? 4)
const CATEGORY_MODE = process.env.LISTING === 'category'
const KIND = process.env.KIND as ItemKind | undefined
if (KIND && !['single', 'pair', 'triple'].includes(KIND)) throw new Error('KIND must be single, pair or triple')
const TONES = process.env.TONES ? new Set([...process.env.TONES].map(Number)) : null
const NEW_WORDS = process.env.NEW_WORDS === '1'
if (NEW_WORDS && (!CATEGORY_MODE || KIND !== 'single')) throw new Error('NEW_WORDS needs LISTING=category and KIND=single')
const RANGE_CLIPS = Number(process.env.RANGE_CLIPS ?? 40)
const DELAY_MS = Number(process.env.DELAY_MS ?? 1500)
const SONORANT = new Set(['', 'm', 'n', 'l', 'r', 'y', 'w'])
/** Same as build-bank: 一/不 sandhi and particles. */
const EXCLUDE_CHARS = /[一不了的得地着过吗呢吧么啊呀]/

const manifest: Manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'tonemi-commons-'))
const clips = process.env.CLIPS ? resolve(process.env.CLIPS) : join(work, 'clips')
mkdirSync(clips, { recursive: true })

const isLL = (id: string) => id.startsWith('ll-')
const inScope = (kind: ItemKind, lexical: Tone[]) => (!KIND || kind === KIND) && (!TONES || lexical.every((t) => TONES.has(t)))

/** A word not in the bank yet, which becomes an item if one of its clips is accepted. */
interface NewWord {
  hanzi: string
  syllables: string[]
  lexical: Tone[]
  combo: string
  sonorant: boolean
  level: number
}

/**
 * One downloaded recording, cached as `<clips>/<speakerId>/<key>.<ext>`. `item` is a bank id, or
 * "new:<hanzi>" for a word not in the bank; range-only clips have no item.
 */
interface Clip {
  item?: string
  file: string
  page: string
}
interface SpeakerMeta {
  name: string
  license: string
  clips: Clip[]
}
const metaFile = join(clips, 'meta.json')

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const curl = (url: string, ...args: string[]) => {
  if (DELAY_MS) sleep(DELAY_MS)
  return execFileSync('curl', ['-sS', '--fail', '--connect-timeout', '10', '--max-time', '30', '--retry', '2', '--retry-delay', '5', '-A', UA, ...args, url], { maxBuffer: 1 << 28 })
}
const errLine = (e: unknown) => (e as Error).message.split('\n')[0]

/** Single characters with one reading, in GB2312 (simplified), not particles or 一/不. */
const gb2312 = (() => {
  const dec = new TextDecoder('gbk')
  const set = new Set<string>()
  for (let a = 0xb0; a <= 0xf7; a++) for (let b = 0xa1; b <= 0xfe; b++) set.add(dec.decode(new Uint8Array([a, b])))
  return set
})()
function hskLevels(): Map<string, number> {
  const levels = new Map<string, number>()
  if (!process.env.HSK) return levels
  for (let l = 1; l <= 6; l++) {
    const text = execFileSync('git', ['-C', resolve(process.env.HSK), 'show', `HEAD:lists/HSK2012_${l}.txt`]).toString()
    for (const w of text.split('\n').slice(1)) if (w.trim() && !levels.has(w.trim())) levels.set(w.trim(), l)
  }
  return levels
}
function newWord(hanzi: string, levels: Map<string, number>): NewWord | null {
  if ([...hanzi].length !== 1 || !gb2312.has(hanzi) || EXCLUDE_CHARS.test(hanzi)) return null
  const readings = new Set(pinyin(hanzi, { multiple: true, type: 'array', toneType: 'num' }).map((p) => p.slice(-1)))
  if (readings.size !== 1) return null
  const tone = Number([...readings][0]) as Tone
  if (!(tone >= 1 && tone <= 4) || !inScope('single', [tone])) return null
  return {
    hanzi,
    syllables: pinyin(hanzi, { toneType: 'none', type: 'array', v: true }).map((s) => s.replace(/v/g, 'ü')),
    lexical: [tone],
    combo: String(tone),
    sonorant: SONORANT.has(pinyin(hanzi, { pattern: 'initial' })),
    level: levels.get(hanzi) ?? 7,
  }
}

const itemsByHanzi = new Map<string, BankItem[]>()
for (const i of manifest.items) itemsByHanzi.set(i.hanzi, [...(itemsByHanzi.get(i.hanzi) ?? []), i])
const newWords = new Map<string, NewWord>()

function download(dir: string, key: string, url: string): string | null {
  const file = join(dir, `${key}${/\.[a-z0-9]+$/i.exec(url)?.[0] ?? '.wav'}`)
  if (existsSync(file)) return file
  try {
    writeFileSync(file, curl(url))
    return file
  } catch (e) {
    console.warn(`download failed ${url}: ${errLine(e)}`)
    return null
  }
}

async function fetchClipsBySearch(): Promise<Record<string, SpeakerMeta>> {
  const speakers: Record<string, SpeakerMeta> = {}
  const words = [...itemsByHanzi].filter(([, items]) => items.some((i) => inScope(i.kind, i.lexical)))
  let n = 0
  for (const [hanzi, items] of words) {
    n++
    if (n % 25 === 0) console.log(`searched ${n}/${words.length} words`)
    let json: any
    try {
      const q = new URLSearchParams({
        action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '50',
        // Commons search tokenizes "LL-Q" poorly; LL matches the prefix, then the parser vets it.
        gsrsearch: `intitle:LL intitle:"${hanzi}"`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'LicenseShortName',
      })
      json = JSON.parse(curl(`${API}?${q}`).toString())
    } catch (e) {
      console.warn(`search failed for ${hanzi}: ${errLine(e)}`)
      continue
    }
    for (const page of Object.values<any>(json.query?.pages ?? {})) {
      const f = parseCommonsTitle(page.title ?? '')
      const info = page.imageinfo?.[0]
      if (!f || f.word !== hanzi || !isMandarinLang(f.lang) || !info?.url) continue
      if (ONLY.size && !ONLY.has(f.speaker)) continue
      if (SKIP.has(f.speaker)) continue
      const license = info.extmetadata?.LicenseShortName?.value as string | undefined
      if (!licenseOk(license)) continue
      const id = speakerId(f.speaker)
      const dir = join(clips, id)
      mkdirSync(dir, { recursive: true })
      const sp = (speakers[id] ??= { name: f.speaker, license: license!, clips: [] })
      for (const item of items) {
        if (!inScope(item.kind, item.lexical)) continue
        const file = download(dir, item.id, info.url)
        if (file) sp.clips.push({ item: item.id, file, page: `${SITE}/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` })
      }
    }
  }
  return speakers
}

async function fetchClipsByCategory(): Promise<Record<string, SpeakerMeta>> {
  const titles: string[] = []
  for (let next: string | null = CATEGORY, n = 1; next; n++) {
    const page = parseCategoryPage(curl(SITE + next).toString())
    titles.push(...page.titles)
    console.log(`category page ${n}: ${titles.length} files`)
    next = page.next
  }
  const levels = NEW_WORDS ? hskLevels() : new Map<string, number>()
  // Pick what to fetch per speaker: clips to add, then other single characters for the range.
  const wanted = new Map<string, { title: string; speaker: string; item?: string }[]>()
  const spare = new Map<string, { title: string; speaker: string }[]>()
  for (const title of new Set(titles)) {
    const f = parseCommonsTitle(title)
    if (!f || !isMandarinLang(f.lang)) continue
    if (ONLY.size && !ONLY.has(f.speaker)) continue
    if (SKIP.has(f.speaker)) continue
    const id = speakerId(f.speaker)
    const items = (itemsByHanzi.get(f.word) ?? []).filter((i) => inScope(i.kind, i.lexical))
    for (const i of items) wanted.set(id, [...(wanted.get(id) ?? []), { title, speaker: f.speaker, item: i.id }])
    if (items.length) continue
    const nw = NEW_WORDS && !itemsByHanzi.has(f.word) ? newWord(f.word, levels) : null
    if (nw) {
      newWords.set(nw.hanzi, nw)
      wanted.set(id, [...(wanted.get(id) ?? []), { title, speaker: f.speaker, item: `new:${nw.hanzi}` }])
    } else if ([...f.word].length === 1) spare.set(id, [...(spare.get(id) ?? []), { title, speaker: f.speaker }])
  }
  const speakers: Record<string, SpeakerMeta> = {}
  const pages = new Map<string, { url: string; license: string } | null>()
  const fileInfo = (title: string) => {
    if (!pages.has(title)) {
      try {
        const { url, license } = parseFilePage(curl(`${SITE}/wiki/File:${encodeURIComponent(title.replace(/ /g, '_'))}`).toString())
        pages.set(title, url && licenseOk(license) ? { url, license: license! } : null)
      } catch (e) {
        console.warn(`file page failed ${title}: ${errLine(e)}`)
        pages.set(title, null)
      }
    }
    return pages.get(title)!
  }
  for (const [id, want] of wanted) {
    const dir = join(clips, id)
    mkdirSync(dir, { recursive: true })
    const extra = (spare.get(id) ?? []).sort(() => Math.random() - 0.5).slice(0, Math.max(0, RANGE_CLIPS))
    console.log(`${want[0].speaker}: ${want.length} clips to check, ${extra.length} for range`)
    const todo: { title: string; speaker: string; item?: string }[] = [...want, ...extra]
    for (const [k, w] of todo.entries()) {
      const info = fileInfo(w.title)
      if (!info) continue
      const sp = (speakers[id] ??= { name: w.speaker, license: info.license, clips: [] })
      const item = w.item
      const file = download(dir, item ? item.replace(':', '-') : `range-${k}`, info.url)
      if (file) sp.clips.push({ item, file, page: `${SITE}/wiki/File:${encodeURIComponent(w.title.replace(/ /g, '_'))}` })
    }
  }
  return speakers
}

const decode = (file: string) => {
  const buf = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/** Same rule as the other voices: a clear contradiction on any toned syllable rejects the clip. */
function tonesMatch(track: PitchTrack, seg: Segmentation, surface: Tone[], range: { lo: number; hi: number }): boolean {
  const chao = chaoTrack(track, range)
  return surface.every((t, i) => {
    if (t === 0) return true
    const c5 = syllableContour(chao, seg.segments[i], 5, 0.1)
    if (!c5) return false
    const r = recognizeTone(c5, i === surface.length - 1)
    return r.tone === t || r.confidence <= 0.5
  })
}

const round1 = (x: number) => Math.round(x * 10) / 10

let speakers: Record<string, SpeakerMeta>
if (existsSync(metaFile) && process.env.CLIPS) {
  const saved = JSON.parse(readFileSync(metaFile, 'utf8'))
  speakers = saved.speakers ?? saved
  for (const w of saved.newWords ?? []) newWords.set(w.hanzi, w)
} else {
  speakers = CATEGORY_MODE ? await fetchClipsByCategory() : await fetchClipsBySearch()
  writeFileSync(metaFile, JSON.stringify({ speakers, newWords: [...newWords.values()] }))
}
const ranked = Object.entries(speakers).sort((a, b) => b[1].clips.filter((c) => c.item).length - a[1].clips.filter((c) => c.item).length)
console.log(`${ranked.length} Lingua Libre speakers:`)
for (const [id, s] of ranked) console.log(`  ${s.name.padEnd(28)} ${String(s.clips.filter((c) => c.item).length).padStart(4)} clips  ${s.license}  (${id})`)
if (process.env.LIST) process.exit(0)

// Drop the Lingua Libre recordings of in-scope items added by an earlier run. Words that an earlier
// run added (main recording from Lingua Libre) are rebuilt below under the same id.
const previousIds = new Map<string, string>()
const dropped: string[] = []
manifest.items = manifest.items.filter((item) => {
  if (!inScope(item.kind, item.lexical)) return true
  dropped.push(...(item.alts ?? []).filter((a) => isLL(a.speaker)).map((a) => a.audio))
  item.alts = item.alts?.filter((a) => !isLL(a.speaker))
  if (!item.alts?.length) delete item.alts
  if (!isLL(item.speaker)) return true
  dropped.push(item.audio)
  previousIds.set(item.hanzi, item.id)
  const nw = newWords.get(item.hanzi)
  if (!nw) newWords.set(item.hanzi, { hanzi: item.hanzi, syllables: item.syllables, lexical: item.lexical, combo: item.combo, sonorant: item.sonorant, level: item.level })
  return false
})
for (const audio of dropped) rmSync(join(OUT, audio), { force: true })
const itemById = new Map(manifest.items.map((i) => [i.id, i]))
// A clip of a word that an earlier run added still refers to it by id; treat it as a new word again.
const target = (clipItem: string) => {
  if (clipItem.startsWith('new:')) return { id: clipItem, kind: 'single' as ItemKind, surface: newWords.get(clipItem.slice(4))?.lexical }
  const item = itemById.get(clipItem)
  if (item) return { id: clipItem, kind: item.kind, surface: item.surface }
  const hanzi = [...previousIds].find(([, id]) => id === clipItem)?.[0]
  return hanzi ? { id: `new:${hanzi}`, kind: 'single' as ItemKind, surface: newWords.get(hanzi)?.lexical } : null
}

interface Kept {
  item: string
  rec: Recording
}
const keptBy = new Map<string, Kept[]>()
const ranges = new Map<string, { lo: number; hi: number }>()
for (const [id, s] of ranked) {
  const tracks: { track: PitchTrack; clip: Clip }[] = []
  const seen = new Set<string>()
  for (const clip of s.clips) {
    if (clip.item && seen.has(clip.item)) continue
    try {
      tracks.push({ track: trackPitch(decode(clip.file)), clip })
      if (clip.item) seen.add(clip.item)
    } catch {
      // undecodable file: skip
    }
  }
  const range = rangeFromSemitones(tracks.flatMap((t) => voicedSemitones(t.track)))
  if (!range) continue
  const dir = join(OUT, 'audio', id)
  mkdirSync(dir, { recursive: true })
  const kept: Kept[] = []
  let tried = 0
  for (const { track, clip } of tracks) {
    const t = clip.item ? target(clip.item) : null
    if (!t?.surface) continue
    tried++
    const n = t.surface.length
    const seg = segmentSyllables(track, n)
    if (!seg?.confident || !tonesMatch(track, seg, t.surface, range)) continue
    // Trim to the word ± 0.15 s, encode, and measure the reference pitch on the encoded file.
    const from = Math.max(0, seg.segments[0][0] * track.hop - 0.15)
    const to = seg.segments[n - 1][1] * track.hop + 0.15
    const audio = `audio/${id}/${t.id.replace(':', '-')}.mp3`
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', clip.file,
      '-af', 'afade=t=in:d=0.02,loudnorm=I=-20:TP=-2', '-ac', '1', '-ar', '24000', '-b:a', '40k', join(OUT, audio)])
    const enc = trackPitch(decode(join(OUT, audio)))
    const encSeg = segmentSyllables(enc, n)
    if (!encSeg?.confident || !tonesMatch(enc, encSeg, t.surface, range)) {
      rmSync(join(OUT, audio))
      continue
    }
    kept.push({
      item: t.id,
      rec: { speaker: id, audio, source: clip.page, ref: { hop: enc.hop, t0: 0, st: Array.from(enc.hz, (hz) => (Number.isNaN(hz) ? null : round1(hzToSt(hz)))), segments: encSeg.segments } },
    })
  }
  console.log(`${s.name}: kept ${kept.length}/${tried}`)
  if (kept.length < MIN_KEPT) {
    for (const k of kept) rmSync(join(OUT, k.rec.audio), { force: true })
    console.log(`  → fewer than ${MIN_KEPT}, not added`)
    continue
  }
  keptBy.set(id, kept)
  ranges.set(id, range)
}

// Prolific speakers first, at most MAX_PER_WORD per word. A new word's first recording is its main one.
const perWord = new Map<string, number>()
const used = new Set<string>()
const created: BankItem[] = []
const newId = (combo: string) => {
  let suffix = manifest.items.filter((i) => i.combo === combo).length
  while (manifest.items.some((i) => i.id === `${combo}-${suffix}`)) suffix++
  return `${combo}-${suffix}`
}
const createdByHanzi = new Map<string, BankItem>()
for (const [id] of ranked) {
  for (const k of keptBy.get(id) ?? []) {
    const n = perWord.get(k.item) ?? 0
    if (n >= MAX_PER_WORD) {
      rmSync(join(OUT, k.rec.audio), { force: true })
      continue
    }
    perWord.set(k.item, n + 1)
    used.add(id)
    if (!k.item.startsWith('new:')) {
      const item = itemById.get(k.item)!
      item.alts = [...(item.alts ?? []), k.rec]
      continue
    }
    const hanzi = k.item.slice(4)
    const existing = createdByHanzi.get(hanzi)
    if (existing) {
      existing.alts = [...(existing.alts ?? []), k.rec]
      continue
    }
    const w = newWords.get(hanzi)!
    const item: BankItem = {
      id: previousIds.get(hanzi) ?? newId(w.combo), hanzi, syllables: w.syllables, lexical: w.lexical, surface: w.lexical, combo: w.combo,
      kind: 'single', sonorant: w.sonorant, level: w.level, speaker: k.rec.speaker, audio: k.rec.audio, source: k.rec.source, ref: k.rec.ref,
    }
    manifest.items.push(item)
    createdByHanzi.set(hanzi, item)
    created.push(item)
  }
}
for (const id of used) {
  const s = speakers[id]
  const r = ranges.get(id)!
  manifest.speakers[id] = {
    name: `${s.name} (Lingua Libre, Wikimedia Commons)`,
    short: s.name,
    source: 'https://commons.wikimedia.org/wiki/Category:Lingua_Libre_pronunciation-cmn',
    license: s.license,
    range: { lo: round1(r.lo), hi: round1(r.hi) },
  }
}
// Forget Lingua Libre speakers (and their folders) that no recording uses any more.
const speaking = new Set(manifest.items.flatMap((i) => [i.speaker, ...(i.alts ?? []).map((a) => a.speaker)]))
for (const id of Object.keys(manifest.speakers)) if (isLL(id) && !speaking.has(id)) delete manifest.speakers[id]
for (const d of existsSync(join(OUT, 'audio')) ? readdirSync(join(OUT, 'audio')) : []) {
  if (isLL(d) && !speaking.has(d)) rmSync(join(OUT, 'audio', d), { recursive: true, force: true })
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))
rmSync(work, { recursive: true, force: true })
const withLL = manifest.items.filter((i) => isLL(i.speaker) || i.alts?.some((a) => isLL(a.speaker))).length
console.log(`${used.size} Lingua Libre voices used; new words: ${created.length} (${created.map((i) => i.hanzi).join('')}); words with a Lingua Libre voice: ${withLL}/${manifest.items.length}`)
