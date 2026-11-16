// Compare the FFT implementation with the original YIN on the recorded bank.
// Requires ffmpeg. Usage: npx tsx scripts/check-pitch.ts [number-of-words]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createFrameAnalyzer, HOP, WIN } from '../src/analysis/pitch'
import { createFrameAnalyzer as directAnalyzer } from '../src/analysis/test/directYin'
import type { Manifest } from '../src/bank/types'

const manifest = JSON.parse(readFileSync('public/bank/manifest.json', 'utf8')) as Manifest
const limit = Number(process.argv[2] ?? manifest.items.length)
const items = manifest.items.filter((_, i) => i % Math.max(1, Math.floor(manifest.items.length / limit)) === 0).slice(0, limit)
const frames: Float32Array[] = []
let recordings = 0
for (const item of items) {
  for (const rec of [item, ...(item.alts ?? [])]) {
    const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', `public/bank/${rec.audio}`, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { maxBuffer: 1 << 26 })
    const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice()
    for (let i = 0; i + WIN <= samples.length; i += HOP) frames.push(samples.subarray(i, i + WIN))
    recordings++
  }
}

const direct = directAnalyzer()
const fft = createFrameAnalyzer()
let voicingChanges = 0
let maxCents = 0
for (const frame of frames) {
  const a = direct(frame).hz
  const b = fft(frame).hz
  if (Number.isNaN(a) !== Number.isNaN(b)) voicingChanges++
  else if (!Number.isNaN(a)) maxCents = Math.max(maxCents, Math.abs(1200 * Math.log2(a / b)))
}
// Warm up the JIT before timing the same frames, without decoding or I/O.
for (const frame of frames.slice(0, 2000)) { direct(frame); fft(frame) }
const timed = (analyze: ReturnType<typeof createFrameAnalyzer>) => {
  const start = performance.now()
  for (const frame of frames) analyze(frame)
  return performance.now() - start
}
const directMs = timed(direct)
const fftMs = timed(fft)
console.log(JSON.stringify({ recordings, frames: frames.length, voicingChanges, maxCents, directMs, fftMs, speedup: directMs / fftMs }, null, 2))
if (voicingChanges || maxCents > 0.01) process.exitCode = 1
