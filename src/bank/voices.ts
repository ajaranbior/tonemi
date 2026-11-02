import { getPref, setPref } from '../store'
import type { BankItem, Manifest, Recording } from './types'

/** Master switch for synthetic voices. */
const TTS_KEY = 'voices.tts'
const offKey = (speaker: string) => `voice.off.${speaker}`

export const ttsEnabled = () => getPref<boolean>(TTS_KEY, true)
export const setTtsEnabled = (on: boolean) => setPref(TTS_KEY, on)
export const voiceOn = (speaker: string) => !getPref<boolean>(offKey(speaker), false)
export const setVoiceOn = (speaker: string, on: boolean) => setPref(offKey(speaker), !on)

export function voiceEnabled(manifest: Manifest, speaker: string): boolean {
  if (manifest.speakers[speaker]?.tts && !ttsEnabled()) return false
  return voiceOn(speaker)
}

/** Every recording of a word, the item's own first. */
export function recordings(item: BankItem): Recording[] {
  return [{ speaker: item.speaker, audio: item.audio, ref: item.ref }, ...(item.alts ?? [])]
}

/** The item as spoken by `rec` (same id, so progress is shared across voices). */
export const withRecording = (item: BankItem, rec: Recording): BankItem => ({ ...item, speaker: rec.speaker, audio: rec.audio, ref: rec.ref })

const enabledRecordings = (manifest: Manifest, item: BankItem) => recordings(item).filter((r) => voiceEnabled(manifest, r.speaker))

/**
 * Items that have at least one enabled voice. When the settings leave nothing at all, everything is
 * used rather than showing an empty bank.
 */
export function usableItems(manifest: Manifest): BankItem[] {
  const on = manifest.items.filter((i) => enabledRecordings(manifest, i).length > 0)
  return on.length ? on : manifest.items
}

const bases = new WeakMap<Manifest, Map<string, BankItem>>()
/** The bank's own entry for an item that may have been re-voiced with `withRecording`. */
function base(manifest: Manifest, item: BankItem): BankItem {
  let m = bases.get(manifest)
  if (!m) bases.set(manifest, (m = new Map(manifest.items.map((i) => [i.id, i]))))
  return m.get(item.id) ?? item
}

/** A random enabled voice for the item, preferring one other than `avoid` (a speaker id). */
export function pickVoice(manifest: Manifest, word: BankItem, avoid?: string, rand: () => number = Math.random): BankItem {
  const item = base(manifest, word)
  let pool = enabledRecordings(manifest, item)
  if (!pool.length) pool = recordings(item)
  if (avoid && pool.length > 1) pool = pool.filter((r) => r.speaker !== avoid)
  return withRecording(item, pool[Math.floor(rand() * pool.length)])
}

export const voiceCount = (manifest: Manifest, item: BankItem) => enabledRecordings(manifest, base(manifest, item)).length

export function voiceLabel(manifest: Manifest, speaker: string): string {
  const s = manifest.speakers[speaker]
  return s ? (s.short ?? s.name) : speaker
}
