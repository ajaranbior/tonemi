import { useEffect, useState } from 'react'
import { loadManifest } from '../bank/load'
import type { Manifest } from '../bank/types'

export function AboutPage() {
  const [manifest, setManifest] = useState<Manifest | null>(null)
  useEffect(() => {
    loadManifest().then(setManifest, () => {})
  }, [])
  const community = Object.values(manifest?.speakers ?? {}).filter((s) => !s.tts && s.source.includes('wikimedia.org'))
  return (
    <div className="page">
      <section className="card">
        <h2>How it works</h2>
        <ul className="small">
          <li>Pitch is tracked in your browser (McLeod pitch method), converted to semitones and mapped onto Chao levels 1–5 using your calibrated range. The native speaker is mapped onto their own range, so heights compare fairly.</li>
          <li>Whole words are normalised together, so relative height between syllables counts — e.g. whether the 1 in 2+1 really sits above the end of the rise.</li>
          <li>Drills split your attempt into syllables at voicing gaps and energy dips, then compare each syllable's height and shape with the native recording. "Heard" labels come from simple tone templates and are a hint, not a verdict.</li>
          <li>Shadowing compares the whole line's melody (time-aligned with DTW) — no per-syllable matching yet.</li>
          <li>Everything stays on this device; progress is saved in this browser.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Credits</h2>
        <ul className="small">
          <li>
            Native word recordings: Yue Tan (Shtooka project), via{' '}
            <a href="https://github.com/hugolpz/audio-cmn" target="_blank" rel="noreferrer">audio-cmn</a> by Hugo Lopez —{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA</a>.
          </li>
          {community.length > 0 && (
            <li>
              More native speakers, recorded for{' '}
              <a href="https://lingualibre.org" target="_blank" rel="noreferrer">Lingua Libre</a> and shared on{' '}
              <a href="https://commons.wikimedia.org/wiki/Category:Lingua_Libre_pronunciation-cmn" target="_blank" rel="noreferrer">Wikimedia Commons</a>{' '}
              ({[...new Set(community.map((s) => s.license))].join(', ')}): {community.map((s) => s.short ?? s.name).join(', ')}. Only clips whose pitch matches the
              expected tones are kept; each voice can be switched off in Drill/Ear settings.
            </li>
          )}
          <li>
            Extra voices (switchable in Drill/Ear settings): Microsoft Edge neural text-to-speech voices (Xiaoxiao, Xiaoyi, Yunxia,
            Yunxi, Yunjian), generated with <a href="https://github.com/rany2/edge-tts" target="_blank" rel="noreferrer">edge-tts</a>{' '}
            for personal, non-commercial use. Only clips whose pitch matches the expected tones are kept.
          </li>
          <li>
            Pitch detection: <a href="https://github.com/ianprime0509/pitchy" target="_blank" rel="noreferrer">pitchy</a>. Pinyin:{' '}
            <a href="https://github.com/zh-lx/pinyin-pro" target="_blank" rel="noreferrer">pinyin-pro</a>.
          </li>
        </ul>
      </section>
    </div>
  )
}
