import type { SpeakerRange } from './analysis/normalize'

const KEY = 'tonemi.v1'

export interface ItemStats {
  attempts: number
  best: number
  /** Exponential moving average of scores. */
  ema: number
  last: number
}

interface Stored {
  range?: SpeakerRange
  /** False when the range is a preset rather than measured. */
  calibrated?: boolean
  progress: Record<string, ItemStats>
  prefs: Record<string, boolean | string>
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { progress: {}, prefs: {}, ...JSON.parse(raw) }
  } catch {
    // private mode / blocked storage: run without persistence
  }
  return { progress: {}, prefs: {} }
}

const state = load()

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

export const getRange = () => state.range
export const isCalibrated = () => !!state.calibrated
export function setRange(r: SpeakerRange, calibrated: boolean) {
  state.range = r
  state.calibrated = calibrated
  save()
}

/** Typical ranges for users who skip calibration (semitones re 55 Hz). */
export const DEFAULT_RANGES: Record<'low' | 'high', SpeakerRange> = {
  low: { lo: 8, hi: 20 }, // ≈ 87–175 Hz
  high: { lo: 19, hi: 31 }, // ≈ 165–330 Hz
}

export const getProgress = () => state.progress
export function recordScore(itemId: string, score: number) {
  const s = state.progress[itemId] ?? { attempts: 0, best: 0, ema: score, last: score }
  s.attempts++
  s.best = Math.max(s.best, score)
  s.ema = s.attempts === 1 ? score : 0.6 * s.ema + 0.4 * score
  s.last = score
  state.progress[itemId] = s
  save()
}
export function resetProgress() {
  state.progress = {}
  save()
}

export function getPref<T extends boolean | string>(key: string, fallback: T): T {
  return (state.prefs[key] as T) ?? fallback
}
export function setPref(key: string, value: boolean | string) {
  state.prefs[key] = value
  save()
}
