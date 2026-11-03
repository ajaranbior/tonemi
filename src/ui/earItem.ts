import type { Tone } from '../analysis/tones'
import { wavUrl } from '../audio/playback'
import { repitch, targetContour, type Voice } from '../audio/retone'
import { samplesFor } from '../audio/scrub'
import { humFromContour, muffle } from '../audio/variants'
import { audioUrl } from '../bank/load'
import type { BankItem, Manifest } from '../bank/types'
import type { Melody } from '../ear/adapt'

/** A bank word as asked in ear training: possibly moved to other tones, possibly melody-only. */
export interface EarItem extends BankItem {
  /** The real recording, when this one was resynthesized with other tones (`surface` = tones played). */
  from?: BankItem
  /** Full audio of what is asked: the recording, or its retoned version (time 0 = file start, see ref.t0). */
  url: string
  /** What is played before answering, when not the full word. */
  melody?: Exclude<Melody, 'full'>
  qUrl?: string
  /** Time of pitch frame 0 in `qUrl`. */
  qT0?: number
  /** Key under which answers to this exact audio are counted (word, or word~tones). */
  seenKey: string
}

const same = (a: Tone[], b: Tone[]) => a.length === b.length && a.every((t, i) => t === b[i])

export const plainItem = (item: BankItem): EarItem => ({ ...item, url: audioUrl(item), seenKey: item.id })

/** The real word behind an asked item (itself unless retoned). */
export const realItem = (item: EarItem | BankItem): BankItem => ('from' in item && item.from) || item

export function voiceOf(manifest: Manifest, item: BankItem, samples: Float32Array): Voice {
  return {
    samples,
    hop: item.ref.hop,
    t0: item.ref.t0,
    st: item.ref.st.map((v) => (v === null ? NaN : v)),
    segments: item.ref.segments,
    range: manifest.speakers[item.speaker].range,
  }
}

/**
 * The word `base` (already in its chosen voice) as an ear question: resynthesized with `target` tones
 * when given and different, and reduced to a hum or muffled audio for `melody`.
 */
export async function prepareItem(manifest: Manifest, base: BankItem, target?: Tone[], melody: Melody = 'full'): Promise<EarItem> {
  let item = plainItem(base)
  let samples: Float32Array | null = null
  if (target && !same(target, base.surface)) {
    try {
      const orig = await samplesFor(audioUrl(base))
      const voice = voiceOf(manifest, base, orig)
      const contour = targetContour(voice, base.surface, target)
      const out = repitch(voice, contour)
      if (out.length) {
        const id = `${base.id}~${target.join('')}`
        samples = out
        item = {
          ...base,
          id,
          surface: target,
          lexical: target,
          ref: { ...base.ref, t0: 0, st: Array.from(contour, (v) => (Number.isNaN(v) ? null : v)) },
          from: base,
          url: wavUrl(out),
          seenKey: id,
        }
      }
    } catch {
      // can't load the audio: ask the real word instead
    }
  }
  if (melody === 'hum') {
    return { ...item, melody, qUrl: wavUrl(humFromContour(item.ref.st, item.ref.hop)), qT0: 0 }
  }
  if (melody === 'muffled') {
    try {
      const x = samples ?? (await samplesFor(item.url))
      return { ...item, melody, qUrl: wavUrl(muffle(x)), qT0: item.ref.t0 }
    } catch {
      return item
    }
  }
  return item
}

/** The real recording re-pitched to `chosen` tones ("your answer in the same voice"), as a WAV URL. */
export async function answerUrl(manifest: Manifest, item: EarItem | BankItem, chosen: Tone[]): Promise<string | null> {
  const real = realItem(item)
  try {
    const x = await samplesFor(audioUrl(real))
    const voice = voiceOf(manifest, real, x)
    const out = repitch(voice, targetContour(voice, real.surface, chosen))
    return out.length ? wavUrl(out) : null
  } catch {
    return null
  }
}
