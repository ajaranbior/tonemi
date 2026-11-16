import { pinyin } from 'pinyin-pro'
import { hzToSt, SR, type PitchTrack } from '../analysis/pitch'
import { percentile, rangeFromSemitones, voicedSemitones } from '../analysis/normalize'
import { segmentSyllables } from '../analysis/segment'
import type { Tone } from '../analysis/tones'
import type { BankItem, Speaker } from '../bank/types'
import { charTimes, FRAME_CENTER, phraseSizes } from '../ear/chunks'
import { sentenceTones } from '../g2p/tones'
import { wavBlob } from '../audio/wav'
import type { Transcript } from './transcribe'

export interface CharacterTiming { char: string; index: number; start: number; end: number }

/** Use ASR sentence timestamps as anchors, then energy/pitch to estimate syllable boundaries. */
export function alignCharacters(text: string, track: PitchTrack, duration: number, transcript?: Transcript): CharacterTiming[] {
  const chars = [...text]
  const han = chars.map((char, index) => ({ char, index })).filter(({ char }) => /\p{Script=Han}/u.test(char))
  if (!han.length) return []
  const chunks = transcript?.text === text ? transcript.chunks : undefined
  const matching = chunks?.length && chunks.map((c) => c.text.replace(/[^\p{Script=Han}]/gu, '')).join('') === han.map((c) => c.char).join('')
  const spans = matching ? chunks! : [{ text, timestamp: [0, duration] as [number, number] }]
  const out: CharacterTiming[] = []
  let at = 0
  for (const span of spans) {
    const count = [...span.text].filter((c) => /\p{Script=Han}/u.test(c)).length
    if (!count) continue
    const start = Math.max(0, Math.min(duration, span.timestamp[0] ?? 0))
    const end = Math.max(start, Math.min(duration, span.timestamp[1] ?? duration))
    const times = charTimes(track, Math.max(0, Math.floor((start - FRAME_CENTER) / track.hop)), Math.min(track.hz.length, Math.ceil(end / track.hop)), phraseSizes(span.text))
    for (let i = 0; i < count; i++) {
      out.push({ ...han[at++], start: times ? Math.max(start, times.start[i] * track.hop + FRAME_CENTER - 0.04) : start + (end - start) * i / count,
        end: times ? Math.min(end, times.end[i] * track.hop + FRAME_CENTER + 0.04) : start + (end - start) * (i + 1) / count })
    }
  }
  return out
}

export function selectionLabels(text: string, from: number, to: number): { hanzi: string; syllables: string[]; lexical: Tone[]; surface: Tone[] } {
  const annotation = sentenceTones(text)
  const indices = annotation.chars.map((_, i) => i).filter((i) => i >= from && i <= to && annotation.tones[i] !== null)
  const hanzi = indices.map((i) => annotation.chars[i]).join('')
  // Use the entire sentence for polyphones and sandhi; a cropped word retains its spoken context.
  const readings = pinyin(text, { type: 'array', toneType: 'none', nonZh: 'removed', toneSandhi: false })
  const allHan = annotation.chars.map((c, i) => /\p{Script=Han}/u.test(c) ? i : -1).filter((i) => i >= 0)
  return { hanzi, syllables: indices.map((i) => readings[allHan.indexOf(i)]), lexical: indices.map((i) => annotation.lexical[i]!), surface: indices.map((i) => annotation.tones[i]!) }
}

export function makeExercise(samples: Float32Array, track: PitchTrack, labels: ReturnType<typeof selectionLabels>, contextTrack: PitchTrack): { item: BankItem; speaker: Speaker; audio: Blob } {
  const n = labels.surface.length
  if (n < 1 || n > 3 || labels.syllables.some((s) => !s)) throw new Error('Choose 1–3 Chinese syllables for a tone exercise.')
  const segmentation = segmentSyllables(track, n)
  if (!segmentation) throw new Error('No clear voice in this cut. Adjust the start and end, then preview again.')
  const id = `snippet-${crypto.randomUUID()}`
  const values = voicedSemitones(contextTrack).sort((a, b) => a - b)
  // Short Anki words may not contain the 50 voiced frames required for calibration.
  // Estimate their reference range from at least 8 frames, with the same four-semitone floor.
  const lo = percentile(values, 0.05)
  const range = rangeFromSemitones(values) ?? (values.length >= 8 ? { lo, hi: Math.max(lo + 4, percentile(values, 0.95)) } : null)
  if (!range) throw new Error('Not enough clear speech to measure the voice. Try a longer source recording.')
  const item: BankItem = {
    id, ...labels, combo: labels.lexical.join(''), kind: (['single', 'pair', 'triple'] as const)[n - 1],
    sonorant: false, level: 7, speaker: id, audio: '',
    ref: { hop: track.hop, t0: 0, st: Array.from(track.hz, (hz) => Number.isNaN(hz) ? null : hzToSt(hz)), segments: segmentation.segments },
  }
  return { item, speaker: { name: 'My snippet', short: 'My snippet', source: 'Personal recording', license: 'Personal use', range }, audio: wavBlob(samples, SR) }
}
