import { useEffect, useMemo, useRef, useState } from 'react'
import { SR, type PitchTrack } from '../analysis/pitch'
import { trackInWorker } from '../analysis/trackInWorker'
import type { Tone } from '../analysis/tones'
import { audioContext } from '../audio/context'
import { startRecording, type Recording } from '../audio/recorder'
import { decodeTo16k } from '../audio/resample'
import { stopPlayback } from '../audio/playback'
import { wavBlob } from '../audio/wav'
import { navigate } from '../route'
import { MAX_SECONDS, trimSilence } from '../snippets/audio'
import { alignCharacters, makeExercise, selectionLabels } from '../snippets/editor'
import { deleteSnippet, listSnippets, saveSnippet, type SavedSnippet } from '../snippets/store'
import { transcribe, type Transcript } from '../snippets/transcribe'
import { AnkiTrackSource } from './AnkiTrackSource'
import { micError } from './errors'
import { marked } from './tone'

interface Source { samples: Float32Array; track: PitchTrack; label: string }
function useWav(samples: Float32Array | null): string | undefined {
  const [url, setUrl] = useState<string | undefined>()
  useEffect(() => {
    const next = samples ? URL.createObjectURL(wavBlob(samples, SR)) : undefined
    // Blob URLs need an effect lifecycle so abandoned renders cannot leak audio buffers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next)
    return () => { if (next) URL.revokeObjectURL(next) }
  }, [samples])
  return url
}

