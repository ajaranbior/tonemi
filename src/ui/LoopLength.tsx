import { useState } from 'react'
import { getLoopMs, LOOP_MS, setLoopMs } from '../audio/scrub'

/** Slider for how long a slice loops when holding on a pitch chart. Shared by every chart. */
export function LoopLength() {
  const [ms, setMs] = useState(getLoopMs)
  return (
    <label className="slider-setting">
      <span>
        Loop length when holding on the chart: <strong>{ms} ms</strong>
        <span className="muted small"> (shorter = more precise, longer = steadier tone)</span>
      </span>
      <input
        type="range"
        min={LOOP_MS.min}
        max={LOOP_MS.max}
        step={LOOP_MS.step}
        value={ms}
        onChange={(e) => {
          const v = Number(e.target.value)
          setMs(v)
          setLoopMs(v)
        }}
      />
    </label>
  )
}
