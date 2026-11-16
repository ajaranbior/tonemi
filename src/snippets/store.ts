import type { BankItem, Manifest, Speaker } from '../bank/types'

export interface SavedSnippet {
  item: BankItem
  speaker: Speaker
  audio: Blob
  created: number
  sentence: string
}
let connection: Promise<IDBDatabase> | null = null
const urls = new Map<string, string>()

function database(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('tonemi-snippets', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('clips', { keyPath: 'item.id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('Close other tonemi tabs and try again.'))
  }).catch((e) => { connection = null; throw e })
  return connection
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('clips', mode)
    const req = action(tx.objectStore('clips'))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error ?? req.error)
    tx.onabort = () => reject(tx.error ?? new Error('Could not save the clip. Browser storage may be full.'))
  })
}
export const listSnippets = () => transact('readonly', (s) => s.getAll()) as Promise<SavedSnippet[]>
export async function saveSnippet(snippet: SavedSnippet): Promise<void> {
  await transact('readwrite', (s) => s.add(snippet))
}
export async function deleteSnippet(id: string): Promise<void> {
  await transact('readwrite', (s) => s.delete(id))
  const url = urls.get(id)
  if (url) URL.revokeObjectURL(url)
  urls.delete(id)
}
export const isSnippet = (item: BankItem) => item.id.startsWith('snippet-')

/** Blob URLs live for this page session and are recreated from IndexedDB after a reload. */
export async function withSnippets(base: Manifest): Promise<Manifest> {
  // The native bank remains usable in browsers where persistent storage is unavailable.
  const saved = await listSnippets().catch(() => [] as SavedSnippet[])
  const speakers = { ...base.speakers }
  const items = saved.map((s) => {
    if (!urls.has(s.item.id)) urls.set(s.item.id, URL.createObjectURL(s.audio))
    speakers[s.item.speaker] = s.speaker
    return { ...s.item, audio: urls.get(s.item.id)! }
  })
  return { ...base, speakers, items: [...base.items, ...items] }
}