export default function SnippetsPage() {
  const [input, setInput] = useState<'mic' | 'file' | 'anki'>('mic')
  const [source, setSource] = useState<Source | null>(null)
  const [text, setText] = useState('')
  const [transcript, setTranscript] = useState<Transcript | undefined>()
  const [selection, setSelection] = useState<[number, number] | null>(null)
  const [anchor, setAnchor] = useState<number | null>(null)
  const [bounds, setBounds] = useState<[number, number]>([0, 0])
  const [toneEdits, setToneEdits] = useState<Tone[] | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [recording, setRecording] = useState(false)
  const [saved, setSaved] = useState<SavedSnippet[]>([])
  const [saving, setSaving] = useState(false)
  const recorder = useRef<Recording | null>(null)
  const recognition = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const operation = useRef(0)
  const busy = !!status || recording || saving
  const duration = source ? source.samples.length / SR : 0
  const timings = useMemo(() => source ? alignCharacters(text, source.track, duration, transcript) : [], [text, source, duration, transcript])
  const labels = useMemo(() => selection ? selectionLabels(text, ...selection) : null, [text, selection])
  const chosen = labels ? { ...labels, surface: toneEdits ?? labels.surface, syllables: reading === null ? labels.syllables : reading.trim().split(/\s+/) } : null
  const cut = useMemo(() => source && selection ? source.samples.slice(Math.round(bounds[0] * SR), Math.round(bounds[1] * SR)) : null, [source, selection, bounds])
  const fullUrl = useWav(source?.samples ?? null)
  const cutUrl = useWav(cut)

  useEffect(() => {
    alive.current = true
    listSnippets().then((s) => { if (alive.current) setSaved(s) }, (e) => { if (alive.current) setError(`Could not open your snippet bank: ${String(e)}`) })
    // These refs hold cancellable operations, not DOM nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { alive.current = false; ++operation.current; recorder.current?.stop(); recognition.current?.abort(); stopPlayback() }
  }, [])

  const resetSelection = () => { setSelection(null); setAnchor(null); setToneEdits(null); setReading(null); setMessage('') }
  const recognize = async (src: Source) => {
    recognition.current?.abort()
    const controller = new AbortController()
    recognition.current = controller
    const token = ++operation.current
    setRecognizing(true); setStatus('Loading speech model for on-device Mandarin recognition…'); setError('')
    try {
      const result = await transcribe(src.samples, (s) => { if (alive.current && token === operation.current) setStatus(s) }, controller.signal)
      if (!alive.current || token !== operation.current) return
      setText(result.text.trim()); resetSelection()
      // Keep the transcript and timestamps text-identical for alignment.
      setTranscript({ ...result, text: result.text.trim() })
      if (!/\p{Script=Han}/u.test(result.text)) setError('No Chinese words recognized. Try again or enter what you hear below.')
    } catch (e) {
      if (alive.current && token === operation.current && !controller.signal.aborted) setError(`Recognition failed: ${e instanceof Error ? e.message : String(e)}. You can enter the Chinese transcript below or try recognition again.`)
    } finally {
      if (alive.current && token === operation.current) { setStatus(''); setRecognizing(false); recognition.current = null }
    }
  }
  const process = async (samples: Float32Array, knownText = '', label = 'Microphone') => {
    const token = ++operation.current
    recognition.current?.abort(); setError(''); setMessage(''); setStatus('Trimming silence and analyzing the voice…')
    try {
      if (samples.length > (MAX_SECONDS + 0.5) * SR) throw new Error(`Choose a short track of up to ${MAX_SECONDS} seconds. Cut a longer recording first.`)
      const cleaned = trimSilence(samples)
      const track = await trackInWorker(cleaned)
      if (!alive.current || token !== operation.current) return
      const src = { samples: cleaned, track, label }
      setSource(src); setText(knownText); setTranscript(undefined); resetSelection(); setStatus('')
      if (!/\p{Script=Han}/u.test(knownText)) await recognize(src)
    } catch (e) { if (alive.current && token === operation.current) { setStatus(''); setError(e instanceof Error ? e.message : String(e)) } }
  }
  const record = async () => {
    audioContext(); stopPlayback(); setError(''); setStatus('Opening microphone…')
    try {
      const rec = await startRecording({ maxSeconds: MAX_SECONDS })
      if (!alive.current) { rec.stop(); return }
      recorder.current = rec; setRecording(true); setStatus('')
      const samples = await rec.done
      recorder.current = null
      if (!alive.current) return
      setRecording(false)
      await process(samples)
    } catch (e) { if (alive.current) { setStatus(''); setRecording(false); setError(micError(e)) } }
  }
  const loadFile = async (file: File) => {
    const ctx = audioContext(); stopPlayback(); setError(''); setStatus('Reading audio…')
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Choose a short audio/video file under 50 MB.')
      const samples = await decodeTo16k(ctx, await file.arrayBuffer())
      if (alive.current) await process(samples, '', file.name)
    } catch (e) { if (alive.current) { setStatus(''); setError(`Could not import this track: ${e instanceof Error ? e.message : String(e)}. Use a browser-playable audio file or screen recording.`) } }
  }
  const select = (index: number) => {
    const from = anchor === null ? index : Math.min(anchor, index)
    const to = anchor === null ? index : Math.max(anchor, index)
    const span = timings.filter((c) => c.index >= from && c.index <= to)
    const between = [...text].slice(from, to + 1).join('')
    if (!span.length) return
    if (span.length > 3 || /[^\p{Script=Han}\s]/u.test(between)) { setError('Select up to 3 adjacent Chinese syllables within one phrase.'); setAnchor(index); return }
    setError(''); setMessage(''); setSelection([from, to]); setAnchor(anchor === null ? index : null)
    setBounds([Math.max(0, span[0].start - 0.04), Math.min(duration, span.at(-1)!.end + 0.04)])
    setToneEdits(null); setReading(null)
  }
  const save = async () => {
    if (!source || !cut || !chosen) return
    setSaving(true); setError('')
    try {
      if (chosen.syllables.length !== chosen.surface.length) throw new Error('Enter one pinyin syllable per selected character.')
      const track = await trackInWorker(cut)
      if (!alive.current) return
      const exercise = makeExercise(cut, track, chosen, source.track)
      const snippet = { ...exercise, sentence: text, created: new Date().getTime() }
      await saveSnippet(snippet)
      if (!alive.current) return
      setSaved((s) => [...s, snippet]); setMessage(`Saved ${chosen.hanzi} to your tone exercise bank. Choose another span to save more.`)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setSaving(false) }
  }
  const remove = async (id: string) => {
    try { await deleteSnippet(id); if (alive.current) setSaved((s) => s.filter((c) => c.item.id !== id)) }
    catch (e) { if (alive.current) setError(`Could not delete this snippet: ${String(e)}`) }
  }

  return <div className="page">
    <section className="card">
      <h2>Make a tone exercise</h2>
      <p className="muted">Capture a phrase → choose 1–3 syllables → save and practice.</p>
      <div className="segmented" role="tablist" aria-label="Snippet audio source">
        {([['mic', '● Microphone'], ['file', '↑ Audio / video'], ['anki', '🗂 Anki']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={input === id} className={input === id ? 'active' : ''} disabled={busy} onClick={() => setInput(id)}>{label}</button>)}
      </div>
      {input === 'mic' && <>
        <p className="muted small">Record a sentence or two, up to {MAX_SECONDS} seconds. Tap Stop when finished.</p>
        {recording ? <button className="primary recording" onClick={() => recorder.current?.stop()}>■ Stop recording</button> : <button className="primary" disabled={busy} onClick={() => void record()}>● Record a snippet</button>}
      </>}
      {input === 'file' && <>
        <p className="muted small">Choose a short audio track or phone screen recording (up to {MAX_SECONDS} seconds). To capture another phone app, use your phone’s screen recorder with device audio, then import it here.</p>
        <label className={`file ${busy ? 'muted' : ''}`}>↑ Import audio / video<input type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.mp4,.webm,.mov" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void loadFile(file) }} /></label>
      </>}
      {input === 'anki' && <AnkiTrackSource busy={busy} onLoad={process} />}
      <p className="muted small">Silence is trimmed automatically. Speech recognition runs on this device; first use downloads a speech model and may take a while on a phone. Audio and saved exercises stay in this browser.</p>
      {status && <div role="status"><p className="small">{status}</p>{recognizing && <button onClick={() => recognition.current?.abort()}>Cancel recognition</button>}</div>}
    </section>
    {error && <div className="card error" role="alert">{error}</div>}
    {source && <section className="card">
      <h2>Choose your words</h2>
      <p className="muted small">{source.label} · {duration.toFixed(1)}s after trimming</p>
      <audio controls src={fullUrl} aria-label="Full snippet" />
      <label className="field-label">Chinese transcript<textarea aria-label="Chinese transcript" className="text-input snippet-transcript" rows={3} value={text} disabled={busy} placeholder="Recognition appears here. You can also type or paste the Chinese sentence." onChange={(e) => { setText(e.target.value); setTranscript(undefined); resetSelection() }} /></label>
      <button disabled={busy} onClick={() => void recognize(source)}>Recognize again from audio</button>
      {timings.length > 0 && <>
        <p className="small">Tap the first and last character of a span (1–3 syllables). Tap the same character twice for a single syllable.</p>
        <div className="snippet-characters" aria-label="Select Chinese syllables">{[...text].map((char, index) => /\p{Script=Han}/u.test(char) ? <button key={index} disabled={busy} aria-label={`Select ${char}, character ${index + 1}`} aria-pressed={!!selection && index >= selection[0] && index <= selection[1]} className={selection && index >= selection[0] && index <= selection[1] ? 'active' : ''} onClick={() => select(index)}>{char}</button> : <span key={index}>{char}</span>)}</div>
      </>}
      {chosen && cut && <div className="snippet-selection">
        <h3>{chosen.hanzi} · {chosen.surface.length} syllable{chosen.surface.length === 1 ? '' : 's'}</h3>
        <p className="pinyin">{marked(chosen.syllables.slice(0, chosen.surface.length), chosen.surface).join(' ')}</p>
        <p className="muted small">Boundaries are estimated. Listen and adjust the cut; keep consonants and tone endings. Tones use the sentence context and can be corrected below.</p>
        <div className="snippet-fields">
          <label className="field-label small">Start · {bounds[0].toFixed(2)}s<input type="range" aria-label="Clip start" min={0} max={Math.max(0, bounds[1] - 0.08)} step="0.01" disabled={busy} value={bounds[0]} onChange={(e) => setBounds([Number(e.target.value), bounds[1]])} /></label>
          <label className="field-label small">End · {bounds[1].toFixed(2)}s<input type="range" aria-label="Clip end" min={bounds[0] + 0.08} max={duration} step="0.01" disabled={busy} value={bounds[1]} onChange={(e) => setBounds([bounds[0], Number(e.target.value)])} /></label>
        </div>
        <audio controls src={cutUrl} aria-label="Selected exercise preview" />
        <label className="field-label small">Pinyin (one syllable per character, without tone marks)<input className="text-input" value={reading ?? chosen.syllables.join(' ')} disabled={busy} onChange={(e) => setReading(e.target.value)} /></label>
        <div className="snippet-fields">{chosen.surface.map((tone, i) => <label key={i} className="field-label small">{[...chosen.hanzi][i]}<select className="text-input" value={tone} disabled={busy} onChange={(e) => { const next = chosen.surface.slice(); next[i] = Number(e.target.value) as Tone; setToneEdits(next) }}>{[1, 2, 3, 4, 0].map((t) => <option key={t} value={t}>{t === 0 ? 'Neutral' : `Tone ${t}`}</option>)}</select></label>)}</div>
        <button className="primary" disabled={busy || cut.length < SR * 0.08} onClick={() => void save()}>Save to tone exercises</button>
      </div>}
      {message && <p role="status">{message}</p>}
    </section>}
    <section className="card">
      <h2>My snippet bank · {saved.length}</h2>
      <p className="muted small">Saved clips join Words in Ear training and the Drills bank. Stored on this device and browser; clearing site data removes them.</p>
      {!saved.length && <p className="muted">Your selected phrases will appear here.</p>}
      {[...saved].reverse().map((s) => <div className="snippet-saved" key={s.item.id}>
        <div><strong>{s.item.hanzi}</strong><div className="small">{marked(s.item.syllables, s.item.surface).join(' ')} · {s.item.surface.map((t) => t || '0').join('–')}</div><div className="muted small">{s.sentence}</div></div>
        <div className="snippet-actions"><button onClick={() => navigate('drill', s.item.id)}>Practice</button><button aria-label={`Delete ${s.item.hanzi}`} onClick={() => void remove(s.item.id)}>Delete</button></div>
      </div>)}
    </section>
  </div>
}
