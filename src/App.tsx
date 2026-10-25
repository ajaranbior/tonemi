import { lazy, Suspense, useState } from 'react'
import type { SpeakerRange } from './analysis/normalize'
import { DEFAULT_RANGES, getRange, isCalibrated, setRange } from './store'
import { AboutPage } from './ui/AboutPage'
import { CalibratePage } from './ui/CalibratePage'
import { DrillPage } from './ui/DrillPage'
import { EarPage } from './ui/EarPage'

// Shadowing pulls in the pinyin dictionary; load it only when opened.
const ShadowPage = lazy(() => import('./ui/ShadowPage'))

type Tab = 'drill' | 'ear' | 'shadow' | 'calibrate' | 'about'

const TABS: [Tab, string, string][] = [
  ['drill', '🎯', 'Drills'],
  ['ear', '👂', 'Ear'],
  ['shadow', '🎬', 'Shadow'],
  ['calibrate', '🎚️', 'Range'],
  ['about', 'ℹ️', 'About'],
]

export default function App() {
  const [range, setRangeState] = useState<SpeakerRange>(() => getRange() ?? DEFAULT_RANGES.low)
  const [calibrated, setCalibrated] = useState(isCalibrated)
  const [tab, setTab] = useState<Tab>(() => (getRange() ? 'drill' : 'calibrate'))

  const save = (r: SpeakerRange, measured: boolean) => {
    setRange(r, measured)
    setRangeState(r)
    setCalibrated(measured)
    setTab('drill')
  }

  return (
    <div className="app">
      <header className="top">
        <h1>
          tonemi <span className="muted">声调</span>
        </h1>
      </header>
      <main>
        {tab === 'drill' && <DrillPage range={range} calibrated={calibrated} onCalibrate={() => setTab('calibrate')} />}
        {tab === 'ear' && <EarPage />}
        {tab === 'shadow' && (
          <Suspense fallback={<div className="card">Loading…</div>}>
            <ShadowPage range={range} />
          </Suspense>
        )}
        {tab === 'calibrate' && <CalibratePage range={range} calibrated={calibrated} onSave={save} />}
        {tab === 'about' && <AboutPage />}
      </main>
      <nav className="tabs">
        {TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}>
            <span aria-hidden="true">{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
