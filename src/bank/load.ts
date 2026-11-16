import { stToChao, type SpeakerRange } from '../analysis/normalize'
import type { BankItem, Manifest } from './types'
import { withSnippets } from '../snippets/store'

let manifest: Promise<Manifest> | null = null

export function loadManifest(): Promise<Manifest> {
  if (!manifest) {
    manifest = fetch(`${import.meta.env.BASE_URL}bank/manifest.json`).then((r) => {
      if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`)
      return r.json() as Promise<Manifest>
    })
    manifest.catch(() => (manifest = null))
  }
  return manifest.then(withSnippets)
}

export const audioUrl = (item: BankItem) => item.audio.startsWith('blob:') ? item.audio : `${import.meta.env.BASE_URL}bank/${item.audio}`

export function refChao(item: BankItem, range: SpeakerRange): Float32Array {
  return Float32Array.from(item.ref.st, (s) => (s === null ? NaN : stToChao(s, range)))
}
