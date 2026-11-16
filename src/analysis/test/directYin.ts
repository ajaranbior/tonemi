// Original direct YIN implementation, retained only as a regression oracle.
import { SR, type FrameResult } from '../pitch'

const MIN_HZ = 60
const MAX_HZ = 650
/** YIN integration window (32 ms). */
const W = 512
const MIN_LAG = Math.floor(SR / MAX_HZ)
const MAX_LAG = Math.ceil(SR / MIN_HZ)
/** Cumulative-mean-normalised difference thresholds. */
const YIN_THRESHOLD = 0.15
const YIN_MAX = 0.35

export function createFrameAnalyzer(): (frame: Float32Array) => FrameResult {
  const d = new Float32Array(MAX_LAG + 2)
  return (frame) => {
    let sum = 0
    let crossings = 0
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i]
      if (i && frame[i] >= 0 !== frame[i - 1] >= 0) crossings++
    }
    const rms = Math.sqrt(sum / frame.length)
    const zcr = crossings / frame.length
    if (rms < 0.002) return { hz: NaN, rms, zcr }
    return { hz: yin(frame, d), rms, zcr }
  }
}

function yin(x: Float32Array, d: Float32Array): number {
  const maxLag = Math.min(MAX_LAG + 1, x.length - W)
  // Difference function and its cumulative-mean normalisation, in place.
  let running = 0
  d[0] = 1
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0
    for (let j = 0; j < W; j++) {
      const diff = x[j] - x[j + tau]
      s += diff * diff
    }
    running += s
    d[tau] = running > 0 ? (s * tau) / running : 1
  }
  let tau = -1
  for (let t = MIN_LAG; t < maxLag; t++) {
    if (d[t] < YIN_THRESHOLD) {
      while (t + 1 < maxLag && d[t + 1] < d[t]) t++
      tau = t
      break
    }
  }
  if (tau < 0) {
    // No dip under the threshold: accept the global minimum only if it is reasonably clear.
    let best = MIN_LAG
    for (let t = MIN_LAG + 1; t < maxLag; t++) if (d[t] < d[best]) best = t
    if (d[best] > YIN_MAX) return NaN
    tau = best
  }
  if (tau <= MIN_LAG || tau >= maxLag - 1) return NaN
  // Parabolic interpolation around the dip.
  const a = d[tau - 1]
  const b = d[tau]
  const c = d[tau + 1]
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
  return SR / (tau + Math.max(-1, Math.min(1, shift)))
}
