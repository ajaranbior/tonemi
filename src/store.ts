import type { SpeakerRange } from './analysis/normalize'

const KEY = 'tonemi.v1'

export interface ItemStats {
  attempts: number
  best: number
  /** Exponential moving average of scores. */
  ema: number
  last: number
}

/** Ear-training accuracy: `ema` is a moving average of all-syllables-right (0..1). */
export interface EarStat {
  n: number
  ema: number
}

interface Stored {
  range?: SpeakerRange
  /** False when the range is a preset rather than measured. */
  calibrated?: boolean
  progress: Record<string, ItemStats>
  prefs: Record<string, boolean | string>
  /** Per tone-combo accuracy, e.g. "23", "214". */
  earCombos?: Record<string, EarStat>
  /** "expected>chosen" → count, e.g. "3>2". */
  earConfusions?: Record<string, number>
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

export const getEarCombos = () => state.earCombos ?? {}
export const getEarConfusions = () => state.earConfusions ?? {}
export function setEarCombo(combo: string, stat: EarStat) {
  state.earCombos = { ...state.earCombos, [combo]: stat }
  save()
}
export function addEarConfusion(key: string) {
  state.earConfusions = { ...state.earConfusions, [key]: (state.earConfusions?.[key] ?? 0) + 1 }
  save()
}
export function resetEar() {
  state.earCombos = {}
  state.earConfusions = {}
  save()
}
