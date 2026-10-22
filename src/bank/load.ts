import { stToChao, type SpeakerRange } from '../analysis/normalize'
import type { BankItem, Manifest } from './types'

let manifest: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    manifest = fetch(`${import.meta.env.BASE_URL}bank/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`)
      return r.json() as Promise<Manifest>
    })
    manifest.catch(() => (manifest = null))
  }
  return manifest
}

export const audioUrl = (item: BankItem) => `${import.meta.env.BASE_URL}bank/${item.audio}`

export function refChao(item: BankItem, range: SpeakerRange): Float32Array {
  return Float32Array.from(item.ref.st, (s) => (s === null ? NaN : stToChao(s, range)))
}
