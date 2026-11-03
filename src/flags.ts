import { useSyncExternalStore } from 'react'
import { getPref, setPref } from './store'

/**
 * Experimental ear-training features, each switchable in Ear settings → Experiments. Stored with
 * the other prefs as `flag.<key>`. Most aim at the same problem: answering from memory of a
 * recording ("that clip was 2-1") instead of from the pitch actually heard.
 */
export const FLAGS = {
  retryOther: {
    label: 'Missed patterns come back as a different word',
    help: 'After a miss, a few trials later you get another word with the same tones, not the same recording again.',
    default: true,
  },
  fresh: {
    label: 'Prefer words you have heard least',
    help: 'Within a tone pattern, words you have answered fewer times are picked first.',
    default: true,
  },
  retoned: {
    label: 'Retoned questions',
    help: 'Some questions play a word with its pitch moved to other tones (same voice, resynthesized), so knowing the word tells you nothing.',
    default: false,
  },
  jitter: {
    label: 'Vary pitch and speed on every play',
    help: 'Each play is up to ±1.7 semitones higher or lower and ±10% faster or slower. Tones are relative, so the answer stays the same, but the exact sound changes.',
    default: false,
  },
  autoAB: {
    label: 'After a miss, play right → yours → right',
    help: 'The real tones, then the same recording moved to your answer, then the real tones again, without a tap.',
    default: false,
  },
  melody: {
    label: 'Melody first (hum → muffled → full word)',
    help: 'Weak tone patterns are played as a hum of the speaker’s real pitch, then muffled, then as the full word as your accuracy on that pattern rises.',
    default: false,
  },
  draw: {
    label: 'Draw the pitch before answering',
    help: 'Sketch what you heard on the empty chart; your drawing is shown over the speaker’s pitch after you answer.',
    default: false,
  },
  contrast: {
    label: 'Exercise: A or B? (your top mix-up)',
    help: 'Two-choice questions on one pair of tones, e.g. “was the 2nd syllable tone 2 or 3?”, with both versions to compare after.',
    default: false,
  },
  sameDiff: {
    label: 'Exercise: same or different?',
    help: 'Two different words: do they have the same tone pattern?',
    default: false,
  },
  freshStats: {
    label: 'Show first-listen vs repeat accuracy',
    help: 'In Progress: accuracy on words you are hearing for the first time vs ones you have answered before. A big gap means you are remembering recordings.',
    default: true,
  },
} as const

export type Flag = keyof typeof FLAGS

const key = (f: Flag) => `flag.${f}`
const listeners = new Set<() => void>()

export const getFlag = (f: Flag): boolean => getPref<boolean>(key(f), FLAGS[f].default)

export function setFlag(f: Flag, on: boolean) {
  setPref(key(f), on)
  listeners.forEach((l) => l())
}

let version = 0
listeners.add(() => version++)
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Current value of a flag; re-renders when it is switched. */
export function useFlag(f: Flag): boolean {
  useSyncExternalStore(subscribe, () => version)
  return getFlag(f)
}
