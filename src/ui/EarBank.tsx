import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SpeakerRange } from '../analysis/normalize'
import type { Tone } from '../analysis/tones'
import { playSequence, playUrl, stopPlayback } from '../audio/playback'
import { jitterRate, canRetone } from '../audio/variants'
import { audioUrl, loadManifest, refChao } from '../bank/load'
import type { BankItem, ItemKind, Manifest } from '../bank/types'
import { manyVoices, pickVoice, recordingExcluded, setRecordingExcluded, usableItems, useVoiceVersion, voiceCount, voiceLabel } from '../bank/voices'
import { duePattern, dueRetry, freshWeight, grade, melodyLevel, pickByCombo, pickWeighted } from '../ear/adapt'
import { useFlag } from '../flags'
import { givenMask, levelProgress, parsePath, passed, PATH, pathAnswer, type PathState } from '../ear/path'
import { getEarCombos, getEarSeen, getPref, setPref } from '../store'
import { answerUrl, EarAudioPool, prepareItem, realItem, releaseItem, type EarItem } from './earItem'
import { Toggle } from './Toggle'
import { LoopLength } from './LoopLength'
import { VoiceSettings } from './VoiceSettings'
import { PitchPlot, type PlotLine } from './PitchPlot'
import { answerOverlay, splitGiven } from './earPlot'
import { marked } from './tone'
import { EarStage, ResultChip } from './EarStage'
import { extendSketch, sketchLine, type Sketch } from './sketch'
import type { PreviewVoice } from './AnswerPreview'
import { SandhiNote, ToneAnswer } from './ToneAnswer'
import { useEarTrial, useEarControls, type TrialSource } from './useEarTrial'
import { isSnippet } from '../snippets/store'
import { BankScope } from './BankScope'
import { useSamples } from './useSamples'

type Kind = ItemKind | 'mix' | 'path'
const KINDS: [Kind, string][] = [['single', '1 syllable'], ['pair', '2'], ['triple', '3'], ['mix', 'Mix'], ['path', '🧭 Path']]
/** How many tones to name in a 2- or 3-syllable word; the rest are given. */
type Hide = '1' | '2' | 'all'
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th']
const BASIC: ItemKind[] = ['single', 'pair', 'triple']

const comboKey = (i: BankItem) => i.surface.join('')
const LENGTH: Record<ItemKind, number> = { single: 1, pair: 2, triple: 3 }
/** Share of questions that are a word moved to other tones, when retoned questions are on. */
const RETONE_SHARE = 0.5

/** An asked word plus the learner's drawing of it (draw-the-pitch mode) and the syllables given away. */
type Asked = EarItem & { sketch?: Sketch | null; given?: boolean[] }
const source: TrialSource<Asked> = { tones: (i) => i.surface, id: (i) => realItem(i).id, seenKey: (i) => i.seenKey, given: (i) => i.given }

export interface AnswerExtra {
  /** Right on a word that was missed a few trials earlier. */
  comeback: boolean
  /** Tone pattern (e.g. "3-4") that this answer pushed into the green. */
  milestone?: string
}

export interface EarProps {
  onAnswered: (correct: boolean, extra: AnswerExtra) => void
  onOverride: (delta: 1 | -1) => void
  /** Streaks & points enabled. */
  game: boolean
  onGame: (on: boolean) => void
}

