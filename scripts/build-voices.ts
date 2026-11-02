/**
 * Adds synthetic (text-to-speech) voices to the existing word bank: words get extra recordings
 * (`alts`) by the voices below, so the same word can be heard from several speakers. Words and ids
 * are untouched, so saved progress stays valid. Re-running replaces these voices' recordings.
 *
 *   pip install edge-tts
 *   npm run build-voices                       # synthesize + validate + write
 *   CLIPS=/path/to/clips npm run build-voices  # reuse clips from an earlier run
 *
 * Clips come from Microsoft Edge neural voices (scripts/tts_edge.py) and are checked with the app's
 * own pitch analysis exactly like the human recordings: a clip whose contour contradicts the
 * expected tones, or that can't be split into the right number of syllables, is dropped.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chaoTrack, rangeFromSemitones, voicedSemitones } from '../src/analysis/normalize'
import { hzToSt, trackPitch, type PitchTrack } from '../src/analysis/pitch'
import { segmentSyllables, type Segmentation } from '../src/analysis/segment'
import { syllableContour } from '../src/analysis/contour'
import { recognizeTone, type Tone } from '../src/analysis/tones'
import type { Manifest, Recording } from '../src/bank/types'

const VOICES: { voice: string; id: string; short: string }[] = [
  { voice: 'zh-CN-XiaoxiaoNeural', id: 'xiaoxiao', short: 'Xiaoxiao (female)' },
  { voice: 'zh-CN-XiaoyiNeural', id: 'xiaoyi', short: 'Xiaoyi (female)' },
  { voice: 'zh-CN-YunxiaNeural', id: 'yunxia', short: 'Yunxia (boy)' },
  { voice: 'zh-CN-YunxiNeural', id: 'yunxi', short: 'Yunxi (male)' },
  { voice: 'zh-CN-YunjianNeural', id: 'yunjian', short: 'Yunjian (male)' },
  { voice: 'zh-CN-YunyangNeural', id: 'yunyang', short: 'Yunyang (male)' },
]

const OUT = resolve('public/bank')
const manifest: Manifest = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'tonemi-voices-'))
const clips = process.env.CLIPS ? resolve(process.env.CLIPS) : join(work, 'clips')
if (!process.env.CLIPS) {
  const list = join(work, 'items.json')
  writeFileSync(list, JSON.stringify(manifest.items.map(({ id, hanzi }) => ({ id, hanzi }))))
  console.log(`synthesizing ${manifest.items.length} words × ${VOICES.length} voices…`)
  execFileSync('python3', [resolve('scripts/tts_edge.py'), list, clips, VOICES.map((v) => v.voice).join(',')], { stdio: 'inherit' })
}

const decode = (file: string) => {
  const buf = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}

/** Same rule as the human bank: a clear contradiction on any toned syllable rejects the clip. */
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
const ours = new Set(VOICES.map((v) => v.id))
for (const item of manifest.items) {
  item.alts = item.alts?.filter((a) => !ours.has(a.speaker))
  if (!item.alts?.length) delete item.alts
}

for (const v of VOICES) {
  const tracks = new Map<string, PitchTrack>()
  for (const item of manifest.items) {
    const f = join(clips, v.voice, `${item.id}.mp3`)
    if (existsSync(f)) tracks.set(item.id, trackPitch(decode(f)))
  }
  const range = rangeFromSemitones([...tracks.values()].flatMap(voicedSemitones))!
  rmSync(join(OUT, 'audio', v.id), { recursive: true, force: true })
  mkdirSync(join(OUT, 'audio', v.id), { recursive: true })
  let kept = 0
  for (const item of manifest.items) {
    const track = tracks.get(item.id)
    if (!track) continue
    const n = item.surface.length
    const seg = segmentSyllables(track, n)
    if (!seg?.confident || !tonesMatch(track, seg, item.surface, range)) continue
    // Trim to the word ± 0.15 s, encode, and measure the reference pitch on the encoded file.
    const from = Math.max(0, seg.segments[0][0] * track.hop - 0.15)
    const to = seg.segments[n - 1][1] * track.hop + 0.15
    const audio = `audio/${v.id}/${item.id}.mp3`
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-ss', from.toFixed(3), '-to', to.toFixed(3), '-i', join(clips, v.voice, `${item.id}.mp3`),
      '-af', 'afade=t=in:d=0.02', '-ac', '1', '-ar', '24000', '-b:a', '40k', join(OUT, audio)])
    const enc = trackPitch(decode(join(OUT, audio)))
    const encSeg = segmentSyllables(enc, n)
    if (!encSeg?.confident || !tonesMatch(enc, encSeg, item.surface, range)) {
      rmSync(join(OUT, audio))
      continue
    }
    const rec: Recording = {
      speaker: v.id,
      audio,
      ref: { hop: enc.hop, t0: 0, st: Array.from(enc.hz, (hz) => (Number.isNaN(hz) ? null : round1(hzToSt(hz)))), segments: encSeg.segments },
    }
    item.alts = [...(item.alts ?? []), rec]
    kept++
  }
  manifest.speakers[v.id] = {
    name: `${v.voice} (Microsoft Edge neural text-to-speech)`,
    short: v.short,
    source: 'Microsoft Edge read-aloud voices via edge-tts',
    license: 'synthetic; personal, non-commercial use',
    range: { lo: round1(range.lo), hi: round1(range.hi) },
    tts: true,
  }
  console.log(`${v.id}: kept ${kept}/${tracks.size}, range ${range.lo.toFixed(1)}..${range.hi.toFixed(1)} st`)
}

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest))
rmSync(work, { recursive: true, force: true })
const voiced = manifest.items.filter((i) => i.alts?.length).length
console.log(`words with extra voices: ${voiced}/${manifest.items.length}`)
