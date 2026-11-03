// Diagnostic: retone a bank word to other tones and compare the pitch aimed for with the pitch produced.
// Usage: npx tsx scripts/check-retone.ts 基础 12
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hzToSt, trackPitch } from '../src/analysis/pitch'
import { stToChao } from '../src/analysis/normalize'
import type { Tone } from '../src/analysis/tones'
import { FRAME_CENTER, repitch, targetContour, type Voice } from '../src/audio/retone'
import type { Manifest } from '../src/bank/types'
import { recordings } from '../src/bank/voices'

const [hanzi = '基础', tonesArg = '12'] = process.argv.slice(2)
const target = [...tonesArg].map(Number) as Tone[]
const manifest = JSON.parse(readFileSync('public/bank/manifest.json', 'utf8')) as Manifest
const item = manifest.items.find((i) => i.hanzi === hanzi)
if (!item) throw new Error(`no ${hanzi}`)

const decode = (file: string) => {
  const buf = execFileSync('ffmpeg', ['-v', 'quiet', '-i', file, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice()
}
const five = (v: number[]) => {
  const ok = v.filter((x) => !Number.isNaN(x))
  if (ok.length < 3) return '—'
  return [0, 0.25, 0.5, 0.75, 1].map((p) => ok[Math.round(p * (ok.length - 1))].toFixed(1)).join(' ')
}

for (const rec of recordings(item)) {
  const range = manifest.speakers[rec.speaker].range
  const samples = decode(`public/bank/${rec.audio}`)
  const voice: Voice = { samples, hop: rec.ref.hop, t0: rec.ref.t0, st: rec.ref.st.map((v) => v ?? NaN), segments: rec.ref.segments, range }
  const goal = targetContour(voice, item.surface, target)
  const out = repitch(voice, goal)
  const track = trackPitch(out)
  // Output sample 0 = original time t0; output frame f window starts at f*track.hop.
  const got = (f: number) => {
    const t = rec.ref.t0 + FRAME_CENTER + f * rec.ref.hop - rec.ref.t0 // seconds into output (frame center)
    const g = Math.round((t - FRAME_CENTER) / track.hop)
    const hz = track.hz[g]
    return hz === undefined || Number.isNaN(hz) ? NaN : stToChao(hzToSt(hz), range)
  }
  console.log(`\n${rec.speaker} ${item.surface.join('-')} → ${target.join('-')}`)
  rec.ref.segments.forEach(([s, e], k) => {
    const frames = Array.from({ length: e - s }, (_, i) => s + i)
    const c = (v: number) => (Number.isNaN(v) ? NaN : stToChao(v, range))
    console.log(
      `  syl ${k + 1}: orig ${five(frames.map((f) => c(voice.st[f] as number)))} | aim ${five(frames.map((f) => c(goal[f])))} | got ${five(frames.map(got))}`,
    )
  })
}
