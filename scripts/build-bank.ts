/**
 * Builds public/bank/ (audio + manifest.json) from the audio-cmn repository.
 *
 *   git clone --filter=blob:none --no-checkout https://github.com/hugolpz/audio-cmn /path/audio-cmn
 *   npx tsx scripts/build-bank.ts /path/audio-cmn
 *
 * FILL=1 adds recordings to the existing bank without touching it: only for tone patterns
 * (as pronounced) that have fewer than MIN_PER_PATTERN items, with new, non-clashing ids.
 *
 * Every clip is pitch-analysed with the app's own pipeline; clips whose contour
 * contradicts the expected tones are dropped, which also weeds out wrong
 * polyphone readings and missing neutral tones.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pinyin } from 'pinyin-pro'
import { chaoTrack, rangeFromSemitones, voicedSemitones } from '../src/analysis/normalize'
import { hzToSt, trackPitch, type PitchTrack } from '../src/analysis/pitch'
import { segmentSyllables, type Segmentation } from '../src/analysis/segment'
import { syllableContour } from '../src/analysis/contour'
import { recognizeTone, type Tone } from '../src/analysis/tones'
import { lexicalTones, surfaceTones } from '../src/g2p/tones'
import type { BankItem, ItemKind, Manifest } from '../src/bank/types'

const repo = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('usage: tsx scripts/build-bank.ts <audio-cmn clone>')
const OUT = resolve('public/bank')
const QUALITY = '64k'
const FILL = process.env.FILL === '1'
const MIN_PER_PATTERN = 4
const existing: Manifest | null = FILL ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) : null
const coverage = (surface: string) => existing!.items.filter((i) => i.surface.join('') === surface).length
/** Fill mode relaxes the pitch check, so known neutral-final words (老太太 lǎotàitai) are skipped by hand. */
const FILL_SKIP = ['老太太', '老人家']
/** Standard words with unambiguous tones (4-4-x runs) whose middle falling tone the recognizer reads as 3rd. */
const FILL_TRUST = new Set(['大气压', '照相机', '电动机', '计算机', '现代化', '记忆力', '俱乐部', '众议院'])
const haveWord = new Set([...(existing?.items.map((i) => i.hanzi) ?? []), ...(FILL ? FILL_SKIP : [])])

const CAPS: Record<ItemKind, { keep: number; candidates: number }> = {
  single: { keep: 16, candidates: 40 },
  pair: { keep: 16, candidates: 40 },
  triple: { keep: 8, candidates: 20 },
}
const SONORANT = new Set(['', 'm', 'n', 'l', 'r', 'y', 'w'])
/** 一/不 sandhi is its own topic; particles are normally neutral, so their citation tone misleads. */
const EXCLUDE = /[一不了的得地着过吗呢吧么啊呀]/

const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { maxBuffer: 1 << 28 }).toString()

interface Candidate {
  hanzi: string
  path: string
  syllables: string[]
  lexical: Tone[]
  surface: Tone[]
  /** Alternative surface readings to test (3-3-3 chains). */
  alternatives: Tone[][]
  combo: string
  kind: ItemKind
  sonorant: boolean
  level: number
}

// --- 1. word list -----------------------------------------------------------
const levels = new Map<string, number>()
for (let l = 1; l <= 6; l++) {
  for (const w of git('show', `HEAD:lists/HSK2012_${l}.txt`).split('\n').slice(1)) {
    const t = w.trim()
    if (t && !levels.has(t)) levels.set(t, l)
  }
}

