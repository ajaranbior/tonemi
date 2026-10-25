import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { topConfusions } from '../ear/adapt'
import { navigate, useRoute } from '../route'
import { getEarCombos, getEarConfusions, getPref, resetEar, setPref } from '../store'
import { EarBank } from './EarBank'
import type { Tone } from '../analysis/tones'
import { ToneChip, ToneGlyph } from './ToneGlyph'

// The video mode pulls in the pinyin dictionary; load it only when opened.
const EarClips = lazy(() => import('./EarClips'))

type Mode = 'words' | 'video'

export function EarPage() {
  const route = useRoute()
  // #/ear/video or #/ear/words; a bare #/ear restores the last used mode.
  const mode: Mode = route[1] === 'video' || route[1] === 'words' ? route[1] : (getPref('ear.mode', 'words') as Mode)
  // Make the mode explicit in the URL so history entries (Back) are unambiguous.
  useEffect(() => {
    if (route[1] !== mode) history.replaceState(null, '', `#/ear/${mode}`)
  }, [route, mode])
  const [session, setSession] = useState({ n: 0, ok: 0 })
  const [tick, setTick] = useState(0)

  const answered = useCallback((correct: boolean) => {
    setSession((s) => ({ n: s.n + 1, ok: s.ok + (correct ? 1 : 0) }))
    setTick((t) => t + 1)
  }, [])

  // The learner overruled the key (or took that back): a miss counts as a hit, or the reverse.
  const overridden = useCallback((delta: 1 | -1) => {
    setSession((s) => ({ ...s, ok: s.ok + delta }))
    setTick((t) => t + 1)
  }, [])

  const choose = (m: Mode) => {
    setPref('ear.mode', m)
    navigate('ear', m)
  }

  return (
    <div className="page">
      <div className="segmented" role="tablist" aria-label="Ear training source">
        <button role="tab" aria-selected={mode === 'words'} className={mode === 'words' ? 'active' : ''} onClick={() => choose('words')}>
          📚 Words
        </button>
        <button role="tab" aria-selected={mode === 'video'} className={mode === 'video' ? 'active' : ''} onClick={() => choose('video')}>
          🎬 Video / audio
        </button>
      </div>

      {mode === 'words' ? (
        <EarBank onAnswered={answered} onOverride={overridden} />
      ) : (
        <Suspense fallback={<div className="card">Loading…</div>}>
          <EarClips onAnswered={answered} onOverride={overridden} />
        </Suspense>
      )}

      <EarStats session={session} tick={tick} onReset={() => { resetEar(); setTick((t) => t + 1) }} />
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
    <details className="card settings" open={session.n >= 5}>
      <summary>
        Progress{session.n > 0 && ` · ${session.ok}/${session.n} right this session`}
      </summary>

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
