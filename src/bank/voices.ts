import { useSyncExternalStore } from 'react'
import { getPref, setPref } from '../store'
import type { BankItem, ItemKind, Manifest, Recording } from './types'

const kinds: ItemKind[] = ['single', 'pair', 'triple']
// New category preferences deliberately start off, including for existing installations.
const ttsKey = (kind: ItemKind) => `voices.tts.${kind}`
const offKey = (speaker: string) => `voice.off.${speaker}`
const excludedKey = (itemId: string, speaker: string) => `voice.excluded.${itemId}.${speaker}`
const listeners = new Set<() => void>()
let version = 0
const changed = () => { version++; listeners.forEach((l) => l()) }
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const useVoiceVersion = () => useSyncExternalStore(subscribe, () => version)

export const ttsEnabled = (kind?: ItemKind): boolean => kind ? getPref<boolean>(ttsKey(kind), false) : kinds.some((k) => ttsEnabled(k))
export function setTtsKindEnabled(kind: ItemKind, on: boolean) {
  setPref(ttsKey(kind), on)
  changed()
}
export function setTtsEnabled(on: boolean) {
  kinds.forEach((kind) => setPref(ttsKey(kind), on))
  changed()
}
export const voiceOn = (speaker: string) => !getPref<boolean>(offKey(speaker), false)
export function setVoiceOn(speaker: string, on: boolean) {
  setPref(offKey(speaker), !on)
  changed()
}
export const recordingExcluded = (itemId: string, speaker: string) => getPref<boolean>(excludedKey(itemId, speaker), false)
export function setRecordingExcluded(itemId: string, speaker: string, excluded: boolean) {
  setPref(excludedKey(itemId, speaker), excluded)
  changed()
}

export function voiceEnabled(manifest: Manifest, speaker: string, kind?: ItemKind): boolean {
  if (manifest.speakers[speaker]?.tts && !ttsEnabled(kind)) return false
  return voiceOn(speaker)
}

/** Every recording of a word, the item's own first. */
export function recordings(item: BankItem): Recording[] {
  return [{ speaker: item.speaker, audio: item.audio, source: item.source, ref: item.ref }, ...(item.alts ?? [])]
}

/** The item as spoken by `rec` (same id, so progress is shared across voices). */
export const withRecording = (item: BankItem, rec: Recording): BankItem => ({ ...item, speaker: rec.speaker, audio: rec.audio, source: rec.source, ref: rec.ref })

const allowedRecordings = (item: BankItem) => recordings(item).filter((r) => !recordingExcluded(item.id, r.speaker))
const enabledRecordings = (manifest: Manifest, item: BankItem) => allowedRecordings(item).filter((r) => voiceEnabled(manifest, r.speaker, item.kind))
const humanRecordings = (manifest: Manifest, item: BankItem) => allowedRecordings(item).filter((r) => !manifest.speakers[r.speaker]?.tts)

/**
 * Items with an enabled recording. If all voices are off, fall back to human recordings;
 * explicit exclusions are always respected, even when that leaves an empty bank.
 */
export function usableItems(manifest: Manifest): BankItem[] {
  const on = manifest.items.filter((i) => enabledRecordings(manifest, i).length > 0)
  return on.length ? on : manifest.items.filter((i) => humanRecordings(manifest, i).length > 0)
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
  if (!pool.length) pool = humanRecordings(manifest, item)
  if (!pool.length) throw new Error(`No enabled recordings for ${item.id}`)
  if (avoid && pool.length > 1) pool = pool.filter((r) => r.speaker !== avoid)
  return withRecording(item, pool[Math.floor(rand() * pool.length)])
}

/** More than one voice is switched on, so voice controls are worth showing. */
export const manyVoices = (manifest: Manifest) => Object.keys(manifest.speakers).filter((id) => voiceEnabled(manifest, id)).length > 1

export const voiceCount = (manifest: Manifest, item: BankItem) => enabledRecordings(manifest, base(manifest, item)).length

export function voiceLabel(manifest: Manifest, speaker: string): string {
  const s = manifest.speakers[speaker]
  return s ? (s.short ?? s.name) : speaker
}
