import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { topConfusions } from '../ear/adapt'
import { addDays, DAILY_GOAL, dailyStreak, dayKey, GREEN, GREEN_MIN_TRIES, pointsFor, POINTS, sinceMonday } from '../ear/game'
import { navigate, useRoute } from '../route'
import { addEarGame, getEarCombos, getEarConfusions, getEarGame, getPref, resetEar, setPref } from '../store'
import { EarBank, type AnswerExtra } from './EarBank'
import type { Tone } from '../analysis/tones'
import { ToneChip, ToneGlyph } from './ToneGlyph'

// The video mode pulls in the pinyin dictionary; load it only when opened.
const EarClips = lazy(() => import('./EarClips'))

type Mode = 'words' | 'video' | 'anki'
const MODES: Mode[] = ['words', 'video', 'anki']

export function EarPage() {
  const route = useRoute()
  // #/ear/words, #/ear/video or #/ear/anki; a bare #/ear restores the last used mode.
  const mode: Mode = MODES.includes(route[1] as Mode) ? (route[1] as Mode) : (getPref('ear.mode', 'words') as Mode)
  // Make the mode explicit in the URL so history entries (Back) are unambiguous.
  useEffect(() => {
    if (route[1] !== mode) history.replaceState(null, '', `#/ear/${mode}`)
  }, [route, mode])
  const [session, setSession] = useState({ n: 0, ok: 0 })
  const [tick, setTick] = useState(0)
  const [game, setGame] = useState(() => getPref<boolean>('ear.game', true))
  const [combo, setCombo] = useState(0)
  /** Latest points gained, keyed so the float animation restarts. */
  const [gain, setGain] = useState<{ n: number; pts: number; comeback: boolean } | null>(null)
  const [toast, setToast] = useState<{ n: number; text: string } | null>(null)
  /** Pattern that just turned green; keyed so the score's nudge animation restarts. */
  const [milestone, setMilestone] = useState<{ n: number; combo: string } | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((text: string) => {
    setToast((t) => ({ n: (t?.n ?? 0) + 1, text }))
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  // Points and days are tracked even with the game hidden, so switching it on shows real history.
  const answered = useCallback(
    (correct: boolean, extra: AnswerExtra) => {
      setSession((s) => ({ n: s.n + 1, ok: s.ok + (correct ? 1 : 0) }))
      setTick((t) => t + 1)
      const today = dayKey()
      const before = getEarGame().days[today] ?? 0
      const nextCombo = correct ? combo + 1 : 0
      setCombo(nextCombo)
      const pts = pointsFor(correct, extra.comeback)
      addEarGame(today, pts, 1, nextCombo)
      if (!game) return
      setGain((g) => ({ n: (g?.n ?? 0) + 1, pts, comeback: extra.comeback }))
      if (before + 1 === DAILY_GOAL) showToast(`🔥 Daily goal reached · ${dailyStreak(getEarGame().days, today)}-day streak`)
      else if (extra.milestone) {
        showToast(`🎉 ${extra.milestone} is green now · hover ★ for all patterns`)
        setMilestone((m) => ({ n: (m?.n ?? 0) + 1, combo: extra.milestone!.replaceAll('-', '') }))
      }
      else if (correct && nextCombo > 0 && nextCombo % 10 === 0) showToast(`⚡ ${nextCombo} in a row!`)
    },
    [combo, game, showToast],
  )

  // The learner overruled the key (or took that back): a miss counts as a hit, or the reverse.
  const overridden = useCallback((delta: 1 | -1) => {
    setSession((s) => ({ ...s, ok: s.ok + delta }))
    addEarGame(dayKey(), delta * (POINTS.correct - POINTS.attempt), 0)
    setTick((t) => t + 1)
  }, [])

  const toggleGame = (on: boolean) => {
    setGame(on)
    setPref('ear.game', on)
  }

  const choose = (m: Mode) => {
    setPref('ear.mode', m)
    navigate('ear', m)
  }

  return (
    <div className="page">
      {game && <GameBar tick={tick} combo={combo} gain={gain} milestone={milestone} />}

      {mode === 'words' ? (
        <EarBank onAnswered={answered} onOverride={overridden} game={game} onGame={toggleGame} />
      ) : (
        <Suspense fallback={<div className="card">Loading…</div>}>
          <EarClips key={mode} source={mode} onAnswered={answered} onOverride={overridden} game={game} onGame={toggleGame} />
        </Suspense>
      )}

      <div className="options">
        <p className="muted small">Practice with</p>
        <div className="segmented compact" role="tablist" aria-label="Ear training source">
          <button role="tab" aria-selected={mode === 'words'} className={mode === 'words' ? 'active' : ''} onClick={() => choose('words')}>
            📚 Words
          </button>
          <button role="tab" aria-selected={mode === 'video'} className={mode === 'video' ? 'active' : ''} onClick={() => choose('video')}>
            🎬 Video / audio
          </button>
          <button role="tab" aria-selected={mode === 'anki'} className={mode === 'anki' ? 'active' : ''} onClick={() => choose('anki')}>
            🗂 Anki
          </button>
        </div>
      </div>

      <EarStats session={session} tick={tick} onReset={() => { resetEar(); setTick((t) => t + 1) }} />

      {toast && (
        <div key={toast.n} className="toast" role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}

/** One fixed-height strip: daily streak, today's goal, combo and points. */
function GameBar({
  tick,
  combo,
  gain,
  milestone,
}: {
  tick: number
  combo: number
  gain: { n: number; pts: number; comeback: boolean } | null
  milestone: { n: number; combo: string } | null
}) {
  void tick // re-read the store after every answer
  const [open, setOpen] = useState(false)
  const g = getEarGame()
  const today = dayKey()
  const done = g.days[today] ?? 0
  const streak = dailyStreak(g.days, today)
  const pct = Math.min(1, done / DAILY_GOAL)
  return (
    <div className="game-bar" aria-label="Streaks and points">
      <span className={`game-stat ${streak > 0 ? 'lit' : ''}`} title={`Days in a row with at least ${DAILY_GOAL} answers (right or wrong)`}>
        🔥 <strong>{streak}</strong> <span className="muted">day{streak === 1 ? '' : 's'}</span>
      </span>
      <span className="game-stat" title={`Today: ${done} of ${DAILY_GOAL} answers`}>
        <span className="goal-ring" style={{ ['--p' as string]: `${pct * 360}deg` }} aria-hidden="true" />
        <span className="muted">{Math.min(done, DAILY_GOAL)}/{DAILY_GOAL} today</span>
      </span>
      <span className={`game-stat ${combo >= 3 ? 'lit' : ''}`} title={`Right answers in a row (best ${g.bestCombo})`}>
        ⚡ <strong>{combo}</strong>
      </span>
      <span className={`game-stat game-xp ${open ? 'open' : ''}`} onMouseLeave={() => setOpen(false)}>
        <button
          key={milestone?.n ?? 0}
          className={`xp-btn ${milestone ? 'nudge' : ''}`}
          aria-expanded={open}
          aria-label={`${g.xp} points. Show tone pattern progress`}
          onClick={() => setOpen((o) => !o)}
          onBlur={() => setOpen(false)}
        >
          ★ <strong>{g.xp.toLocaleString()}</strong>
        </button>
        {gain && (
          <span key={gain.n} className={`points-float ${gain.comeback ? 'comeback' : ''}`} aria-hidden="true">
            +{gain.pts}
          </span>
        )}
        <PatternPopover fresh={milestone?.combo} />
      </span>
    </div>
  )
}

/** Compact per-pattern progress shown from the score: which tone patterns are green so far. */
function PatternPopover({ fresh }: { fresh?: string }) {
  const all = Object.entries(getEarCombos())
    .filter(([, s]) => s.n >= 2)
    .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
  const isGreen = (s: { n: number; ema: number }) => s.n >= GREEN_MIN_TRIES && s.ema >= GREEN
  const green = all.filter(([, s]) => isGreen(s)).length
  return (
    <div className="xp-pop" role="tooltip">
      <p className="xp-pop-head">
        <strong>Tone patterns</strong>
        <span className="muted small">{all.length ? `${green} of ${all.length} green` : 'none yet'}</span>
      </p>
      <p className="muted small">Points: +2 any answer, +10 right, +25 right on a word you missed before.</p>
      {all.length > 0 && (
        <ul className="xp-pop-grid">
          {all.map(([combo, s]) => {
            const pct = Math.round(s.ema * 100)
            return (
              <li key={combo} className={`xp-chip ${isGreen(s) ? 'green' : ''} ${combo === fresh ? 'fresh' : ''}`} title={`${s.n} tries`}>
                <span className="small">{[...combo].join('-')}</span>
                <strong style={{ color: gradeColor(pct) }}>{pct}%</strong>
              </li>
            )
          })}
        </ul>
      )}
      <p className="muted small">Green = {Math.round(GREEN * 100)}%+ after {GREEN_MIN_TRIES} tries. Details under Progress.</p>
    </div>
  )
}

/** The last five weeks as a small calendar, shaded by answers per day. */
function PracticeCalendar() {
  const days = getEarGame().days
  const today = dayKey()
  // Start on the Monday five weeks back so the columns line up by weekday.
  const start = addDays(today, -sinceMonday(today) - 28)
  const cells = Array.from({ length: 35 }, (_, i) => addDays(start, i))
  return (
    <div className="calendar" role="img" aria-label="Practice over the last five weeks">
      {cells.map((d) => {
        const n = days[d] ?? 0
        const level = d > today ? 'future' : n === 0 ? 'l0' : n < DAILY_GOAL / 2 ? 'l1' : n < DAILY_GOAL ? 'l2' : 'l3'
        return <span key={d} className={`cal-day ${level} ${d === today ? 'today' : ''}`} title={`${d}: ${n} answers`} />
      })}
    </div>
  )
}

/** Red up to ~15%, green from ~95%, a smooth ramp in between. */
const gradeColor = (pct: number) => `hsl(${Math.round(Math.min(120, Math.max(0, (pct - 15) * 1.5)))} 62% 46%)`

const toneOf = (c: string): Tone => Number(c) as Tone

function PatternGlyphs({ combo }: { combo: string }) {
  return (
    <span className="pattern-glyphs" aria-hidden="true">
      {[...combo].map((c, i) => (
        <ToneGlyph key={i} tone={toneOf(c)} />
      ))}
    </span>
  )
}

function EarStats({ session, tick, onReset }: { session: { n: number; ok: number }; tick: number; onReset: () => void }) {
  void tick // re-read the store after every answer
  const [showAll, setShowAll] = useState(false)
  const all = Object.entries(getEarCombos())
    .filter(([, s]) => s.n >= 2)
    .sort((a, b) => a[1].ema - b[1].ema || b[1].n - a[1].n)
  const combos = showAll ? all : all.slice(0, 6)
  const conf = topConfusions(getEarConfusions(), 5)
  if (!session.n && !all.length && !conf.length) return null
  return (
    <details className="card settings">
      <summary>
        Progress{session.n > 0 && ` · ${session.ok}/${session.n} right this session`}
      </summary>

      {Object.keys(getEarGame().days).length > 0 && (
        <section className="stat-block">
          <h3>Practice days</h3>
          <p className="muted small">Last five weeks, Monday first; darker means more answers (goal: {DAILY_GOAL} a day).</p>
          <PracticeCalendar />
        </section>
      )}

      {all.length > 0 && (
        <section className="stat-block">
          <h3>Tone patterns, hardest first</h3>
          <p className="muted small">
            How often you got the whole pattern right in your recent answers. The red ones come up more often.
          </p>
          <ul className="stat-list">
            {combos.map(([combo, s]) => {
              const pct = Math.round(s.ema * 100)
              return (
                <li key={combo} className="stat-row">
                  <span className="stat-pattern">
                    <PatternGlyphs combo={combo} />
                    <span className="small muted">{[...combo].join('-')}</span>
                  </span>
                  <span className="stat-bar" role="img" aria-label={`${pct}% right`}>
                    <span style={{ width: `${Math.max(pct, 3)}%`, background: gradeColor(pct) }} />
                  </span>
                  <strong className="stat-pct" style={{ color: gradeColor(pct) }}>{pct}%</strong>
                </li>
              )
            })}
          </ul>
          {all.length > 6 && (
            <button className="link small" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${all.length} patterns`}
            </button>
          )}
        </section>
      )}

      {conf.length > 0 && (
        <section className="stat-block">
          <h3>Your most common mix-ups</h3>
          <p className="muted small">The tone it really was → the tone you answered, and how many times.</p>
          <ul className="stat-list">
            {conf.map(([expected, answered, n]) => (
              <li key={`${expected}${answered}`} className="mixup">
                <ToneChip tone={expected} short />
                <span className="muted" aria-label="answered as">→</span>
                <ToneChip tone={answered} short />
                <strong>×{n}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button onClick={onReset}>Reset ear stats</button>
    </details>
  )
}
