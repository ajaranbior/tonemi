import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tone } from '../analysis/tones'
import { playSequence, playUrl, stopPlayback } from '../audio/playback'
import { jitterRate } from '../audio/variants'
import { loadManifest } from '../bank/load'
import type { BankItem, ItemKind, Manifest } from '../bank/types'
import { pickVoice, usableItems } from '../bank/voices'
import { freshWeight, pickWeighted, topPair } from '../ear/adapt'
import { useFlag } from '../flags'
import { addEarConfusion, getEarConfusions, getEarSeen, getPref, recordEarSeen, setPref } from '../store'
import { FEEDBACK_SECONDS, playFeedback } from '../audio/sfx'
import { ReferenceChart, type EarProps } from './EarBank'
import { answerUrl, prepareItem, type EarItem } from './earItem'
import { EarStage, ResultChip } from './EarStage'
import { marked } from './tone'
import { ToneGlyph } from './ToneGlyph'

const ORDINAL = ['1st', '2nd', '3rd']
const PAIRS: [Tone, Tone][] = [[2, 3], [1, 4], [3, 4], [1, 2], [2, 4], [1, 3]]
const toneName = (t: Tone) => (t === 0 ? 'neutral' : `tone ${t}`)
const same = (a: Tone[], b: Tone[]) => a.length === b.length && a.every((t, i) => t === b[i])
/** Two 3rd tones in a row are never spoken as such, so a resynthesized 3-3 would teach something false. */
const speakable = (tones: Tone[]) => tones.every((t, i) => !(t === 3 && tones[i + 1] === 3))

function useManifest() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadManifest().then(setManifest, (e) => setError(String(e)))
  }, [])
  return { manifest, error }
}

function useFeedbackSound() {
  return getPref<boolean>('ear.sound', true)
}

const weightBy = (fresh: boolean, key: (i: BankItem) => string) => {
  const seen = getEarSeen()
  return (i: BankItem) => (fresh ? freshWeight(seen[key(i)]?.n ?? 0) : 1)
}

function Pattern({ item }: { item: BankItem }) {
  return (
    <span className="pinyin">
      {marked(item.syllables, item.surface).map((p, i) => (
        <span key={i} className={`t${item.surface[i]}`}>{p} </span>
      ))}
    </span>
  )
}

interface ContrastQ {
  item: EarItem
  /** Syllable asked about. */
  at: number
  /** The tone the other choice would have been. */
  other: Tone
}

/**
 * "A or B?": two-choice questions on one pair of tones (by default the learner's most frequent mix-up),
 * many different words in a row, then both versions of the same recording to compare.
 */