const files = git('ls-tree', '-r', '--name-only', '-z', 'HEAD', `${QUALITY}/hsk/`).split('\0').filter(Boolean)
const byCombo = new Map<string, Candidate[]>()
for (const path of files) {
  const m = /cmn-([一-鿿]{1,3})\.mp3$/.exec(path)
  if (!m) continue
  const hanzi = m[1]
  if (EXCLUDE.test(hanzi)) continue
  const chars = [...hanzi]
  const lexical = lexicalTones(hanzi)
  if (lexical.length !== chars.length || lexical.some((t) => t < 0 || t > 4 || Number.isNaN(t))) continue
  const kind: ItemKind = chars.length === 1 ? 'single' : chars.length === 2 ? 'pair' : 'triple'
  // Neutral tone only as the last syllable.
  if (lexical.slice(0, -1).includes(0) || (kind === 'single' && lexical[0] === 0)) continue
  const { tones: surface } = surfaceTones(chars, lexical)
  const alternatives = [surface]
  if (kind === 'triple' && lexical.join('').startsWith('333')) alternatives.push([3, 2, 3])
  const initials = pinyin(hanzi, { pattern: 'initial', type: 'array' })
  const combo = lexical.join('')
  const c: Candidate = {
    hanzi, path,
    syllables: pinyin(hanzi, { toneType: 'none', type: 'array', v: true }).map((s) => s.replace(/v/g, 'ü')),
    lexical, surface, alternatives, combo, kind,
    sonorant: initials.every((i) => SONORANT.has(i)),
    level: levels.get(hanzi) ?? 7,
  }
  if (!byCombo.has(combo)) byCombo.set(combo, [])
  byCombo.get(combo)!.push(c)
}

/** Lowest HSK level first, sonorant/mixed interleaved, avoiding repeated first characters. */
function pickCandidates(list: Candidate[], n: number): Candidate[] {
  const sorted = list.slice().sort((a, b) => a.level - b.level)
  const son = sorted.filter((c) => c.sonorant)
  const mix = sorted.filter((c) => !c.sonorant)
  const out: Candidate[] = []
  const seen = new Set<string>()
  for (const pass of [true, false]) {
    let i = 0
    let j = 0
    while (out.length < n && (i < son.length || j < mix.length)) {
      for (const src of [son, mix]) {
        const k = src === son ? i : j
        if (k >= src.length) continue
        const c = src[k]
        if (src === son) i++
        else j++
        if (out.includes(c)) continue
        if (pass && seen.has(c.hanzi[0])) continue
        seen.add(c.hanzi[0])
        out.push(c)
      }
    }
  }
  return out.slice(0, n)
}

const candidates: Candidate[] = []
if (FILL) {
  for (const list of byCombo.values())
    for (const c of list) if (!haveWord.has(c.hanzi) && c.alternatives.some((a) => coverage(a.join('')) < MIN_PER_PATTERN)) candidates.push(c)
} else {
  for (const [, list] of byCombo) candidates.push(...pickCandidates(list, CAPS[list[0].kind].candidates))
}
console.log(`${files.length} files, ${byCombo.size} combos, ${candidates.length} candidates`)

// --- 2. fetch + analyse ------------------------------------------------------
const pathspec = join(repo, '.bank-paths')
writeFileSync(pathspec, candidates.map((c) => c.path).join('\n'))
git('checkout', 'HEAD', `--pathspec-from-file=${pathspec}`)
rmSync(pathspec)

function decode(file: string): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

const tracks = new Map<Candidate, PitchTrack>()
for (const c of candidates) tracks.set(c, trackPitch(decode(join(repo, c.path))))
const range = existing ? existing.speakers.yue.range : rangeFromSemitones([...tracks.values()].flatMap(voicedSemitones))!
console.log(`speaker range: ${range.lo.toFixed(1)}..${range.hi.toFixed(1)} st (${(55 * 2 ** (range.lo / 12)).toFixed(0)}–${(55 * 2 ** (range.hi / 12)).toFixed(0)} Hz)`)

// --- 3. validate -------------------------------------------------------------
const rejected: Record<string, number> = {}
const reject = (why: string) => { rejected[why] = (rejected[why] ?? 0) + 1 }

