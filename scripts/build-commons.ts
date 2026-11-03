/**
 * Adds real-speaker recordings from Lingua Libre (Wikimedia Commons, CC BY-SA) to the word bank as
 * extra voices (`alts`). Words and ids are untouched, so saved progress stays valid. Re-running
 * replaces the previously added Lingua Libre speakers (ids starting "ll-").
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
import { chaoTrack, rangeFromSemitones, voicedSemitones } from '../src/analysis/normalize'
import { hzToSt, trackPitch, type PitchTrack } from '../src/analysis/pitch'
import { segmentSyllables, type Segmentation } from '../src/analysis/segment'
import { syllableContour } from '../src/analysis/contour'
import { recognizeTone, type Tone } from '../src/analysis/tones'
import { isMandarinLang, licenseOk, parseCommonsTitle, speakerId } from '../src/bank/commons'
import type { Manifest, Recording } from '../src/bank/types'

const OUT = resolve('public/bank')
const API = 'https://commons.wikimedia.org/w/api.php'
const UA = 'tonemi-bank-builder/1.0 (https://github.com/ajaranbior/tonemi; personal language-learning app)'
const list = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const ONLY = new Set(list(process.env.SPEAKERS))
const SKIP = new Set(list(process.env.EXCLUDE))
const MIN_KEPT = Number(process.env.MIN_KEPT ?? 15)
const MAX_PER_WORD = Number(process.env.MAX_PER_WORD ?? 4)

const manifest: Manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'tonemi-commons-'))
const clips = process.env.CLIPS ? resolve(process.env.CLIPS) : join(work, 'clips')
mkdirSync(clips, { recursive: true })

/** One downloaded recording, cached as `<clips>/<speakerId>/<itemId>.<ext>`. */
interface Clip {
  item: string
  file: string
  page: string
}
interface SpeakerMeta {
  name: string
  license: string
  clips: Clip[]
}
const metaFile = join(clips, 'meta.json')

const curl = (url: string, ...args: string[]) =>
  execFileSync('curl', ['-sS', '--fail', '--retry', '3', '--retry-delay', '2', '-A', UA, ...args, url], { maxBuffer: 1 << 28 })

