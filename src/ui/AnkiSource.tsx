import { useEffect, useRef, useState } from 'react'
import { AnkiConnect, AnkiError, AUTO, base64ToBytes, DEFAULT_URL, noteClip, sample, type AnkiNote } from '../anki/connect'
import { stitch } from '../anki/stitch'
import { SR } from '../analysis/pitch'
import { audioContext } from '../audio/context'
import { decodeTo16k } from '../audio/resample'
import { getPref, setPref } from '../store'
import type { Cue } from '../subtitles'

export interface AnkiLoaded {
  samples: Float32Array
  cues: Cue[]
  /** Short description, e.g. 'deck "Chinese" · 120 notes'. */
  label: string
}

const LIMITS = ['50', '100', '200', '400']
const PARALLEL = 4

/**
 * Pulls notes straight from the user's Anki collection via AnkiConnect, every time it loads, so
 * the clips always match the current deck. Audio is decoded and joined into one track with a
 * cue per note, which the clip trainer then cuts into words like a subtitled video.
 */
export function AnkiSource({ onLoad, busy }: { onLoad: (r: AnkiLoaded) => Promise<void>; busy: boolean }) {
  const [url, setUrl] = useState(() => getPref<string>('anki.url', DEFAULT_URL))
  const [key, setKey] = useState(() => getPref<string>('anki.key', ''))
  const [decks, setDecks] = useState<string[] | null>(null)
  const [deck, setDeck] = useState(() => getPref<string>('anki.deck', ''))
  const [filter, setFilter] = useState(() => getPref<string>('anki.filter', ''))
  const [limit, setLimit] = useState(() => getPref<string>('anki.limit', '100'))
  const [fields, setFields] = useState<string[]>([])
  const [audioField, setAudioField] = useState(() => getPref<string>('anki.audioField', AUTO))
  const [textField, setTextField] = useState(() => getPref<string>('anki.textField', AUTO))
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const working = useRef(false)

  const client = () => new AnkiConnect(url.trim() || DEFAULT_URL, key.trim() || undefined)
  const query = () => [deck && `deck:"${deck.replace(/"/g, '\\"')}"`, filter.trim()].filter(Boolean).join(' ')

  const connect = async () => {
    setError(null)
    setStatus('Connecting to Anki…')
    try {
      const a = client()
      await a.requestPermission()
      const names = (await a.deckNames()).sort((x, y) => x.localeCompare(y))
      setDecks(names)
      if (deck && !names.includes(deck)) setDeck('')
      setPref('anki.url', url.trim())
      setPref('anki.key', key.trim())
      setStatus(null)
      return true
    } catch (e) {
      setStatus(null)
      setError(e instanceof AnkiError ? e.message : String(e))
      return false
    }
  }

  const load = async () => {
    if (working.current) return
    working.current = true
    setError(null)
    try {
      if (!decks && !(await connect())) return
      const q = query()
      if (!q) throw new AnkiError('Pick a deck or type a search first.')
      for (const [k, v] of [['anki.deck', deck], ['anki.filter', filter], ['anki.limit', limit], ['anki.audioField', audioField], ['anki.textField', textField]]) setPref(k, v)
      const a = client()
      setStatus('Searching…')
      const ids = await a.findNotes(q)
      if (!ids.length) throw new AnkiError(`No notes match ${q}`)
      const notes: AnkiNote[] = []
      for (let i = 0; i < ids.length; i += 500) notes.push(...(await a.notesInfo(ids.slice(i, i + 500))))
      setFields([...new Set(notes.flatMap((n) => Object.keys(n.fields)))])
      const usable = notes.flatMap((n) => noteClip(n, audioField, textField) ?? [])
      if (!usable.length) {
        throw new AnkiError(
          `None of the ${notes.length} notes has both a [sound:…] field and Chinese text${audioField || textField ? ' in the chosen fields' : ''}. Try choosing the fields below.`,
        )
      }
      const picked = sample(usable, Number(limit))
      const ctx = audioContext()
      const clips: { samples: Float32Array; text: string }[] = []
      let done = 0
      let missing = 0
      const queue = [...picked]
      const worker = async () => {
        for (let n = queue.shift(); n; n = queue.shift()) {
          try {
            const b64 = await a.retrieveMediaFile(n.audio)
            if (b64) clips.push({ samples: await decodeTo16k(ctx, base64ToBytes(b64)), text: n.text })
            else missing++
          } catch (e) {
            if (e instanceof AnkiError) throw e
            missing++ // undecodable file
          }
          setStatus(`Fetching audio ${++done}/${picked.length}…`)
        }
      }
      await Promise.all(Array.from({ length: PARALLEL }, worker))
      if (!clips.length) throw new AnkiError('Could not load any of the audio files.')
      const { samples, cues } = stitch(clips, SR)
      const label = `${q} · ${clips.length} note${clips.length === 1 ? '' : 's'}${usable.length > clips.length + missing ? ` (random of ${usable.length})` : ''}${missing ? ` · ${missing} audio missing` : ''}`
      setStatus(null)
      setLoaded(label)
      setPref('anki.auto', true)
      await onLoad({ samples, cues, label })
    } catch (e) {
      setStatus(null)
      setError(e instanceof AnkiError ? e.message : String(e))
    } finally {
      working.current = false
    }
  }

  // Coming back after a successful load: fetch again, so edits and new cards in Anki show up.
  useEffect(() => {
    if (getPref('anki.auto', false) && (getPref<string>('anki.deck', '') || getPref<string>('anki.filter', ''))) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const disabled = busy || status !== null
  const form = (
    <>
          <label className="field-label small">
            Deck
            <select className="text-input" value={deck} onChange={(e) => setDeck(e.target.value)}>
              <option value="">(any deck — use the search below)</option>
              {(decks ?? []).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="field-label small">
            Extra Anki search (optional)
            <input className="text-input" placeholder='e.g. tag:hsk3, rated:7, is:due, "note:Chinese Sentences"' value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="anki-row">
            <label className="field-label small">
              Notes per load
              <select className="text-input" value={limit} onChange={(e) => setLimit(e.target.value)}>
                {LIMITS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="field-label small">
              Audio field
              <select className="text-input" value={audioField} onChange={(e) => setAudioField(e.target.value)}>
                <option value={AUTO}>Auto</option>
                {[...new Set([...fields, audioField].filter(Boolean))].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="field-label small">
              Chinese text field
              <select className="text-input" value={textField} onChange={(e) => setTextField(e.target.value)}>
                <option value={AUTO}>Auto</option>
                {[...new Set([...fields, textField].filter(Boolean))].map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
    </>
  )
  return (
    <>
      <h2>Train on your Anki cards</h2>
      {decks ? (
        <>
          {loaded ? (
            <details className="settings">
              <summary>Deck, search and fields</summary>
              {form}
            </details>
          ) : (
            form
          )}
          <button className="primary" onClick={() => void load()} disabled={disabled}>
            {loaded ? '🔄 Reload from Anki' : '📥 Load from Anki'}
          </button>
          {!fields.length && <p className="muted small">Field lists fill in after the first load. Auto takes the first field with a sound and the first other field with Chinese characters.</p>}
        </>
      ) : (
        <button className="primary" onClick={() => void (getPref('anki.auto', false) ? load() : connect())} disabled={disabled}>
          🔌 Connect to Anki
        </button>
      )}
      {loaded && <p className="muted small">🗂 {loaded}</p>}
      {status && <p className="muted small">{status}</p>}
      {error && <p className="bad small">{error}</p>}

      <details className="settings">
        <summary>Setup (once)</summary>
        <ol className="small">
          <li>
            In Anki desktop: <em>Tools → Add-ons → Get Add-ons…</em>, enter <code>2055492159</code> (AnkiConnect), restart Anki.
          </li>
          <li>Keep Anki open, then press <em>Connect</em> here. Anki asks whether to allow this site: click <em>Yes</em>.</li>
          <li>Your browser may also ask to let this page access devices on your local network: allow it.</li>
        </ol>
        <p className="muted small">
          Nothing is copied or uploaded: each load reads your current cards and audio straight from Anki on this computer, so new or edited
          cards show up on the next load. Works in Chrome, Edge and Firefox on the computer where Anki runs (Safari and phones can't reach Anki).
          Long sentences work best with “Phrase” or “3 words”; tones come from the card text with sandhi applied.
        </p>
        <label className="field-label small">
          AnkiConnect address
          <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field-label small">
          API key (only if you set one in AnkiConnect's config)
          <input className="text-input" type="password" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        {decks && <button onClick={() => void connect()} disabled={disabled}>Reconnect</button>}
      </details>
    </>
  )
}
