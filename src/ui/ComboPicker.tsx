import { useState } from 'react'
import type { BankItem, ItemKind } from '../bank/types'
import { comboLabel, scoreClass } from './tone'

interface Props {
  items: BankItem[]
  kind: ItemKind
  combo: string
  scores: Map<string, number>
  onChange: (kind: ItemKind, combo: string) => void
}

const KINDS: [ItemKind, string][] = [['single', '1 syllable'], ['pair', '2 syllables'], ['triple', '3 syllables']]
const SECOND = ['1', '2', '3', '4', '0']

export function ComboPicker({ items, kind, combo, scores, onChange }: Props) {
  const available = new Set(items.filter((i) => i.kind === kind).map((i) => i.combo))
  const [first, setFirst] = useState(() => (kind === 'triple' && combo !== 'auto' ? combo[0] : '1'))
  const [open, setOpen] = useState(false)
  const pick = (k: ItemKind, c: string) => {
    onChange(k, c)
    setOpen(false)
  }
  const kindLabel = KINDS.find(([k]) => k === kind)![1]

  const cell = (c: string) => (
    <button
      key={c}
      className={`cell ${scoreClass(scores.get(c))} ${combo === c ? 'selected' : ''}`}
      disabled={!available.has(c)}
      onClick={() => pick(kind, c)}
      title={scores.has(c) ? `${comboLabel(c)}: ${scores.get(c)}` : comboLabel(c)}
    >
      <span>{comboLabel(c)}</span>
      {scores.has(c) && <small>{scores.get(c)}</small>}
    </button>
  )

  return (
    <section className="card picker">
      <button className="picker-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          {kindLabel} · <strong>{combo === 'auto' ? 'Mix (weakest first)' : comboLabel(combo)}</strong>
          {combo !== 'auto' && scores.has(combo) && <span className={`pill ${scoreClass(scores.get(combo))}`}>{scores.get(combo)}</span>}
        </span>
        <span className="muted">{open ? '▲' : 'Change ▼'}</span>
      </button>

      {open && (
        <>
          <div className="segmented" role="tablist">
            {KINDS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => onChange(k, 'auto')}>
                {label}
              </button>
            ))}
          </div>

          <button className={`auto ${combo === 'auto' ? 'selected' : ''}`} onClick={() => pick(kind, 'auto')}>
            🎯 Mix — weakest combos first
          </button>

          {kind === 'single' && <div className="grid grid-4">{['1', '2', '3', '4'].map(cell)}</div>}

          {kind === 'pair' && <div className="grid grid-5">{['1', '2', '3', '4'].flatMap((a) => SECOND.map((b) => cell(a + b)))}</div>}

          {kind === 'triple' && (
            <>
              <div className="segmented small-tabs">
                {['1', '2', '3', '4'].map((a) => (
                  <button key={a} className={first === a ? 'active' : ''} onClick={() => setFirst(a)}>
                    {a}-…
                  </button>
                ))}
              </div>
              <div className="grid grid-5">{['1', '2', '3', '4'].flatMap((b) => SECOND.map((c) => cell(first + b + c)))}</div>
            </>
          )}
        </>
      )}
    </section>
  )
}