export function EarContrast({ onAnswered }: Pick<EarProps, 'onAnswered'>) {
  const { manifest, error } = useManifest()
  const fresh = useFlag('fresh')
  const retoned = useFlag('retoned')
  const jitter = useFlag('jitter')
  const autoAB = useFlag('autoAB')
  const sound = useFeedbackSound()
  const suggested = useMemo(() => topPair(getEarConfusions()) ?? [2, 3], [])
  const [pairKey, setPairKey] = useState(() => getPref('ear.contrastPair', suggested.join('')))
  const pair = useMemo(() => [Number(pairKey[0]), Number(pairKey[1])] as [Tone, Tone], [pairKey])
  const [q, setQ] = useState<ContrastQ | null>(null)
  const [picked, setPicked] = useState<Tone | null>(null)
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<number | undefined>()
  const [otherUrl, setOtherUrl] = useState<string | null>(null)
  const token = useRef(0)
  const autoplay = useRef(false)
  const last = useRef<string | null>(null)
  const current = useRef<ContrastQ | null>(null)
  useEffect(() => {
    current.current = q
  }, [q])
  /** Answered questions, so Q / ← can step back to look and listen again. */
  const [history, setHistory] = useState<{ q: ContrastQ; picked: Tone; otherUrl: string | null }[]>([])
  const [view, setView] = useState<number | null>(null)
  const recorded = useRef<ContrastQ | null>(null)

  const next = useCallback(
    (play = true) => {
      if (!manifest) return
      const [a, b] = pair
      const pool = usableItems(manifest).filter((i) => i.surface.some((t) => t === a || t === b) && i.id !== last.current)
      const word = pickWeighted(pool, weightBy(fresh, (i) => i.id))
      if (!word) return
      const spots = word.surface.flatMap((t, k) => (t === a || t === b ? [k] : []))
      const at = spots[Math.floor(Math.random() * spots.length)]
      const swap = (t: Tone) => (t === a ? b : a)
      let target: Tone[] | undefined
      if (retoned && Math.random() < 0.5) {
        const flipped = word.surface.map((t, k) => (k === at ? swap(t) : t))
        if (speakable(flipped)) target = flipped
      }
      last.current = word.id
      if (q && picked !== null && recorded.current !== q) {
        recorded.current = q
        const done = { q, picked, otherUrl }
        setHistory((h) => [...h, done].slice(-50))
      }
      setView(null)
      const voiced = pickVoice(manifest, word)
      const mine = ++token.current
      stopPlayback()
      void prepareItem(manifest, voiced, target).then((item) => {
        if (mine !== token.current) return
        autoplay.current = play
        setOtherUrl(null)
        setPicked(null)
        setQ({ item, at, other: swap(item.surface[at]) })
      })
    },
    [manifest, pair, fresh, retoned, q, picked, otherUrl],
  )

  useEffect(() => {
    if (manifest) next(false)
  }, [manifest, pairKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = view !== null ? history[view] : q ? { q, picked, otherUrl } : null
  const shownQ = shown?.q ?? null

  const listen = useCallback(
    async (url?: string) => {
      const q = shownQ
      if (!q) return
      const mine = ++token.current
      setPlaying(true)
      const r = jitter && !url ? jitterRate() : 1
      try {
        await playUrl(url ?? q.item.url, r, (t) => setCursor(Number.isNaN(t) || url ? undefined : t - q.item.ref.t0), r === 1)
      } catch {
        // ignore
      }
      if (mine === token.current) setPlaying(false)
    },
    [shownQ, jitter],
  )

  useEffect(() => {
    if (q && autoplay.current) {
      autoplay.current = false
      void listen()
    }
  }, [q, listen])
  useEffect(() => () => stopPlayback(), [])

  const answer = useCallback(
    (tone: Tone) => {
      if (!q || picked !== null || !manifest || view !== null) return
      const real = q.item.surface[q.at]
      const ok = tone === real
      setPicked(tone)
      recordEarSeen(q.item.seenKey, ok)
      if (!ok) addEarConfusion(`${real}>${tone}`)
      onAnswered(ok, { comeback: false })
      if (sound) playFeedback(ok, false)
      // The same recording with the asked syllable moved to the other choice, for comparing.
      const alt = q.item.surface.map((t, k) => (k === q.at ? q.other : t))
      const asked = q
      void answerUrl(manifest, q.item, alt).then((url) => {
        if (asked !== current.current) return
        setOtherUrl(url)
        if (!ok && autoAB && url) {
          const mine = ++token.current
          setTimeout(() => {
            if (mine !== token.current) return
            setPlaying(true)
            void playSequence([q.item.url, url, q.item.url], () => mine === token.current).then(() => mine === token.current && setPlaying(false))
          }, sound ? FEEDBACK_SECONDS * 1000 : 0)
        }
      })
    },
    [q, picked, manifest, onAnswered, sound, autoAB, view],
  )

  const back = useCallback(() => {
    const at = view ?? history.length
    if (at > 0) {
      ++token.current
      stopPlayback()
      setPlaying(false)
      setView(at - 1)
    }
  }, [view, history.length])
  /** Toward the present; from the live question once answered, on to a new one. */
  const forward = useCallback(() => {
    if (view !== null) {
      ++token.current
      stopPlayback()
      setPlaying(false)
      setView(view + 1 < history.length ? view + 1 : null)
    } else if (picked !== null) next()
  }, [view, history.length, picked, next])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !q) return
      if (e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'e' || e.key === 'E') {
        e.preventDefault()
        forward()
      } else if (e.key === 'ArrowLeft' || e.key === 'q' || e.key === 'Q') {
        e.preventDefault()
        back()
      } else if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (!e.repeat) void listen()
      } else if (picked === null && view === null && (Number(e.key) === pair[0] || Number(e.key) === pair[1])) {
        answer(Number(e.key) as Tone)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [q, picked, view, forward, back, listen, answer, pair])

  if (error) return <div className="card error"><p>{error}</p></div>
  if (!manifest || !shown || !shownQ) return <div className="card">Loading word bank…</div>

  const { item, at, other } = shownQ
  const shownPicked = shown.picked
  const shownOther = shown.otherUrl
  const range = manifest.speakers[item.speaker].range
  const answered = shownPicked !== null
  const real = item.surface[at]
  // The pair asked (a past question may have used another pair).
  const asked = [real, other].sort() as [Tone, Tone]
  const ok = shownPicked === real
  const pinyin = marked(item.syllables, item.surface)
  const chosen = item.surface.map((t, k) => (k === at ? (shownPicked ?? t) : t))
  const g = answered ? { correct: item.surface.map((_, k) => k !== at || ok), all: ok } : null

  return (
    <>
      <section className={`card ${g ? (ok ? 'flash-ok' : 'flash-bad') : ''}`}>
        <div className="item-head ear-head">
          <div>
            {answered ? (
              <>
                <div className="hanzi">
                  {item.hanzi}
                  {item.from && <span className="tag-retoned">retoned</span>}
                </div>
                <Pattern item={item} />
              </>
            ) : (
              <div className="hanzi muted" aria-label="Word hidden">？</div>
            )}
          </div>
          {view !== null && <div className="review-slot"><span className="review-pill">↩ Review {view + 1} of {history.length}</span></div>}
          {g && <ResultChip key={item.id + String(shownPicked)} grade={g} />}
        </div>
        <EarStage
          key={item.id + item.speaker + String(view)}
          answered={answered}
          chart={answered && <ReferenceChart item={item} range={range} chosen={chosen} pinyin={pinyin} cursor={cursor} />}
          slots={item.syllables.length}
          duration={item.ref.st.length * item.ref.hop}
          cursor={cursor}
          playing={playing}
          onPlay={() => void listen()}
        />
        <div className="controls ear-controls">
          <button className="primary" onClick={() => listen()} disabled={playing}>▶ Listen</button>
        </div>
        <h3 className="ear-q">
          {item.syllables.length > 1 ? `${ORDINAL[at]} of ${item.syllables.length} syllables: ` : ''}
          {toneName(asked[0])} or {toneName(asked[1])}?
        </h3>
        <div className="ab-choices">
          {asked.map((t) => (
            <button
              key={t}
              className={`tone-btn big t${t} ${answered ? (t === real ? 'ok' : t === shownPicked ? 'wrong' : '') : ''}`}
              disabled={answered}
              onClick={() => answer(t)}
            >
              <strong>{t}</strong>
              <ToneGlyph tone={t} />
            </button>
          ))}
        </div>
        {answered && (
          <div className="compare-row">
            <span className="muted small">Compare the same recording:</span>
            <button onClick={() => listen(item.url)} disabled={playing}>▶ as {toneName(real)} (real)</button>
            <button onClick={() => shownOther && listen(shownOther)} disabled={playing || !shownOther}>▶ as {toneName(other)}</button>
          </div>
        )}
        {answered && item.from && (
          <p className="muted small retoned-note">
            🎛 Retoned: {item.hanzi} is really <Pattern item={item.from} />; the app moved its pitch for this question.
          </p>
        )}
        <div className="nav-row">
          <button onClick={back} disabled={(view ?? history.length) === 0}>← Back</button>
          {answered ? <button className="primary" onClick={forward}>Next →</button> : <button onClick={() => next()}>Skip →</button>}
        </div>
        <p className="muted small keys">Keys: {asked[0]} / {asked[1]} answer · Space replay · Q ← previous · E → Enter next</p>
      </section>
      <div className="options">
        <p className="muted small">Tone pair{suggested.join('') === pairKey ? ' (your most common mix-up)' : ''}</p>
        <div className="segmented compact" role="tablist" aria-label="Tone pair">
          {PAIRS.map(([a, b]) => {
            const k = `${Math.min(a, b)}${Math.max(a, b)}`
            return (
              <button key={k} role="tab" aria-selected={pairKey === k} className={pairKey === k ? 'active' : ''} onClick={() => { setPairKey(k); setPref('ear.contrastPair', k) }}>
                {Math.min(a, b)}/{Math.max(a, b)}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

interface SameDiffQ {
  a: EarItem
  b: EarItem
  same: boolean
}

/** "Same or different?": two different words (usually two voices); do they share a tone pattern? */
export function EarSameDiff({ onAnswered }: Pick<EarProps, 'onAnswered'>) {
  const { manifest, error } = useManifest()
  const fresh = useFlag('fresh')
  const retoned = useFlag('retoned')
  const sound = useFeedbackSound()
  const [kind, setKind] = useState<ItemKind>(() => {
    const k = getPref<string>('ear.kind', 'pair')
    return k === 'single' || k === 'triple' ? k : 'pair'
  })
  const [q, setQ] = useState<SameDiffQ | null>(null)
  const [said, setSaid] = useState<boolean | null>(null)
  const [step, setStep] = useState<number | null>(null)
  const token = useRef(0)
  const autoplay = useRef(false)

  const next = useCallback(
    (play = true) => {
      if (!manifest) return
      const pool = usableItems(manifest).filter((i) => i.kind === kind)
      const w = weightBy(fresh, (i) => i.id)
      const a = pickWeighted(pool, w)
      if (!a) return
      const wantSame = Math.random() < 0.5
      const key = (i: BankItem) => i.surface.join('')
      let b: BankItem | undefined
      let target: Tone[] | undefined
      if (wantSame) {
        b = pickWeighted(pool.filter((i) => i.id !== a.id && key(i) === key(a)), w)
        // No other word has this pattern: move one to it.
        if (!b && retoned) {
          b = pickWeighted(pool.filter((i) => i.id !== a.id && i.surface.every((t, k) => (t === 0) === (a.surface[k] === 0))), w)
          if (b) target = a.surface
        }
      }
      if (!b) {
        // Different: prefer patterns one syllable away, along the learner's most confused pair.
        const conf = topPair(getEarConfusions())
        const diffs = (i: BankItem) => i.surface.filter((t, k) => t !== a.surface[k])
        const near = pool.filter((i) => i.id !== a.id && diffs(i).length === 1)
        const hard = conf ? near.filter((i) => i.surface.some((t, k) => t !== a.surface[k] && conf.includes(t) && conf.includes(a.surface[k]))) : []
        b = pickWeighted(hard.length ? hard : near.length ? near : pool.filter((i) => i.id !== a.id && key(i) !== key(a)), w)
      }
      if (!b) return
      const va = pickVoice(manifest, a)
      const vb = pickVoice(manifest, b, va.speaker)
      const mine = ++token.current
      stopPlayback()
      void Promise.all([prepareItem(manifest, va), prepareItem(manifest, vb, target)]).then(([pa, pb]) => {
        if (mine !== token.current) return
        autoplay.current = play
        setSaid(null)
        setStep(null)
        setQ({ a: pa, b: pb, same: same(pa.surface, pb.surface) })
      })
    },
    [manifest, kind, fresh, retoned],
  )

  useEffect(() => {
    if (manifest) next(false)
  }, [manifest, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const playBoth = useCallback(async () => {
    if (!q) return
    const mine = ++token.current
    await playSequence([q.a.url, q.b.url], () => mine === token.current, (i) => setStep(i < 0 ? null : i), 0.6)
    if (mine === token.current) setStep(null)
  }, [q])

  useEffect(() => {
    if (q && autoplay.current) {
      autoplay.current = false
      void playBoth()
    }
  }, [q, playBoth])
  useEffect(() => () => stopPlayback(), [])

  const answer = useCallback(
    (sameSaid: boolean) => {
      if (!q || said !== null) return
      const ok = sameSaid === q.same
      setSaid(sameSaid)
      recordEarSeen(q.a.seenKey, ok)
      onAnswered(ok, { comeback: false })
      if (sound) playFeedback(ok, false)
    },
    [q, said, onAnswered, sound],
  )

  const playOne = (url: string, i: number) => {
    const mine = ++token.current
    setStep(i)
    void playUrl(url).finally(() => mine === token.current && setStep(null))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !q) return
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (said !== null) next()
      } else if (e.key === ' ' || e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        if (!e.repeat) void playBoth()
      } else if (said === null && (e.key === 's' || e.key === 'S' || e.key === '1')) answer(true)
      else if (said === null && (e.key === 'd' || e.key === 'D' || e.key === '2')) answer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [q, said, next, playBoth, answer])

  if (error) return <div className="card error"><p>{error}</p></div>
  if (!manifest || !q) return <div className="card">Loading word bank…</div>

  const answered = said !== null
  const ok = said === q.same
  const g = answered ? { correct: [ok], all: ok } : null

  return (
    <>
      <section className={`card ${g ? (ok ? 'flash-ok' : 'flash-bad') : ''}`}>
        <div className="item-head ear-head">
          <h3 className="ear-q">Same tone pattern, or different?</h3>
          {g && <ResultChip key={q.a.id + q.b.id + String(said)} grade={g} />}
        </div>
        <div className="pair-cards">
          {[q.a, q.b].map((it, i) => (
            <button key={i} className={`pair-card ${step === i ? 'on' : ''}`} onClick={() => playOne(it.url, i)}>
              <span className="muted small">{i ? 'B' : 'A'} ▶</span>
              {answered ? (
                <>
                  <span className="hanzi-sm">{it.hanzi}{it.from && <span className="tag-retoned">retoned</span>}</span>
                  <Pattern item={it} />
                  <span className="pattern-glyphs">
                    {it.surface.map((t, k) => <ToneGlyph key={k} tone={t} />)}
                  </span>
                </>
              ) : (
                <span className="hanzi muted">？</span>
              )}
            </button>
          ))}
        </div>
        <div className="controls ear-controls">
          <button className="primary" onClick={() => void playBoth()} disabled={step !== null}>▶ Play A then B</button>
        </div>
        <div className="ab-choices">
          <button className={`big ${answered ? (q.same ? 'ok' : said ? 'wrong' : '') : ''}`} disabled={answered} onClick={() => answer(true)}>Same (S)</button>
          <button className={`big ${answered ? (!q.same ? 'ok' : !said ? 'wrong' : '') : ''}`} disabled={answered} onClick={() => answer(false)}>Different (D)</button>
        </div>
        <div className="nav-row">
          <span />
          {answered ? <button className="primary" onClick={() => next()}>Next →</button> : <button onClick={() => next()}>Skip →</button>}
        </div>
      </section>
      <div className="options">
        <p className="muted small">Word length</p>
        <div className="segmented compact" role="tablist" aria-label="Word length">
          {(['single', 'pair', 'triple'] as const).map((k, i) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {i ? i + 1 : '1 syllable'}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
