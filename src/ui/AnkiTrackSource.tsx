import { useEffect, useMemo, useRef, useState } from 'react'
import { AnkiConnect, base64ToBytes, DEFAULT_URL, type AnkiNote } from '../anki/connect'
import { audioContext } from '../audio/context'
import { decodeTo16k } from '../audio/resample'
import { ankiTracks, type AnkiTrack } from '../snippets/anki'
import { getPref, setPref } from '../store'

export function AnkiTrackSource({ busy, onLoad }: { busy: boolean; onLoad: (samples: Float32Array, text: string, label: string) => Promise<void> }) {
  const [url, setUrl] = useState(() => getPref<string>('anki.url', DEFAULT_URL))
  const [key, setKey] = useState(() => getPref<string>('anki.key', ''))
  const [deck, setDeck] = useState(() => getPref<string>('anki.deck', ''))
  const [filter, setFilter] = useState('')
  const [decks, setDecks] = useState<string[] | null>(null)
  const [notes, setNotes] = useState<AnkiNote[] | null>(null)
  const [audioField, setAudioField] = useState('')
  const [textField, setTextField] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const tracks = useMemo(() => ankiTracks(notes ?? [], audioField, textField), [notes, audioField, textField])
  const fields = useMemo(() => [...new Set(notes?.flatMap((n) => Object.keys(n.fields)) ?? [])], [notes])
  const disabled = busy || !!status
  const client = () => new AnkiConnect(url.trim() || DEFAULT_URL, key.trim() || undefined)

  const connect = async () => {
    setStatus('Connecting to Anki…'); setError('')
    try {
      const a = client()
      await a.requestPermission()
      const names = await a.deckNames()
      if (!alive.current) return
      setDecks(names.sort((a, b) => a.localeCompare(b)))
      setPref('anki.url', url.trim()); setPref('anki.key', key.trim())
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setStatus('') }
  }
  const search = async () => {
    setStatus('Finding card audio…'); setError(''); setNotes(null)
    try {
      const query = [deck && `deck:"${deck.replace(/"/g, '\\"')}"`, filter.trim()].filter(Boolean).join(' ')
      if (!query) throw new Error('Select a deck or enter an Anki search.')
      const a = client()
      const ids = await a.findNotes(query)
      const found: AnkiNote[] = []
      // Bound each read; a short snippet needs a card picker, not every audio file in the deck.
      for (let i = 0; i < Math.min(ids.length, 500); i += 100) {
        if (!alive.current) return
        found.push(...await a.notesInfo(ids.slice(i, Math.min(i + 100, 500))))
      }
      if (!alive.current) return
      setNotes(found); setPref('anki.deck', deck)
      if (!ids.length) setError('No cards matched this search.')
      else if (ids.length > 500) setError(`Showing the first 500 of ${ids.length} notes. Narrow the search to find a specific card.`)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setStatus('') }
  }
  const choose = async (track: AnkiTrack) => {
    const ctx = audioContext()
    setStatus(`Importing ${track.filename}…`); setError('')
    try {
      const data = await client().retrieveMediaFile(track.filename)
      if (!data) throw new Error('This audio file is missing from Anki. Sync media in Anki and try again.')
      const samples = await decodeTo16k(ctx, base64ToBytes(data))
      if (alive.current) await onLoad(samples, track.text, `Anki · ${deck || 'search'} · ${track.filename}`)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setStatus('') }
  }
  return <div className="anki-track-source">
    <p className="muted small">Open Anki desktop with AnkiConnect, then choose a deck and one audio track. Import on the computer running Anki; clips are saved in this browser.</p>
    {!decks ? <button onClick={() => void connect()} disabled={disabled}>Connect to Anki</button> : <>
      <label className="field-label">Deck<select aria-label="Deck" className="text-input" value={deck} disabled={disabled} onChange={(e) => { setDeck(e.target.value); setNotes(null) }}>
        <option value="">Any deck (use a search)</option>{decks.map((d) => <option key={d}>{d}</option>)}
      </select></label>
      <label className="field-label">Anki search (optional)<input className="text-input" placeholder="e.g. tag:hsk3 or is:due" value={filter} disabled={disabled} onChange={(e) => { setFilter(e.target.value); setNotes(null) }} /></label>
      <button onClick={() => void search()} disabled={disabled}>Find audio tracks</button>
    </>}
    {notes && <>
      <div className="snippet-fields">
        <label className="field-label small">Audio field<select aria-label="Audio field" className="text-input" value={audioField} disabled={disabled} onChange={(e) => setAudioField(e.target.value)}><option value="">All audio fields</option>{fields.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="field-label small">Transcript field<select aria-label="Transcript field" className="text-input" value={textField} disabled={disabled} onChange={(e) => setTextField(e.target.value)}><option value="">Auto-detect Chinese</option>{fields.map((f) => <option key={f}>{f}</option>)}</select></label>
      </div>
      <p className="muted small">{tracks.length} audio tracks · Check that the transcript matches the track you choose. You can edit it after importing.</p>
      <div className="snippet-track-list">{tracks.map((t) => <div className="snippet-saved" key={t.key}>
        <div><strong>{t.text || 'No transcript — recognize from audio'}</strong><div className="muted small">{t.filename} · {t.field} · note {t.noteId}</div></div>
        <button disabled={disabled} onClick={() => void choose(t)}>Import track</button>
      </div>)}</div>
      {!tracks.length && <p>No [sound:…] attachments found. Try another deck or audio field.</p>}
    </>}
    {status && <p role="status">{status}</p>}{error && <p className="bad" role="alert">{error}</p>}
    <details className="settings"><summary>Anki connection setup</summary>
      <p className="small">In Anki desktop: Tools → Add-ons → Get Add-ons… → 2055492159. Restart Anki, keep it open, then connect here and allow this site in Anki’s dialog.</p>
      <label className="field-label small">AnkiConnect address<input className="text-input" value={url} disabled={disabled} onChange={(e) => { setUrl(e.target.value); setDecks(null); setNotes(null) }} /></label>
      <label className="field-label small">API key (if configured)<input type="password" className="text-input" value={key} disabled={disabled} onChange={(e) => { setKey(e.target.value); setDecks(null); setNotes(null) }} /></label>
    </details>
  </div>
}
