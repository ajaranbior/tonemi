import type { SpeakerRange } from '../analysis/normalize'
import type { Segment } from '../analysis/segment'
import type { Tone } from '../analysis/tones'

export type ItemKind = 'single' | 'pair' | 'triple'

export interface BankItem {
  id: string
  hanzi: string
  /** Toneless pinyin syllables. */
  syllables: string[]
  lexical: Tone[]
  surface: Tone[]
  /** Lexical tones joined, e.g. "33", "10", "214". */
  combo: string
  kind: ItemKind
  /** All initials are sonorants or zero → unbroken pitch line. */
  sonorant: boolean
  /** HSK 2012 level, 7 = not in the list. */
  level: number
  speaker: string
  /** Relative to the manifest. */
  audio: string
  ref: RefPitch
  /** The same word by other voices. */
  alts?: Recording[]
}

export interface RefPitch {
  /** Seconds per frame. */
  hop: number
  /** Time of frame 0 in the audio file, seconds. */
  t0: number
  /** Semitones re 55 Hz per frame, null when unvoiced. */
  st: (number | null)[]
  segments: Segment[]
}

/** One recording of a word: the item's own fields, or an entry of `alts`. */
export interface Recording {
  speaker: string
  audio: string
  ref: RefPitch
}

export interface Speaker {
  name: string
  source: string
  license: string
  range: SpeakerRange
  /** Synthetic (text-to-speech) voice; these can be switched off in settings. */
  tts?: boolean
  /** Short label for the voice picker, e.g. "TTS female 1". */
  short?: string
}

export interface Manifest {
  version: number
  speakers: Record<string, Speaker>
  items: BankItem[]
}
