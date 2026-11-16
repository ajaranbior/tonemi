import { SR } from '../analysis/pitch'

export const MAX_SECONDS = 30

/** Remove quiet edges and shorten long silent gaps, keeping room for unvoiced consonants. */
export function trimSilence(samples: Float32Array): Float32Array {
  const hop = 160
  const energy: number[] = []
  for (let i = 0; i < samples.length; i += hop) {
    let sum = 0
    const end = Math.min(samples.length, i + hop)
    for (let k = i; k < end; k++) sum += samples[k] ** 2
    energy.push(Math.sqrt(sum / (end - i)))
  }
  const peak = Math.max(0, ...energy)
  const threshold = Math.max(0.002, peak * 0.025)
  const active = energy.map((e) => e > threshold)
  const first = active.indexOf(true)
  const last = active.lastIndexOf(true)
  if (first < 0 || peak < 0.004) throw new Error('No audible speech found. Try a clearer or louder recording.')
  const padding = 12
  const from = Math.max(0, first - padding)
  const to = Math.min(energy.length, last + padding + 1)
  const chunks: Float32Array[] = []
  let start = from
  for (let i = from; i < to; i++) {
    if (active[i]) continue
    let end = i
    while (end < to && !active[end]) end++
    if (end - i > 55) {
      chunks.push(samples.slice(start * hop, (i + padding) * hop))
      start = end - padding
    }
    i = end - 1
  }
  chunks.push(samples.slice(start * hop, Math.min(samples.length, to * hop)))
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0))
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.length }
  if (out.length < SR * 0.15) throw new Error('The recording is too short. Capture a phrase or sentence.')
  return out
}
