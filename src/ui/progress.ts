import type { BankItem } from '../bank/types'
import type { ItemStats } from '../store'

/** Mean EMA score per combo over items practised at least once. */
export function comboScores(items: BankItem[], progress: Record<string, ItemStats>): Map<string, number> {
  const acc = new Map<string, number[]>()
  for (const i of items) {
    const p = progress[i.id]
    if (!p) continue
    if (!acc.has(i.combo)) acc.set(i.combo, [])
    acc.get(i.combo)!.push(p.ema)
  }
  return new Map([...acc].map(([c, v]) => [c, Math.round(v.reduce((a, b) => a + b, 0) / v.length)]))
}
