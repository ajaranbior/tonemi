import { afterEach, describe, expect, it, vi } from 'vitest'
import { EarAudioPool, plainItem, releaseItem, type EarItem } from './earItem'
import type { BankItem } from '../bank/types'

const base = { id: 'word', audio: 'audio/word.mp3' } as BankItem
const generated = (n: number): EarItem => ({ ...plainItem(base), from: base, url: `blob:retone-${n}`, qUrl: `blob:melody-${n}` })
afterEach(() => vi.restoreAllMocks())

describe('question audio lifetime', () => {
  it('retains live and reviewed audio, releasing skipped items and replaced voices', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const pool = new EarAudioPool()
    const live = generated(1)
    const skipped = generated(2)
    const replaced = generated(3)
    const reviewed = generated(4)
    for (const item of [live, skipped, replaced, reviewed, plainItem(base)]) pool.add(item)
    pool.retain([live, reviewed])
    expect(revoke.mock.calls.flat().sort()).toEqual(['blob:melody-2', 'blob:melody-3', 'blob:retone-2', 'blob:retone-3'])
    revoke.mockClear()
    pool.retain([live, { ...reviewed }])
    expect(revoke).not.toHaveBeenCalled()
    pool.clear()
    expect(revoke.mock.calls.flat().sort()).toEqual(['blob:melody-1', 'blob:melody-4', 'blob:retone-1', 'blob:retone-4'])
    revoke.mockClear()
    pool.clear()
    expect(revoke).not.toHaveBeenCalled()
  })

  it('bounds generated audio during long sessions, freeing review evictions', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const pool = new EarAudioPool()
    const history: EarItem[] = []
    for (let i = 0; i < 200; i++) {
      const item = generated(i)
      pool.add(item)
      pool.retain([...history, item])
      history.push(item)
      if (history.length > 50) history.shift()
    }
    // 50 review entries plus the entry evicted at the last iteration, until next retain.
    expect(revoke).toHaveBeenCalledTimes((200 - 51) * 2)
    pool.clear()
    expect(revoke).toHaveBeenCalledTimes(200 * 2)
    expect(new Set(revoke.mock.calls.flat()).size).toBe(200 * 2)
  })

  it('frees stale preparation results while preserving static recordings', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    releaseItem(generated(1))
    releaseItem(plainItem(base))
    releaseItem({ ...plainItem(base), qUrl: 'blob:hum' })
    expect(revoke.mock.calls.flat()).toEqual(['blob:retone-1', 'blob:melody-1', 'blob:hum'])
  })
})