async function fetchClips(): Promise<Record<string, SpeakerMeta>> {
  const byHanzi = new Map<string, string[]>()
  for (const i of manifest.items) byHanzi.set(i.hanzi, [...(byHanzi.get(i.hanzi) ?? []), i.id])
  const speakers: Record<string, SpeakerMeta> = {}
  let n = 0
  for (const [hanzi, ids] of byHanzi) {
    n++
    if (n % 25 === 0) console.log(`searched ${n}/${byHanzi.size} words`)
    let json: any
    try {
      const q = new URLSearchParams({
        action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '50',
        gsrsearch: `intitle:"LL-Q" intitle:"${hanzi}"`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'LicenseShortName',
      })
      json = JSON.parse(curl(`${API}?${q}`).toString())
    } catch (e) {
      console.warn(`search failed for ${hanzi}: ${(e as Error).message.split('\n')[0]}`)
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
      for (const item of ids) {
        const file = join(dir, `${item}${/\.[a-z0-9]+$/i.exec(info.url)?.[0] ?? '.wav'}`)
        if (!existsSync(file)) {
          try {
            writeFileSync(file, curl(info.url))
          } catch (e) {
            console.warn(`download failed ${page.title}: ${(e as Error).message.split('\n')[0]}`)
            continue
          }
        }
        sp.clips.push({ item, file, page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}` })
      }
    }
  }
  writeFileSync(metaFile, JSON.stringify(speakers))
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

const speakers: Record<string, SpeakerMeta> = existsSync(metaFile) && process.env.CLIPS ? JSON.parse(readFileSync(metaFile, 'utf8')) : await fetchClips()
const ranked = Object.entries(speakers).sort((a, b) => b[1].clips.length - a[1].clips.length)
console.log(`${ranked.length} Lingua Libre speakers:`)
for (const [id, s] of ranked) console.log(`  ${s.name.padEnd(28)} ${String(s.clips.length).padStart(4)} clips  ${s.license}  (${id})`)
if (process.env.LIST) process.exit(0)

// Drop the Lingua Libre voices added by an earlier run.
const isLL = (id: string) => id.startsWith('ll-')
for (const item of manifest.items) {
  item.alts = item.alts?.filter((a) => !isLL(a.speaker))
  if (!item.alts?.length) delete item.alts
}
for (const id of Object.keys(manifest.speakers)) if (isLL(id)) delete manifest.speakers[id]
for (const d of existsSync(join(OUT, 'audio')) ? readdirSync(join(OUT, 'audio')) : []) if (isLL(d)) rmSync(join(OUT, 'audio', d), { recursive: true, force: true })
const itemById = new Map(manifest.items.map((i) => [i.id, i]))

interface Kept {
  item: string
  rec: Recording
}
const keptBy = new Map<string, Kept[]>()
const ranges = new Map<string, { lo: number; hi: number }>()
for (const [id, s] of ranked) {
  const tracks = new Map<string, { track: PitchTrack; clip: Clip }>()
  for (const clip of s.clips) {
    if (!itemById.has(clip.item) || tracks.has(clip.item)) continue
    try {
      tracks.set(clip.item, { track: trackPitch(decode(clip.file)), clip })
    } catch {
      // undecodable file: skip
    }
  }
  const st = [...tracks.values()].flatMap((t) => voicedSemitones(t.track))
  const range = st.length ? rangeFromSemitones(st) : null
  if (!range) continue
  const dir = join(OUT, 'audio', id)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const kept: Kept[] = []
  for (const [itemId, { track, clip }] of tracks) {
    const item = itemById.get(itemId)!
    const n = item.surface.length
    const seg = segmentSyllables(track, n)
    if (!seg?.confident || !tonesMatch(track, seg, item.surface, range)) continue
    // Trim to the word ± 0.15 s, encode, and measure the reference pitch on the encoded file.
    const from = Math.max(0, seg.segments[0][0] * track.hop - 0.15)
    const to = seg.segments[n - 1][1] * track.hop + 0.15
    const audio = `audio/${id}/${itemId}.mp3`
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', clip.file,
      '-af', 'afade=t=in:d=0.02,loudnorm=I=-20:TP=-2', '-ac', '1', '-ar', '24000', '-b:a', '40k', join(OUT, audio)])
    const enc = trackPitch(decode(join(OUT, audio)))
    const encSeg = segmentSyllables(enc, n)
    if (!encSeg?.confident || !tonesMatch(enc, encSeg, item.surface, range)) {
      rmSync(join(OUT, audio))
      continue
    }
    kept.push({
      item: itemId,
      rec: { speaker: id, audio, source: clip.page, ref: { hop: enc.hop, t0: 0, st: Array.from(enc.hz, (hz) => (Number.isNaN(hz) ? null : round1(hzToSt(hz)))), segments: encSeg.segments } },
    })
  }
  console.log(`${s.name}: kept ${kept.length}/${tracks.size}`)
  if (kept.length < MIN_KEPT) {
    rmSync(dir, { recursive: true, force: true })
    console.log(`  → fewer than ${MIN_KEPT}, not added`)
    continue
  }
  keptBy.set(id, kept)
  ranges.set(id, range)
}

// Prolific speakers first, at most MAX_PER_WORD per word.
const perWord = new Map<string, number>()
const used = new Set<string>()
for (const [id] of ranked) {
  for (const k of keptBy.get(id) ?? []) {
    const n = perWord.get(k.item) ?? 0
    if (n >= MAX_PER_WORD) {
      rmSync(join(OUT, k.rec.audio), { force: true })
      continue
    }
    perWord.set(k.item, n + 1)
    const item = itemById.get(k.item)!
    item.alts = [...(item.alts ?? []), k.rec]
    used.add(id)
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

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))
rmSync(work, { recursive: true, force: true })
const withLL = manifest.items.filter((i) => i.alts?.some((a) => isLL(a.speaker))).length
console.log(`${used.size} Lingua Libre voices added; words with one: ${withLL}/${manifest.items.length}`)
