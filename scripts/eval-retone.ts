// Machine listening test for retoned audio ("your answer" previews and retoned questions).
// For bank recordings, each toned syllable is moved to every other tone in turn; the result is
// pitch-tracked again and run through the same tone recognizer the Drill page uses. The originals go
// through the same pipeline as a baseline, so the recognizer's own errors on real speech are visible.
// This measures whether the pitch that comes out is the pitch aimed for — not how natural it sounds.
// Requires ffmpeg. Usage: npx tsx scripts/eval-retone.ts [recordings-per-voice=60] [voice,...]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { syllableContour } from '../src/analysis/contour'
import { stToChao } from '../src/analysis/normalize'
import { hzToSt, trackPitch } from '../src/analysis/pitch'
import { recognizeTone, type Tone } from '../src/analysis/tones'
import { repitch, targetContour, type Voice } from '../src/audio/retone'
import type { Manifest } from '../src/bank/types'
import { recordings } from '../src/bank/voices'

const perVoice = Number(process.argv[2] ?? 60)
const manifest = JSON.parse(readFileSync('public/bank/manifest.json', 'utf8')) as Manifest
const voices = process.argv[3]?.split(',') ?? Object.keys(manifest.speakers).filter((k) => !manifest.speakers[k].tts)

const decode = (file: string) => {
  const buf = execFileSync('ffmpeg', ['-v', 'quiet', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice()
}

type Tally = { n: number; ok: number; conf: number[][]; err: number[] }
const tally = (): Tally => ({ n: 0, ok: 0, conf: Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]), err: [] })
const add = (t: Tally, aim: Tone, got: Tone | null) => {
  t.n++
  if (got === aim) t.ok++
  t.conf[aim][got ?? 0]++
}
const pct = (t: Tally) => (t.n ? `${((100 * t.ok) / t.n).toFixed(1)}% (${t.ok}/${t.n})` : '—')

for (const speaker of voices) {
  const range = manifest.speakers[speaker].range
  const recs = manifest.items
    .flatMap((item) => recordings(item).filter((r) => r.speaker === speaker).map((rec) => ({ item, rec })))
    .filter(({ item }) => item.surface.every((t) => t !== 0))
  const step = Math.max(1, Math.floor(recs.length / perVoice))
  const sample = recs.filter((_, i) => i % step === 0).slice(0, perVoice)
  const base = tally()
  const made = tally()
  const byPos = { single: tally(), nonfinal: tally(), final: tally() }
  for (const { item, rec } of sample) {
    const samples = decode(`public/bank/${rec.audio}`)
    const voice: Voice = { samples, hop: rec.ref.hop, t0: rec.ref.t0, st: rec.ref.st.map((v) => v ?? NaN), segments: rec.ref.segments, range }
    const n = item.surface.length
    // Output sample 0 is original time t0, so output frame f lines up with reference frame f.
    const recognize = (audio: Float32Array, k: number): Tone | null => {
      const chao = Array.from(trackPitch(audio).hz, (h) => (Number.isNaN(h) ? NaN : stToChao(hzToSt(h), range)))
      const c5 = syllableContour(chao, rec.ref.segments[k], 5, 0.1)
      return c5 ? recognizeTone(c5, k === n - 1).tone : null
    }
    const original = samples.slice(Math.round(rec.ref.t0 * 16000))
    item.surface.forEach((t, k) => add(base, t, recognize(original, k)))
    item.surface.forEach((t, k) => {
      for (const aim of [1, 2, 3, 4] as Tone[]) {
        if (aim === t) continue
        const chosen = item.surface.map((x, i) => (i === k ? aim : x))
        const out = repitch(voice, targetContour(voice, item.surface, chosen))
        const got = recognize(out, k)
        add(made, aim, got)
        if (got !== aim && process.env.FAILS) console.log(`    miss ${item.hanzi} ${item.surface.join("")} syl${k + 1} aim ${aim} heard ${got ?? "none"}`)
        add(byPos[n === 1 ? 'single' : k < n - 1 ? 'nonfinal' : 'final'], aim, got)
      }
    })
  }
  console.log(`\n== ${speaker}: ${sample.length} recordings`)
  console.log(`  originals recognized as their tone: ${pct(base)}`)
  console.log(`  retoned syllables recognized as the aimed tone: ${pct(made)}`)
  for (const [k, t] of Object.entries(byPos)) console.log(`    ${k.padEnd(9)} ${pct(t)}`)
  console.log('  retoned confusion (rows aimed 1-4, cols heard none/1/2/3/4):')
  for (const a of [1, 2, 3, 4]) console.log(`    ${a}: ${made.conf[a].map((x) => String(x).padStart(4)).join('')}`)
}
