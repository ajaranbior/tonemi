import { useEffect, useMemo, useRef, useState } from 'react'
import { AnkiConnect, AnkiError, AUTO, base64ToBytes, DEFAULT_URL, NONE, noteClip, sample, type AnkiNote, type NoteClip } from '../anki/connect'
import { stitch } from '../anki/stitch'
import { SR } from '../analysis/pitch'
import type { Tone } from '../analysis/tones'
import { audioContext } from '../audio/context'
import { decodeTo16k } from '../audio/resample'
import { getPref, setPref } from '../store'
import type { Cue } from '../subtitles'
import { ToneGlyph } from './ToneGlyph'

export interface AnkiLoaded {
  samples: Float32Array
  cues: Cue[]
  /** Short description, e.g. 'deck "Chinese" · 120 notes'. */
  label: string
}

const LIMITS = ['50', '100', '200', '400']
const PARALLEL = 4
const PREVIEW = 6

/**
 * Pulls notes straight from the user's Anki collection via AnkiConnect, every time it loads, so
 * the clips always match the current deck. First the notes are read and shown (sentence, word being
 * learned and its tones) so the fields can be checked; then their audio is decoded and joined into
 * one track with a cue per note, which the clip trainer cuts up like a subtitled video.
 */
export function AnkiSource({ onLoad, busy }: { onLoad: (r: AnkiLoaded) => Promise<void>; busy: boolean }) {
  const [url, setUrl] = useState(() => getPref<string>('anki.url', DEFAULT_URL))
  const [key, setKey] = useState(() => getPref<string>('anki.key', ''))
  const [decks, setDecks] = useState<string[] | null>(null)
  const [deck, setDeck] = useState(() => getPref<string>('anki.deck', ''))
  const [filter, setFilter] = useState(() => getPref<string>('anki.filter', ''))
  const [limit, setLimit] = useState(() => getPref<string>('anki.limit', '100'))
  const [audioField, setAudioField] = useState(() => getPref<string>('anki.audioField', AUTO))
  const [textField, setTextField] = useState(() => getPref<string>('anki.textField', AUTO))
  const [wordField, setWordField] = useState(() => getPref<string>('anki.wordField', AUTO))
  /** Notes found by the last search, waiting for the learner to check the fields. */
  const [found, setFound] = useState<{ query: string; notes: AnkiNote[] } | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const working = useRef(false)

  const client = () => new AnkiConnect(url.trim() || DEFAULT_URL, key.trim() || undefined)
  const query = () => [deck && `deck:"${deck.replace(/"/g, '\\"')}"`, filter.trim()].filter(Boolean).join(' ')
  const fail = (e: unknown) => {
    setStatus(null)
    setError(e instanceof AnkiError ? e.message : String(e))
  }

  const connect = async () => {
    setError(null)
    setStatus('Connecting to Anki…')
    try {
      const a = client()
      await a.requestPermission()
      const names = (await a.deckNames()).sort((x, y) => x.localeCompare(y))
      setDecks(names)
      setPref('anki.url', url.trim())
      setPref('anki.key', key.trim())
      setStatus(null)
      return true
    } catch (e) {
      fail(e)
      return false
    }
  }

  const search = async (): Promise<{ query: string; notes: AnkiNote[] } | null> => {
    const q = query()
    if (!q) throw new AnkiError('Pick a deck or type a search first.')
    const a = client()
    setStatus('Reading cards…')
    const ids = await a.findNotes(q)
    if (!ids.length) throw new AnkiError(`No notes match ${q}`)
    const notes: AnkiNote[] = []
    for (let i = 0; i < ids.length; i += 500) notes.push(...(await a.notesInfo(ids.slice(i, i + 500))))
    setStatus(null)
    return { query: q, notes }
  }

  /** Step 1: read the notes and show how they are understood. */
  const check = async () => {
    if (working.current) return
    working.current = true
    setError(null)
    try {
      if (!decks && !(await connect())) return
      setFound(await search())
      setEditing(true)
    } catch (e) {
      fail(e)
    } finally {
      working.current = false
    }
  }

  /** Step 2: fetch and decode the audio of (a random sample of) the usable notes. */
  const load = async (src: { query: string; notes: AnkiNote[] } | null) => {
    if (working.current || !src) return
    working.current = true
    setError(null)
    try {
      for (const [k, v] of [['anki.deck', deck], ['anki.filter', filter], ['anki.limit', limit], ['anki.audioField', audioField], ['anki.textField', textField], ['anki.wordField', wordField]]) setPref(k, v)
      const usable = src.notes.flatMap((n) => noteClip(n, audioField, textField, wordField) ?? [])
      if (!usable.length) throw new AnkiError(`None of the ${src.notes.length} notes has both a [sound:…] field and Chinese text. Choose the fields above.`)
      const picked = sample(usable, Number(limit))
      const a = client()
      const ctx = audioContext()
      const clips: Parameters<typeof stitch>[0] = []
      let done = 0
      let missing = 0
      const queue = [...picked]
      const worker = async () => {
        for (let n = queue.shift(); n; n = queue.shift()) {
          try {
            const b64 = await a.retrieveMediaFile(n.audio)
            if (b64) clips.push({ samples: await decodeTo16k(ctx, base64ToBytes(b64)), ...cueExtras(n) })
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
      const label = `${src.query} · ${clips.length} card${clips.length === 1 ? '' : 's'}${usable.length > clips.length + missing ? ` (random of ${usable.length})` : ''}${missing ? ` · ${missing} audio missing` : ''}`
      setStatus(null)
      setLoaded(label)
      setEditing(false)
      setPref('anki.auto', true)
      await onLoad({ samples, cues, label })
    } catch (e) {
      fail(e)
    } finally {
      working.current = false
    }
  }

  const reload = async () => {
    if (working.current) return
    working.current = true
    let src: Awaited<ReturnType<typeof search>> = null
    try {
      if (!decks && !(await connect())) return
      src = await search()
      setFound(src)
    } catch (e) {
      fail(e)
      return
    } finally {
      working.current = false
    }
    await load(src)
  }

  // Coming back after a successful load: read Anki again, so new and edited cards show up.
  useEffect(() => {
    if (getPref('anki.auto', false) && (getPref('anki.deck', '') || getPref('anki.filter', ''))) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fields = useMemo(() => [...new Set(found?.notes.flatMap((n) => Object.keys(n.fields)) ?? [])], [found])
  const parsed = useMemo(() => found?.notes.map((n) => noteClip(n, audioField, textField, wordField)) ?? [], [found, audioField, textField, wordField])
  const disabled = busy || status !== null

  const fieldSelect = (label: string, value: string, set: (v: string) => void, none?: string) => (
    <label className="field-label small">
      {label}
      <select className="text-input" value={value} onChange={(e) => set(e.target.value)}>
        <option value={AUTO}>Auto</option>
        {none && <option value={NONE}>{none}</option>}
        {[...new Set([...fields, value].filter((f) => f && f !== NONE))].map((f) => (
          <option key={f} value={f}>{f}</option>
        ))}
      </select>
    </label>
  )

  return (
    <>
      <h2>Train on your Anki cards</h2>
      {!decks ? (
        <button className="primary" onClick={() => void (getPref('anki.auto', false) ? reload() : connect())} disabled={disabled}>
          🔌 Connect to Anki
        </button>
      ) : loaded && !editing ? (
        <div className="controls">
          <button className="primary" onClick={() => void reload()} disabled={disabled}>🔄 Reload from Anki</button>
          <button onClick={() => setEditing(true)} disabled={disabled}>Change deck or fields</button>
        </div>
      ) : (
        <>
          <label className="field-label small">
            Deck
            <select className="text-input" value={deck} onChange={(e) => { setDeck(e.target.value); setFound(null) }}>
              <option value="">(any deck — use the search below)</option>
              {decks.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label className="field-label small">
            Extra Anki search (optional)
            <input className="text-input" placeholder='e.g. tag:hsk3, rated:7, is:due, "note:Chinese Sentences"' value={filter} onChange={(e) => { setFilter(e.target.value); setFound(null) }} />
          </label>
          {!found ? (
            <button className="primary" onClick={() => void check()} disabled={disabled}>🔍 Find cards</button>
          ) : (
            <>
              <div className="anki-row">
                {fieldSelect('Sentence (what the audio says)', textField, setTextField)}
                {fieldSelect('Word you are learning', wordField, setWordField, 'None — quiz the sentence')}
                {fieldSelect('Audio', audioField, setAudioField)}
                <label className="field-label small">
                  Cards per load
                  <select className="text-input" value={limit} onChange={(e) => setLimit(e.target.value)}>
                    {LIMITS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </label>
              </div>
              <Preview notes={found.notes} parsed={parsed} wordOff={wordField === NONE} />
              <div className="controls">
                <button className="primary" onClick={() => void load(found)} disabled={disabled || !parsed.some(Boolean)}>
                  📥 Looks right — load the audio
                </button>
                {loaded && <button onClick={() => setEditing(false)} disabled={disabled}>Cancel</button>}
              </div>
            </>
          )}
        </>
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
        </p>
        <label className="field-label small">
          AnkiConnect address
          <input className="text-input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </label>
        <label className="field-label small">
          API key (only if you set one in AnkiConnect's config)
          <input className="text-input" type="password" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <button onClick={() => void connect()} disabled={disabled}>Reconnect</button>
      </details>
    </>
  )
}

/** Fields of a note that become part of its cue. */
function cueExtras(n: NoteClip): Omit<Cue, 'start' | 'end'> {
  if (!n.focus) return { text: n.text }
  const tones: (Tone | null)[] = [...n.text].map(() => null)
  n.wordTones?.forEach((t, k) => (tones[n.focus![0] + k] = t))
  return { text: n.text, focus: n.focus, tones: n.wordTones ? tones : undefined }
}

/** Counts and a few sample cards, so the learner can see the fields were read correctly. */
function Preview({ notes, parsed, wordOff }: { notes: AnkiNote[]; parsed: (NoteClip | null)[]; wordOff: boolean }) {
  const ok = parsed.filter((p): p is NoteClip => !!p)
  const withWord = ok.filter((p) => p.word)
  const inSentence = withWord.filter((p) => p.focus)
  const withPinyin = inSentence.filter((p) => p.wordTones)
  // Show problems first, so a wrong field choice is obvious.
  const shown = useMemo(
    () => [...ok.filter((p) => p.word && (!p.focus || !p.wordTones)).slice(0, 2), ...ok.filter((p) => !p.word || (p.focus && p.wordTones))].slice(0, PREVIEW),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parsed],
  )
  return (
    <div className="anki-preview">
      <ul className="small anki-counts">
        <li>{notes.length} cards found · <strong>{ok.length}</strong> have audio and a Chinese sentence</li>
        {!wordOff && (
          <li>
            word you are learning: found in the sentence on <strong>{inSentence.length}</strong>
            {withWord.length > inSentence.length && <span className="bad"> ({withWord.length - inSentence.length} not in their sentence: those quiz the whole sentence)</span>}
            {inSentence.length > 0 && <> · tones read from the card's pinyin on <strong>{withPinyin.length}</strong>{withPinyin.length < inSentence.length && ' (the rest use the dictionary)'}</>}
          </li>
        )}
      </ul>
      {shown.length > 0 && (
        <table className="anki-table small">
          <thead>
            <tr>
              <th>Sentence</th>
              {!wordOff && <th>Word · tones</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.noteId}>
                <td>
                  {p.focus ? (
                    <>
                      {[...p.text].slice(0, p.focus[0]).join('')}
                      <mark>{[...p.text].slice(p.focus[0], p.focus[1]).join('')}</mark>
                      {[...p.text].slice(p.focus[1]).join('')}
                    </>
                  ) : (
                    p.text
                  )}
                </td>
                {!wordOff && (
                  <td>
                    {p.word ?? <span className="muted">—</span>}{' '}
                    {p.word && !p.focus ? (
                      <span className="bad">not in sentence</span>
                    ) : p.wordTones ? (
                      <span className="anki-tones" title="From the card's pinyin">
                        {p.wordTones.map((t, i) => <ToneGlyph key={i} tone={t} />)} {p.wordTones.map((t) => t || '0').join('-')}
                      </span>
                    ) : (
                      p.word && <span className="muted">no pinyin read · dictionary</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