interface Accepted { c: Candidate; seg: Segmentation; surface: Tone[] }
const accepted = new Map<string, Accepted[]>()
for (const c of candidates) {
  const track = tracks.get(c)!
  const seg = segmentSyllables(track, c.lexical.length)
  if (!seg || !seg.confident) { reject('segmentation'); continue }
  const chao = chaoTrack(track, range)
  let bestSurface: Tone[] | null = null
  let bestBad = Infinity
  for (const surface of c.alternatives) {
    let bad = 0
    surface.forEach((t, i) => {
      if (t === 0) return
      const c5 = syllableContour(chao, seg.segments[i], 5, 0.1)
      if (!c5) { bad += 1; return }
      const r = recognizeTone(c5, i === surface.length - 1)
      if (r.tone !== t && r.confidence > (FILL ? 0.8 : 0.5)) bad++
    })
    if (bad < bestBad) { bestBad = bad; bestSurface = surface }
  }
  if (bestBad > 0 && !(FILL && FILL_TRUST.has(c.hanzi))) {
    if (process.env.DEBUG_FILL) console.log('reject', c.hanzi, c.alternatives.map((a) => a.join('')).join('/'), seg.segments.map((sg) => { const c5 = syllableContour(chao, sg, 5, 0.1); return c5 ? recognizeTone(c5, false).tone : '?' }).join(''))
    reject('tone mismatch')
    continue
  }
  if (!accepted.has(c.combo)) accepted.set(c.combo, [])
  accepted.get(c.combo)!.push({ c, seg, surface: bestSurface! })
}

// --- 4. select + write -------------------------------------------------------
if (!FILL) rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'audio'), { recursive: true })
const items: BankItem[] = existing ? [...existing.items] : []
const round1 = (x: number) => Math.round(x * 10) / 10
for (const [combo, list] of [...accepted].sort(([a], [b]) => a.localeCompare(b))) {
  let keep = pickCandidates(list.map((a) => a.c), CAPS[list[0].c.kind].keep)
  if (FILL) {
    // Per pronounced pattern, only as many as are missing.
    const added = new Map<string, number>()
    keep = pickCandidates(list.map((a) => a.c), list.length).filter((c) => {
      const key = list.find((x) => x.c === c)!.surface.join('')
      const have = coverage(key) + (added.get(key) ?? 0)
      if (have >= MIN_PER_PATTERN) return false
      added.set(key, (added.get(key) ?? 0) + 1)
      return true
    })
  }
  for (const c of keep) {
    const a = list.find((x) => x.c === c)!
    const track = tracks.get(c)!
    // Trim to the utterance ± 10 frames.
    const from = Math.max(0, a.seg.segments[0][0] - 10)
    const to = Math.min(track.hz.length, a.seg.segments.at(-1)![1] + 10)
    const id = `${combo}-${items.filter((i) => i.combo === combo).length}`
    copyFileSync(join(repo, c.path), join(OUT, 'audio', `${id}.mp3`))
    items.push({
      id, hanzi: c.hanzi, syllables: c.syllables, lexical: c.lexical, surface: a.surface, combo,
      kind: c.kind, sonorant: c.sonorant, level: c.level, speaker: 'yue', audio: `audio/${id}.mp3`,
      ref: {
        hop: track.hop,
        t0: from * track.hop,
        st: Array.from(track.hz.subarray(from, to), (hz) => (Number.isNaN(hz) ? null : round1(hzToSt(hz)))),
        segments: a.seg.segments.map(([s, e]) => [s - from, e - from]),
      },
    })
  }
}

const manifest: Manifest = existing
  ? { ...existing, items }
  : {
  version: 1,
  speakers: {
    yue: {
      name: 'Yue Tan',
      source: 'https://github.com/hugolpz/audio-cmn (Shtooka project recordings)',
      license: 'CC BY-SA',
      range: { lo: round1(range.lo), hi: round1(range.hi) },
    },
  },
  items,
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))

const kinds = (k: ItemKind) => items.filter((i) => i.kind === k)
console.log('rejected:', rejected)
console.log(`kept ${items.length}: single ${kinds('single').length}, pair ${kinds('pair').length}, triple ${kinds('triple').length}`)
const counts = new Map<string, number>()
for (const i of items) counts.set(i.combo, (counts.get(i.combo) ?? 0) + 1)
console.log([...counts].filter(([c]) => c.length <= 2).map(([c, n]) => `${c}:${n}`).join(' '))
console.log(`triple combos: ${[...counts].filter(([c]) => c.length === 3).length}`)
