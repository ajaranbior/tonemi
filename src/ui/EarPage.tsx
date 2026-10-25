import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { topConfusions } from '../ear/adapt'
import { navigate, useRoute } from '../route'
import { getEarCombos, getEarConfusions, getPref, resetEar, setPref } from '../store'
import { EarBank } from './EarBank'
import { toneName } from './tone'

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

  // The learner overruled the key: the last miss counts as a hit.
  const overridden = useCallback(() => {
    setSession((s) => ({ ...s, ok: s.ok + 1 }))
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

function EarStats({ session, tick, onReset }: { session: { n: number; ok: number }; tick: number; onReset: () => void }) {
  void tick // re-read the store after every answer
  const combos = Object.entries(getEarCombos())
    .filter(([, s]) => s.n >= 2)
    .sort((a, b) => a[1].ema - b[1].ema)
    .slice(0, 4)
  const conf = topConfusions(getEarConfusions())
  if (!session.n && !combos.length && !conf.length) return null
  return (
    <details className="card settings" open={session.n >= 5}>
      <summary>
        Progress{session.n > 0 && ` · ${session.ok}/${session.n} this session`}
      </summary>
      {combos.length > 0 && (
        <p className="small">
          <strong>Weakest patterns:</strong>{' '}
          {combos.map(([c, s]) => `${[...c].join('-')} (${Math.round(s.ema * 100)}%)`).join(' · ')}
          <br />
          <span className="muted">These come up more often.</span>
        </p>
      )}
      {conf.length > 0 && (
        <p className="small">
          <strong>Most-confused:</strong>{' '}
          {conf.map(([e, c, n]) => `${toneName(e)} heard as ${toneName(c)} ×${n}`).join(' · ')}
        </p>
      )}
      <button onClick={onReset}>Reset ear stats</button>
    </details>
  )
}
