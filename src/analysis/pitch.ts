/** All analysis runs on 16 kHz mono. */
export const SR = 16000
/** 10 ms hop. */
export const HOP = 160
/** Analysis frame: YIN window + longest lag (60 Hz). */
export const WIN = 1024

const MIN_HZ = 60
const MAX_HZ = 650
/** YIN integration window (32 ms). */
const W = 512
const MIN_LAG = Math.floor(SR / MAX_HZ)
const MAX_LAG = Math.ceil(SR / MIN_HZ)
/** Cumulative-mean-normalised difference thresholds. */
const YIN_THRESHOLD = 0.15
const YIN_MAX = 0.35

export interface PitchTrack {
  /** Seconds per frame. */
  hop: number
  /** F0 per frame in Hz, NaN when unvoiced. */
  hz: Float32Array
  /** RMS per frame. */
  rms: Float32Array
  /** Zero-crossing rate per frame (crossings per sample). */
  zcr: Float32Array
  /**
   * 1 for loud, low-ZCR, unpitched frames right after voiced speech: creaky
   * voice, which in Mandarin marks the bottom of the range (end of T3/T4).
   */
  creak: Uint8Array
}

export interface FrameResult {
  hz: number
  rms: number
  zcr: number
}

/**
 * Per-frame F0 analyser (YIN, de Cheveigné & Kawahara 2002), restricted to the
 * speaking-voice lag range so formants and window-edge lags can't win.
 */
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

/** Raw (unsmoothed) track of a 16 kHz signal. */
export function rawTrack(samples: Float32Array): PitchTrack {
  const n = Math.max(0, Math.floor((samples.length - WIN) / HOP) + 1)
  const hz = new Float32Array(n)
  const rms = new Float32Array(n)
  const zcr = new Float32Array(n)
  const analyze = createFrameAnalyzer()
  for (let i = 0; i < n; i++) {
    const r = analyze(samples.subarray(i * HOP, i * HOP + WIN))
    hz[i] = r.hz
    rms[i] = r.rms
    zcr[i] = r.zcr
  }
  return { hop: HOP / SR, hz, rms, zcr, creak: new Uint8Array(n) }
}

/** Full pipeline: raw track + relative energy gate + octave fixing + smoothing. */
export function trackPitch(samples: Float32Array): PitchTrack {
  return cleanTrack(rawTrack(samples))
}

export function cleanTrack(track: PitchTrack): PitchTrack {
  const hz = Float32Array.from(track.hz)
  const { rms } = track
  const n = hz.length

  // Relative energy gate: drop voicing far below the loudest part.
  let maxRms = 0
  for (let i = 0; i < n; i++) maxRms = Math.max(maxRms, rms[i])
  for (let i = 0; i < n; i++) if (rms[i] < maxRms * 0.06) hz[i] = NaN

  // Sustained runs far below the utterance median are creak subharmonics, not
  // pitch: drop them (creak handling takes over). Isolated octave errors are
  // then fixed against the local median.
  const st = Array.from(hz, hzToSt)
  const global = median(st)
  const raw = st.slice()
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(raw[i])) continue
    if (median(window(raw, i, 15)) < global - 15) st[i] = NaN
  }
  const fixed = st.slice()
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(st[i])) continue
    const m = median(window(st, i, 15))
    if (Number.isNaN(m)) continue
    const d = st[i] - m
    if (Math.abs(d) > 8) {
      const shifted = st[i] - 12 * Math.round(d / 12)
      fixed[i] = Math.abs(shifted - m) < 4 ? shifted : NaN
    }
  }

  // 5-point median smoothing within voiced runs.
  const smooth = fixed.map((v, i) => (Number.isNaN(v) ? NaN : median(window(fixed, i, 5))))

  // Drop voiced islands shorter than 30 ms.
  let i = 0
  while (i < n) {
    if (Number.isNaN(smooth[i])) { i++; continue }
    let j = i
    while (j < n && !Number.isNaN(smooth[j])) j++
    if (j - i < 3) for (let k = i; k < j; k++) smooth[k] = NaN
    i = j
  }

  // Creak: loud, low-ZCR, unpitched runs that directly follow voicing.
  const creak = new Uint8Array(n)
  for (let k = 1; k < n; k++) {
    if (!Number.isNaN(smooth[k]) || (Number.isNaN(smooth[k - 1]) && !creak[k - 1])) continue
    let j = k
    while (j < n && j - k < 25 && Number.isNaN(smooth[j]) && rms[j] >= maxRms * 0.2 && track.zcr[j] < 0.25) j++
    if (j - k >= 3) for (let q = k; q < j; q++) creak[q] = 1
    k = j
  }

  return { hop: track.hop, hz: Float32Array.from(smooth, stToHz), rms, zcr: track.zcr, creak }
}

export function hzToSt(hz: number): number {
  return 12 * Math.log2(hz / 55)
}

export function stToHz(st: number): number {
  return 55 * 2 ** (st / 12)
}

function window(a: number[], i: number, size: number): number[] {
  const h = size >> 1
  return a.slice(Math.max(0, i - h), i + h + 1)
}

export function median(values: number[]): number {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
  if (!v.length) return NaN
  const m = v.length >> 1
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
