export function AboutPage() {
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
          <li>
            Pitch detection: <a href="https://github.com/ianprime0509/pitchy" target="_blank" rel="noreferrer">pitchy</a>. Pinyin:{' '}
            <a href="https://github.com/zh-lx/pinyin-pro" target="_blank" rel="noreferrer">pinyin-pro</a>.
          </li>
        </ul>
      </section>
    </div>
  )
}
