/**
 * Add Chen Wang's human syllable recordings to existing single-syllable words.
 * Usage: npm run build-syllables -- /path/to/audio-cmn
 * The clone must have 64k/syllabs checked out. IDs, progress and other voices are preserved.
 * APPEND=1 only adds missing recordings, preserving existing audio, references and speaker range.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chaoTrack, rangeFromSemitones, voicedSemitones } from '../src/analysis/normalize'
import { hzToSt, trackPitch } from '../src/analysis/pitch'
import { segmentSyllables } from '../src/analysis/segment'
import { syllableContour } from '../src/analysis/contour'
import { recognizeTone } from '../src/analysis/tones'
import type { Manifest } from '../src/bank/types'

if (!process.argv[2]) throw new Error('usage: npm run build-syllables -- <audio-cmn clone>')
const repo = resolve(process.argv[2])
const out = resolve('public/bank')
const speaker = 'chen-wang'
const source = 'https://github.com/hugolpz/audio-cmn'
const manifest: Manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'))
const append = process.env.APPEND === '1'
const candidates = manifest.items.filter((i) => i.kind === 'single' && i.syllables.length === 1 && i.surface[0] > 0 && (!append || !i.alts?.some((r) => r.speaker === speaker))).map((item) => ({
  item,
  // audio-cmn uses ASCII v for ü, e.g. lv3.
  path: `64k/syllabs/cmn-${item.syllables[0].replace(/ü/g, 'v')}${item.surface[0]}.mp3`,
}))
const tracks = candidates.filter((c) => existsSync(join(repo, c.path))).map((c) => {
  const buf = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', join(repo, c.path), '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
  return { ...c, track: trackPitch(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)) }
})
const range = (append ? manifest.speakers[speaker]?.range : null) ?? rangeFromSemitones(tracks.flatMap(({ track }) => voicedSemitones(track)))
if (!range) throw new Error('No voiced syllable recordings found; check out 64k/syllabs in the audio-cmn clone first')
const round1 = (x: number) => Math.round(x * 10) / 10
const accepted = tracks.flatMap((c) => {
  const seg = segmentSyllables(c.track, 1)
  if (!seg?.confident) return []
  const contour = syllableContour(chaoTrack(c.track, range), seg.segments[0], 5, 0.1)
  if (!contour) return []
  const recognized = recognizeTone(contour, true)
  if (recognized.tone !== c.item.surface[0] && recognized.confidence > 0.5) return []
  return [{ ...c, seg }]
})
if (!accepted.length) {
  if (!append) throw new Error('No recordings passed the pitch check; the existing bank has been preserved')
  console.log('No new syllable recordings passed the pitch check; the existing bank is unchanged')
  process.exit(0)
}

// Copy the original MP3 unchanged. Only the pitch reference is trimmed, using t0.
const dir = join(out, 'audio', speaker)
if (!append) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
for (const item of append ? [] : manifest.items) {
  item.alts = item.alts?.filter((r) => r.speaker !== speaker)
  if (!item.alts?.length) delete item.alts
}
for (const { item, path, track, seg } of accepted) {
  const audio = `audio/${speaker}/${item.id}.mp3`
  copyFileSync(join(repo, path), join(out, audio))
  const from = Math.max(0, seg.segments[0][0] - 10)
  const to = Math.min(track.hz.length, seg.segments[0][1] + 10)
  item.alts = [...(item.alts ?? []), {
    speaker, audio, source: `${source}/blob/master/${path}`,
    ref: {
      hop: track.hop, t0: from * track.hop,
      st: Array.from(track.hz.subarray(from, to), (hz) => Number.isNaN(hz) ? null : round1(hzToSt(hz))),
      segments: seg.segments.map(([s, e]) => [s - from, e - from]),
    },
  }]
}
manifest.speakers[speaker] = {
  name: 'Chen Wang', short: 'Chen Wang (syllables)', source: `${source} (syllables v.2 recordings)`,
  license: 'CC BY-SA', range: { lo: round1(range.lo), hi: round1(range.hi) },
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest))
console.log(`Chen Wang: added ${accepted.length}/${candidates.length} single-syllable recordings (${tracks.length} source files found)`)
for (const tone of [1, 2, 3, 4]) console.log(`  Tone ${tone}: ${accepted.filter((c) => c.item.surface[0] === tone).length}`)
