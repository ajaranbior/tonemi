import type { Manifest } from '../bank/types'
import { isSnippet } from '../snippets/store'

export function BankScope({ manifest, onlySnippets, onChange }: { manifest: Manifest; onlySnippets: boolean; onChange: (on: boolean) => void }) {
  const count = manifest.items.filter(isSnippet).length
  if (!count) return null
  return <div className="segmented compact" role="tablist" aria-label="Exercise bank">
    <button role="tab" aria-selected={!onlySnippets} className={!onlySnippets ? 'active' : ''} onClick={() => onChange(false)}>All exercises</button>
    <button role="tab" aria-selected={onlySnippets} className={onlySnippets ? 'active' : ''} onClick={() => onChange(true)}>My snippets · {count}</button>
  </div>
}
