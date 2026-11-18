import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tone } from '../analysis/tones'
import { playUrl, wavUrl } from '../audio/playback'
import { retone, type Voice } from '../audio/retone'
import { synthTones } from '../audio/synth'
import { audioUrl, loadManifest } from '../bank/load'
import type { BankItem, Manifest } from '../bank/types'
import { pickVoice, usableItems, useVoiceVersion } from '../bank/voices'
import { inField } from './keys'
import { useSamples } from './useSamples'

const same = (a: Tone[], b: Tone[]) => a.length === b.length && a.every((t, i) => t === b[i])
const plain = (s: string) => s.toLowerCase().replace(/ü/g, 'v')

/** The asked recording, so it can be re-pitched to the learner's answer. */
export interface PreviewVoice extends Omit<Voice, 'samples'> {
  /** 16 kHz samples, or a URL to fetch them from. */
  samples?: Float32Array | null
  url?: string
  /** The tones actually spoken. */
  expected: Tone[]
}

export interface Preview {
  /** The tones the learner picked. */
  chosen: Tone[]
  /** Bank word to leave out of the fallback (the one that was just played). */
  exclude?: string
  /** Toneless syllables of the word that was asked; fallback recordings sharing them are preferred. */
  syllables?: string[]
  voice?: PreviewVoice
  /** Playhead while the same-voice version plays, in seconds from the start of the re-pitched audio. */
  onCursor?: (t: number | undefined) => void
}

/**
 * "If it were 2-3, it would sound like this": the very recording that was asked, re-pitched to the
 * tones picked (same voice, same word, so only the melody differs). When that isn't possible, a real
 * recording of another word with those tones, else a synthesized hum. A row inside the fixed-size
 * stage, plus the F key, so nothing on the page moves.
 */
export function AnswerButton({ chosen, exclude, syllables, voice, onCursor }: Preview) {
  const fetched = useSamples(voice && !voice.samples ? (voice.url ?? null) : null)
  const samples = voice?.samples ?? fetched
  const retoned = useMemo(() => (voice && samples ? retone({ ...voice, samples }, voice.expected, chosen) : null), [samples, voice, chosen])
  const sameUrl = useMemo(() => (retoned && retoned.length ? wavUrl(retoned) : null), [retoned])
  useEffect(() => () => { if (sameUrl) URL.revokeObjectURL(sameUrl) }, [sameUrl])
  // Same voice when it can be made; while the recording is still loading, wait for it.
  const waiting = !!voice && !samples
  const fallback = !waiting && !sameUrl
  const other = useOtherWord(fallback, chosen, exclude, syllables)

  const [playing, setPlaying] = useState(false)
  const latest = useRef(0)
  const cursor = useRef(onCursor)
  useEffect(() => {
    cursor.current = onCursor
  })
  useEffect(() => () => { ++latest.current }, [])

  const play = useCallback(async () => {
    const mine = ++latest.current
    let hum: string | null = null
    setPlaying(true)
    try {
      if (sameUrl) await playUrl(sameUrl, 1, (t) => cursor.current?.(Number.isNaN(t) ? undefined : t))
      else if (other.item) await playUrl(audioUrl(other.item))
      else if (other.range) await playUrl((hum = wavUrl(synthTones(chosen, other.range))))
    } catch {
      // ignore: nothing useful to show for a failed preview
    } finally {
      if (hum) URL.revokeObjectURL(hum)
    }
    if (mine === latest.current) {
      setPlaying(false)
      cursor.current?.(undefined)
    }
  }, [sameUrl, other, chosen])

  const ready = !!sameUrl || (fallback && (!!other.item || !!other.range))
  const label = chosen.join('-')
  const playRef = useRef(play)
  useEffect(() => {
    playRef.current = play
  })
  useEffect(() => {
    if (!ready) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inField(e) || e.repeat) return
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        void playRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready])

  const what = sameUrl ? 'Same voice, pitch moved by the app: a guide, not a native recording' : other.item ? `Another word with these tones: ${other.item.hanzi}` : 'Synthesized hum of these tones'
  return (
    <div className="answer-row">
      <button className="answer-play" onClick={() => void play()} disabled={!ready || playing} aria-label={`Hear your answer, ${label}`} aria-keyshortcuts="F">
        <span aria-hidden="true">{playing ? '🔊' : '▶'}</span> Your answer {label}
        <kbd>F</kbd>
      </button>
      <span className="muted small answer-note" title={ready ? what : undefined}>{ready ? what : 'Preparing…'}</span>
    </div>
  )
}

/** A real recording of another word with the chosen tones (only looked up when needed). */
function useOtherWord(active: boolean, chosen: Tone[], exclude?: string, syllables?: string[]): { item: BankItem | null; range: { lo: number; hi: number } | null } {
  const voiceVersion = useVoiceVersion()
  const [manifest, setManifest] = useState<Manifest | null>(null)
  useEffect(() => {
    if (active) loadManifest().then(setManifest, () => {})
  }, [active])
  return useMemo(() => {
    void voiceVersion // Recompute when the voice preferences change.
    if (!active || !manifest) return { item: null, range: null }
    const usable = usableItems(manifest)
    const asked = syllables?.map(plain) ?? []
    const shared = (i: BankItem) => i.syllables.filter((s, k) => plain(s) === asked[k]).length
    // Spoken 3-3 doesn't exist (the first becomes a 2nd tone): fall back to a word *written* that way.
    let pool = usable.filter((i) => same(i.surface, chosen) && i.id !== exclude)
    if (!pool.length) pool = usable.filter((i) => same(i.lexical, chosen) && i.id !== exclude)
    const best = pool.reduce<BankItem | undefined>((b, i) => (!b || shared(i) > shared(b) ? i : b), undefined)
    return { item: best ? pickVoice(manifest, best) : null, range: Object.values(manifest.speakers)[0].range }
  }, [active, manifest, chosen, exclude, syllables, voiceVersion])
}