export function EarBank({ onAnswered, onOverride, game, onGame }: EarProps) {
  const [onlySnippets, setOnlySnippets] = useState(false)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>(() => getPref('ear.kind', 'pair') as Kind)
  const [showHanzi, setShowHanzi] = useState(() => getPref<boolean>('ear.hanzi', false))
  const [hide, setHideState] = useState<Hide>(() => getPref('ear.hide', 'all') as Hide)
  const [path, setPathState] = useState<PathState>(() => parsePath(getPref('ear.path', '')))
  const pathRef = useRef(path)
  const [levelUp, setLevelUp] = useState<number | null>(null)
  const setPath = (p: PathState) => {
    pathRef.current = p
    setPathState(p)
    setPref('ear.path', JSON.stringify(p))
  }
  const [item, setItem] = useState<Asked | null>(null)
  const [sketch, setSketch] = useState<Sketch | null>(null)
  /** Auto A/B after a miss: 0 right, 1 yours, 2 right again; null when not playing. */
  const [abStep, setAbStep] = useState<number | null>(null)
  const flags = {
    retryOther: useFlag('retryOther'),
    fresh: useFlag('fresh'),
    retoned: useFlag('retoned'),
    jitter: useFlag('jitter'),
    autoAB: useFlag('autoAB'),
    melody: useFlag('melody'),
    draw: useFlag('draw'),
  }
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<number | undefined>()
  const voiceVersion = useVoiceVersion()
  const session = useEarTrial(item, source, { onAnswered, onOverride, game }, flags.retryOther)
  const { chosen, accepted, comeback, sound, setSound, autoReveal, setAutoReveal,
    trial, retry, review, archive, reset, submit, afterFeedback, cancelFeedback,
    rv, shown, shownChosen, shownAnswered, toggleAccept } = session
  const playToken = useRef(0)
  const autoplay = useRef(false)
  /** Last voice each word was played in, so a missed word comes back in another voice. */
  const lastVoice = useRef(new Map<string, string>())
  /** Bumped per question so a slow-to-prepare question doesn't land after a newer one. */
  const nextToken = useRef(0)
  const [audioPool] = useState(() => new EarAudioPool())

  useEffect(() => {
    audioPool.retain([...(item ? [item] : []), ...review.history.map((t) => t.item)])
  }, [audioPool, item, review.history])
  useEffect(() => () => {
    ++nextToken.current
    ++playToken.current
    stopPlayback()
    audioPool.clear()
  }, [audioPool])

  useEffect(() => {
    loadManifest().then(setManifest, (e) => setError(String(e)))
  }, [])

  const next = useCallback(
    (k: Kind, avoid?: Asked | null, play = true) => {
      if (!manifest) return
      const usable = usableItems(onlySnippets ? { ...manifest, items: manifest.items.filter(isSnippet) } : manifest)
      const level = k === 'path' ? PATH[pathRef.current.level] : undefined
      // How many syllables are asked; the others are given away.
      const asked = level ? level.hide : hide === 'all' || k === 'mix' ? Infinity : Number(hide)
      if (level) k = level.kind
      const byId = new Map(usable.map((i) => [i.id, i]))
      const inKind = (i: BankItem) => k === 'mix' || i.kind === k
      const avoidId = avoid ? realItem(avoid).id : undefined
      const seen = getEarSeen()
      const heard = (key: string) => seen[key]?.n ?? 0
      const weight = flags.fresh ? (i: BankItem) => freshWeight(heard(i.id)) : undefined
      let pick: BankItem | undefined
      let target: Tone[] | undefined

      if (flags.retryOther) {
        // A missed pattern comes back in another word (or the same word moved to it, or as a last resort the same word).
        const fits = (pattern: string) => k === 'mix' || pattern.length === LENGTH[k as ItemKind]
        const due = duePattern(retry.current, trial.current, (r) => fits(r.pattern!))
        if (due) {
          const pattern = [...due.pattern!].map(Number) as Tone[]
          const others = usable.filter((i) => comboKey(i) === due.pattern && i.id !== due.id && i.id !== avoidId)
          if (others.length) pick = weight ? pickWeighted(others, weight) : others[Math.floor(Math.random() * others.length)]
          else if (flags.retoned) {
            const movable = usable.filter((i) => canRetone(i.surface, pattern) && i.id !== due.id && i.id !== avoidId)
            pick = pickWeighted(movable, (i) => (flags.fresh ? freshWeight(heard(`${i.id}~${due.pattern}`)) : 1))
            if (pick) target = pattern
          }
          pick ??= byId.get(due.id)
        }
      } else {
        const due = dueRetry(retry.current, trial.current, (id) => !!byId.get(id) && inKind(byId.get(id)!) && id !== avoidId)
        pick = due ? byId.get(due) : undefined
      }
      if (!pick) {
        const kindNow = k === 'mix' ? BASIC[Math.floor(Math.random() * BASIC.length)] : k
        let pool = usable.filter((i) => i.kind === kindNow)
        if (!pool.length && k === 'mix') pool = usable
        if (pool.length > 1 && avoidId) pool = pool.filter((i) => i.id !== avoidId)
        pick = pickByCombo(pool, comboKey, getEarCombos(), Math.random, weight)
        // Retoned questions: keep the pattern chosen above, but say it with another word moved to it.
        if (pick && flags.retoned && Math.random() < RETONE_SHARE) {
          const pattern = pick.surface
          const key = comboKey(pick)
          const movable = pool.filter((i) => comboKey(i) !== key && canRetone(i.surface, pattern))
          const word = pickWeighted(movable, (i) => (flags.fresh ? freshWeight(heard(`${i.id}~${key}`)) : 1))
          if (word) {
            pick = word
            target = pattern
          }
        }
      }
      if (!pick) {
        ++nextToken.current
        ++playToken.current
        cancelFeedback()
        stopPlayback()
        setPlaying(false)
        setItem(null)
        return
      }
      pick = pickVoice(manifest, pick, lastVoice.current.get(pick.id))
      lastVoice.current.set(pick.id, pick.speaker)
      const melody = flags.melody ? melodyLevel(getEarCombos()[(target ?? pick.surface).join('')]) : 'full'
      const mine = ++nextToken.current
      cancelFeedback()
      ++playToken.current
      stopPlayback()
      void prepareItem(manifest, pick, target, melody).then((ready) => {
        if (mine !== nextToken.current) return releaseItem(ready)
        ++playToken.current
        stopPlayback()
        setPlaying(false)
        setCursor(undefined)
        audioPool.add(ready)
        archive(item ? { ...item, sketch } : null)
        const mask = givenMask(ready.surface.length, asked)
        const given = mask.some(Boolean) ? mask : undefined
        reset(ready.surface, given)
        setSketch(null)
        setAbStep(null)
        autoplay.current = play
        setItem({ ...ready, given })
      })
    },
    [manifest, onlySnippets, item, sketch, archive, reset, cancelFeedback, audioPool, trial, retry, hide, flags.fresh, flags.retryOther, flags.retoned, flags.melody],
  )

  useEffect(() => {
    let active = true
    if (manifest && !item) queueMicrotask(() => { if (active) next(kind, null, false) })
    return () => { active = false }
  }, [manifest, item, kind, next, voiceVersion])

  /** Play what is asked: the hum / muffled version before answering, the full word after. */
  const listen = useCallback(
    async (rate = 1, full = shownAnswered) => {
      if (!shown || recordingExcluded(realItem(shown).id, shown.speaker)) return
      const mine = ++playToken.current
      setAbStep(null)
      setPlaying(true)
      const reduced = !full && shown.qUrl
      const url = reduced ? shown.qUrl! : shown.url
      const t0 = reduced ? (shown.qT0 ?? 0) : shown.ref.t0
      // Jitter speeds/slows like a tape, so pitch moves too; the slow button keeps the pitch.
      const r = flags.jitter && rate === 1 ? jitterRate() : rate
      try {
        await playUrl(url, r, (t) => setCursor(Number.isNaN(t) ? undefined : t - t0), r === rate)
      } catch (e) {
        setError(String(e))
      }
      if (mine === playToken.current) setPlaying(false)
    },
    [shown, shownAnswered, flags.jitter],
  )

  useEffect(() => {
    if (shown && autoplay.current) {
      autoplay.current = false
      void listen()
    }
  }, [shown, listen])

  /** Same word, another voice (before or after answering); a retoned or melody-only question stays so. */
  const otherVoice = () => {
    if (!manifest || !item || rv) return
    const real = realItem(item)
    const v = pickVoice(manifest, real, item.speaker)
    lastVoice.current.set(v.id, v.speaker)
    const mine = ++nextToken.current
    cancelFeedback()
    ++playToken.current
    stopPlayback()
    void prepareItem(manifest, v, item.from ? item.surface : undefined, item.melody ?? 'full').then((ready) => {
      if (mine !== nextToken.current) return releaseItem(ready)
      ++playToken.current
      stopPlayback()
      setPlaying(false)
      setCursor(undefined)
      audioPool.add(ready)
      autoplay.current = true
      setItem({ ...ready, sketch: item.sketch, given: item.given })
    })
  }

  /** After a miss: the right tones, then the same recording moved to the answer, then the right ones again. */
  const playAB = useCallback(
    async (asked: EarItem, answers: Tone[]) => {
      if (!manifest || recordingExcluded(realItem(asked).id, asked.speaker)) return
      const mine = ++playToken.current
      const yours = await answerUrl(manifest, asked, answers)
      if (mine !== playToken.current) {
        if (yours) URL.revokeObjectURL(yours)
        return
      }
      if (!yours) return void listen(1, true)
      setPlaying(true)
      await playSequence([asked.url, yours, asked.url], () => mine === playToken.current, (i) => setAbStep(i < 0 ? null : i))
      URL.revokeObjectURL(yours)
      if (mine === playToken.current) setPlaying(false)
    },
    [manifest, listen],
  )

  const choose = (k: Kind) => {
    setKind(k)
    setPref('ear.kind', k)
    setLevelUp(null)
    next(k, item)
  }
  const chooseHide = (h: Hide) => {
    setHideState(h)
    setPref('ear.hide', h)
  }
  // A new number of tones to name applies from a fresh question.
  const hideRef = useRef(hide)
  useEffect(() => {
    if (hideRef.current === hide) return
    hideRef.current = hide
    next(kind, item)
  }, [hide, kind, item, next])
  const chooseLevel = (l: number) => {
    setPath({ ...pathRef.current, level: l })
    setLevelUp(null)
    next('path', item)
  }

  const check = useCallback((answers: (Tone | null)[] = chosen) => {
    const g = submit(answers)
    if (!g || !item) return
    if (kind === 'path') {
      const r = pathAnswer(pathRef.current, g.all)
      pathRef.current = r.state
      setPathState(r.state)
      setPref('ear.path', JSON.stringify(r.state))
      if (r.levelUp) setLevelUp(r.state.level)
    }
    if (!g.all && flags.autoAB) afterFeedback(() => void playAB(item, answers as Tone[]))
    else if (!g.all || item.melody) afterFeedback(() => void listen(1, true))
  }, [submit, chosen, item, kind, flags.autoAB, afterFeedback, playAB, listen])

  const { pick, advance } = useEarControls(session, check, () => next(kind, item), () => void listen())

  const refRange: SpeakerRange | null = manifest && shown ? manifest.speakers[shown.speaker].range : null
  const complete = chosen.length > 0 && chosen.every((c) => c !== null)
  // The asked recording, for "your answer in the same voice".
  // A retoned question previews from the real recording, with the real tones as the starting point.
  const voice = useMemo<PreviewVoice | undefined>(() => {
    void voiceVersion // Exclusions can change while a past answer is being reviewed.
    if (!shown || !refRange) return undefined
    const real = realItem(shown)
    if (recordingExcluded(real.id, shown.speaker)) return undefined
    return { url: real === shown ? shown.url : audioUrl(real), hop: real.ref.hop, t0: real.ref.t0, st: real.ref.st, segments: real.ref.segments, range: refRange, expected: real.surface }
  }, [shown, refRange, voiceVersion])
  const shownSketch = rv ? (rv.item.sketch ?? null) : sketch
  const sketchPlot = useMemo(() => sketchLine(shownSketch), [shownSketch])
  const g = useMemo(() => (shown && shownAnswered ? grade(shown.surface, shownChosen) : null), [shown, shownAnswered, shownChosen])

  if (error)
    return (
      <div className="card error">
        <p>{error}</p>
        <button onClick={() => setError(null)}>OK</button>
      </div>
    )
  if (!manifest) return <div className="card">Loading word bank…</div>
  if (!shown || !refRange) return <div className="card">
    <p>No recordings available for this selection. Restore an excluded recording or change the voice settings.</p>
    <button onClick={() => { setKind('mix'); next('mix', null, false) }}>Try all syllable counts</button>
    <VoiceSettings manifest={manifest} />
  </div>

  const pinyin = marked(shown.syllables, shown.surface)
  const ok = rv ? !!rv.accepted : accepted
  const given = shown.given
  const askedIdx = given ? given.flatMap((g, i) => (g ? [] : [i])) : []
  // One syllable asked in a longer word: outline where it is.
  const { hop, segments } = shown.ref
  const at = askedIdx.length === 1 ? askedIdx[0] : -1
  const focus =
    at >= 0 && segments.length > 1 && segments[at]
      ? {
          span: [segments[at][0] * hop, segments[at][1] * hop] as [number, number],
          others: segments.flatMap((sg, k) => (k === at ? [] : [[sg[0] * hop, sg[1] * hop] as [number, number]])),
        }
      : undefined
  const question = !given
    ? `Which ${shown.syllables.length > 1 ? 'tones' : 'tone'} do you hear?`
    : at >= 0
      ? `Which tone is the ${ORDINAL[at]} syllable?`
      : `Which tones are the ${askedIdx.map((i) => ORDINAL[i]).join(' and ')} syllables?`
  const kindNow = kind === 'path' ? PATH[path.level].kind : kind
  const hintChao = given && !shownAnswered ? refChao(shown, refRange) : null
  const hint = hintChao && given
    ? { lines: [splitGiven(hintChao, hop, segments, given).given], boundaries: segments.slice(1).map((sg) => sg[0] * hop) }
    : undefined

  return (
    <>
      <BankScope manifest={manifest} onlySnippets={onlySnippets} onChange={(on) => { setOnlySnippets(on); setKind('mix'); setItem(null) }} />
      <section className={`card ${g ? (g.all || ok ? 'flash-ok' : 'flash-bad') : ''}`}>
        <div className="item-head ear-head">
          <div>
            {shownAnswered || showHanzi ? (
              <>
                <div className="hanzi">
                  {shown.hanzi}
                  {shown.from && <span className="tag-retoned" title="Resynthesized with other tones">retoned</span>}
                </div>
                {shownAnswered && (
                  <div className="pinyin">
                    {pinyin.map((s, i) => (
                      <span key={i} className={`t${shown.surface[i]}`}>{s} </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="hanzi muted" aria-label="Word hidden">？</div>
            )}
          </div>
          {rv && <div className="review-slot"><span className="review-pill" title="Reviewing an earlier word">↩ Review {(review.index ?? 0) + 1} of {review.count}</span></div>}
          {g && <ResultChip key={shown.id + shownChosen.join('') + String(ok)} grade={g} accepted={ok} comeback={game && !rv && comeback} />}
        </div>

        <EarStage
          key={shown.id + String(review.index)}
          answered={shownAnswered && !!g}
          chart={g && <ReferenceChart item={shown} range={refRange} chosen={shownChosen} pinyin={pinyin} cursor={cursor} sketch={sketchPlot} focus={focus?.span} given={given} />}
          focus={focus}
          hint={hint}
          slots={shown.syllables.length}
          duration={shown.ref.st.length * shown.ref.hop}
          cursor={cursor}
          playing={playing}
          onPlay={() => void listen()}
          preview={g && !g.all && !ok ? { chosen: shownChosen as Tone[], exclude: realItem(shown).id, syllables: shown.syllables, voice } : null}
          sketch={
            flags.draw && !shownAnswered
              ? { line: sketchPlot, onDraw: (pt, start) => setSketch((sk) => extendSketch(sk, pt, start)), onClear: () => setSketch(null) }
              : undefined
          }
        />

        <div className="controls ear-controls">
          <button className="primary" onClick={() => listen(1)} disabled={playing || recordingExcluded(realItem(shown).id, shown.speaker)}>▶ Listen</button>
          <button onClick={() => listen(0.6)} disabled={playing || recordingExcluded(realItem(shown).id, shown.speaker)}>🐢 Slow</button>
          {manyVoices(manifest) && (
            <button onClick={otherVoice} disabled={playing || !!rv || voiceCount(manifest, shown) < 2} title="Same word, another voice">🔀 Voice</button>
          )}
        </div>
        <div className="muted small voice-tag">
          Voice: {voiceLabel(manifest, shown.speaker)}{' · '}
          <button className="link" disabled={playing || recordingExcluded(realItem(shown).id, shown.speaker)} onClick={() => {
            cancelFeedback()
            ++playToken.current
            stopPlayback()
            setRecordingExcluded(realItem(shown).id, shown.speaker, true)
            if (!rv && item) {
              if (voiceCount(manifest, realItem(item))) otherVoice()
              else next(kind, item, false)
            }
          }}>{recordingExcluded(realItem(shown).id, shown.speaker) ? 'Recording excluded' : 'Don’t play this voice for this word again'}</button>
        </div>
        {!shownAnswered && shown.melody && (
          <div className="muted small voice-tag">{shown.melody === 'hum' ? '🎵 Melody only: a hum of the speaker’s pitch' : '🔉 Muffled: listen for the melody'}</div>
        )}
        {abStep !== null && (
          <div className="ab-status small" role="status">
            {['Right tones', 'Your answer', 'Right tones'].map((label, i) => (
              <span key={i} className={i === abStep ? 'on' : ''}>{label}</span>
            ))}
          </div>
        )}
        {shownAnswered && shown.from && (
          <p className="muted small retoned-note">
            🎛 Retoned: {shown.hanzi} is really{' '}
            {marked(shown.from.syllables, shown.from.surface).map((p, i) => (
              <span key={i} className={`t${shown.from!.surface[i]}`}>{p} </span>
            ))}
            ({shown.from.surface.join('-')}); for this question the app moved its pitch to {shown.surface.join('-')}.
          </p>
        )}

        <h3 className="ear-q">{shownAnswered ? 'Answer' : question}</h3>
        <ToneAnswer chosen={shownChosen} expected={shownAnswered ? shown.surface : undefined} onPick={pick} given={given} />

        <div className="nav-row">
          <button onClick={review.back} disabled={!review.canBack}>← Back</button>
          {!shownAnswered && !autoReveal ? (
            <button className="primary" onClick={() => check()} disabled={!complete}>Check</button>
          ) : shownAnswered ? (
            <button className="primary" onClick={advance}>Next →</button>
          ) : (
            <button onClick={() => next(kind, item)}>Skip →</button>
          )}
        </div>
        {g && !g.all && (
          <button className="link small" onClick={toggleAccept}>{ok ? 'Undo: count this as incorrect again (M)' : 'I was right — mark my answer as correct (M)'}</button>
        )}
        {shownAnswered && <SandhiNote syllables={pinyin} expected={shown.surface} lexical={shown.lexical} />}
      </section>

      <div className="options">
        <p className="muted small">Word length</p>
        <div className="segmented compact" role="tablist" aria-label="Word length">
          {KINDS.map(([k, label]) => (
            <button key={k} disabled={onlySnippets && k !== 'mix' && (k === 'path' || !manifest.items.some((i) => isSnippet(i) && i.kind === k))} role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => choose(k)}>
              {label}
            </button>
          ))}
        </div>
        {(kind === 'pair' || kind === 'triple') && (
          <>
            <p className="muted small">Tones to name (the others are shown)</p>
            <div className="segmented compact" role="tablist" aria-label="Tones to name">
              {((kindNow === 'pair' ? [['1', '1'], ['all', 'Both']] : [['1', '1'], ['2', '2'], ['all', 'All 3']]) as [Hide, string][]).map(([h, label]) => {
                const on = hide === h || (kindNow === 'pair' && h === 'all' && hide === '2')
                return (
                  <button key={h} role="tab" aria-selected={on} className={on ? 'active' : ''} onClick={() => chooseHide(h)}>{label}</button>
                )
              })}
            </div>
          </>
        )}
      </div>
      {kind === 'path' && <PathCard path={path} levelUp={levelUp} onLevel={chooseLevel} />}
      <details className="card settings">
        <summary>Ear settings</summary>
        <Toggle label="Streaks and points" value={game} onChange={onGame} />
        <Toggle label="Sound effects and vibration for right/wrong" value={sound} onChange={setSound} />
        <Toggle label="Reveal the answer as soon as all tones are chosen" value={autoReveal} onChange={setAutoReveal} />
        <Toggle label="Show the character before answering" value={showHanzi} onChange={(v) => { setShowHanzi(v); setPref('ear.hanzi', v) }} />
        <LoopLength />
        <VoiceSettings manifest={manifest} />
      </details>
    </>
  )
}

export function ReferenceChart({ item, range, chosen, pinyin, cursor, sketch, focus, given }: { item: EarItem; range: SpeakerRange; chosen: (Tone | null)[]; pinyin: string[]; cursor?: number; sketch?: PlotLine | null; focus?: [number, number]; given?: boolean[] }) {
  const { hop } = item.ref
  const chao = useMemo(() => refChao(item, range), [item, range])
  const { labels, guess, boundaries } = useMemo(
    () => answerOverlay(item.ref.segments, item.surface, chosen, pinyin, hop, 0, chao),
    [item, chosen, pinyin, hop, chao],
  )
  // With some tones given, their part of the contour is greyed out so the asked syllables stand out.
  const lines = useMemo<PlotLine[]>(() => {
    const parts = given?.some(Boolean) ? (({ asked, given: g }) => [g, asked])(splitGiven(chao, hop, item.ref.segments, given)) : [{ t: Array.from(chao, (_, i) => i * hop), v: chao, kind: 'ref' as const }]
    return [...parts, ...(guess ? [guess] : []), ...(sketch ? [sketch] : [])]
  }, [chao, hop, guess, sketch, given, item])
  const samples = useSamples(item.url)
  return (
    <>
      <div className="stage-plot">
        <PitchPlot lines={lines} duration={chao.length * hop} labels={labels} boundaries={boundaries} cursor={cursor} height="100%" scrub={{ samples, offset: item.ref.t0 }} focus={focus} />
      </div>
      <div className="legend">
        <span className="key ref" /> the speaker's pitch
        {given?.some(Boolean) && (
          <>
            <span className="key given" /> other syllables
          </>
        )}
        {guess && (
          <>
            <span className="key wrong" /> the tone you picked
          </>
        )}
        {sketch && (
          <>
            <span className="key user" /> your drawing
          </>
        )}
        <span className="legend-hint">Space replays · hold & drag on the chart to loop a spot</span>
      </div>
    </>
  )
}

/** The learning path: each step names more of a word's tones; the next opens once the current one is solid. */
function PathCard({ path, levelUp, onLevel }: { path: PathState; levelUp: number | null; onLevel: (level: number) => void }) {
  const stat = path.stats[path.level]
  const pct = stat ? Math.round(stat.ema * 100) : null
  return (
    <section className="card path-card" aria-label="Learning path">
      <h3>Learning path</h3>
      <p className="muted small">
        Start with single syllables, then name one tone in two- and three-syllable words while the others are shown, then more,
        until you name every tone. The next step opens after 20 answers at 85% recent accuracy; you can also jump to any step.
      </p>
      <div className="path-steps" role="tablist" aria-label="Path steps">
        {PATH.map((l, i) => {
          const s = path.stats[i]
          const done = passed(s)
          return (
            <button key={i} role="tab" aria-selected={i === path.level}
              className={`path-step ${i === path.level ? 'active' : ''} ${done ? 'done' : ''} ${i > path.reached ? 'locked' : ''}`}
              title={s ? `${s.n} answers · ${Math.round(s.ema * 100)}% recently` : 'Not started'}
              onClick={() => onLevel(i)}>
              <span className="small">{done ? '✓ ' : i > path.reached ? '🔒 ' : ''}{l.label}</span>
              <span className="path-meter" aria-hidden="true"><span style={{ width: `${Math.round((done ? 1 : levelProgress(s)) * 100)}%` }} /></span>
            </button>
          )
        })}
      </div>
      <p className="muted small">
        Step {path.level + 1} of {PATH.length}: name {path.level === 0 ? 'the tone of single syllables' : `${PATH[path.level].label} tones`}
        {' · '}{stat ? `${stat.n} answers, ${pct}% recently` : 'no answers yet'}
      </p>
      {levelUp !== null && <p className="path-up" role="status">🎉 Step passed — now: {PATH[levelUp].label}</p>}
    </section>
  )
}
