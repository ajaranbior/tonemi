import { SR, stToHz } from '../analysis/pitch'
import type { SpeakerRange } from '../analysis/normalize'
import { displayShape, type Tone } from '../analysis/tones'

const GAP = 0.05
const dur = (t: Tone) => (t === 0 ? 0.2 : t === 3 ? 0.4 : 0.32)

/** A buzzy hum following the textbook pitch shape of each tone, mapped onto a speaker's range. */
export function synthTones(tones: Tone[], range: SpeakerRange): Float32Array {
  const total = tones.reduce<number>((a, t) => a + dur(t) + GAP, 0) + GAP
  const out = new Float32Array(Math.round(total * SR))
  let i = Math.round(GAP * SR)
  let phase = 0
  tones.forEach((tone, k) => {
    const n = Math.round(dur(tone) * SR)
    const tpl = displayShape(tone, tones.length, k)
    for (let s = 0; s < n; s++, i++) {
      const x = s / (n - 1)
      const pos = x * (tpl.length - 1)
      const a = Math.floor(pos)
      const b = Math.min(tpl.length - 1, a + 1)
      const chao = tpl[a] + (tpl[b] - tpl[a]) * (pos - a)
      phase += (2 * Math.PI * stToHz(range.lo + ((chao - 1) / 4) * (range.hi - range.lo))) / SR
      const env = Math.min(1, s / (0.02 * SR), (n - s) / (0.03 * SR)) * (tone === 0 ? 0.6 : 1)
      out[i] = 0.28 * env * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase))
    }
    i += Math.round(GAP * SR)
  })
  return out
}
