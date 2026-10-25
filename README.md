# tonemi

**▶ Live app: <https://ajaranbior.github.io/tonemi/>**

A personal Mandarin tone **production and recognition** trainer. Runs entirely in the browser
(no server), works on phones, and can be hosted on GitHub Pages.

- **Drills** — 1, 2 and 3-syllable words for every tone combination (all 20
  two-syllable combos incl. neutral), 15–16 different native-recorded words per
  pair combo. Listen → speak → see your pitch over the native contour, per-syllable
  scores, "heard" tone labels and notes. Slow playback, hum-back mode,
  smooth-consonant filter, and a "weakest combos first" mix driven by your scores.
- **Ear** — tone *recognition*: hear a 1-, 2- or 3-syllable word (or a clip cut out of
  your own video) and pick the tone of every syllable. Practice adapts to you: weak tone
  patterns come up more often, missed items return a few trials later, and the progress
  card lists your most-confused tone pairs. After each answer you see the speaker's real
  pitch chart, and on a mistake the textbook shape of the tone you picked drawn over it.
  *Video mode*: load audio/video plus `.srt`/`.vtt`, the lines are split into words
  (`Intl.Segmenter`), clip boundaries are estimated from the pitch/energy of the audio,
  and you train on 1–3 words or a whole phrase at a time.
- **Shadowing** — load your own audio/video + `.srt`/`.vtt`, loop a line, echo
  it or shadow along; the whole-line melody is compared with DTW and scored.
  Subtitles show Mainland surface tones (一/不/3-3 sandhi, neutral tones).
- **Range calibration** — pitch is mapped onto Chao levels 1–5 of *your* range,
  and the native speaker onto theirs, so heights compare fairly.

See [docs/DESIGN.md](docs/DESIGN.md) for the concept and roadmap.

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (mic works on localhost)
npm run dev:https    # self-signed HTTPS on your LAN, to test on a phone
npm test             # unit tests (pitch tracking, segmentation, sandhi, subtitles)
npm run build        # static site in dist/
```

The microphone needs HTTPS (or localhost). On iOS, audio starts only after a tap.

### Deploy to GitHub Pages

`.github/workflows/pages.yml` runs lint, tests and the build on every push to
`main`, then publishes `dist/` to the `gh-pages` branch. Pages serves that branch
(**Settings → Pages → Source: Deploy from a branch → `gh-pages` / root**).
Live at <https://ajaranbior.github.io/tonemi/>.

### Using a YouTube video (Shadow and Ear)

Browsers can't download YouTube audio, so download the audio and Chinese subtitles locally, then load both files:

```bash
yt-dlp -x --audio-format m4a --write-subs --write-auto-subs --sub-langs zh-Hans --convert-subs srt URL
```

## Word bank

`public/bank/` (≈6 MB, committed) is generated from
[audio-cmn](https://github.com/hugolpz/audio-cmn) — native recordings by Yue Tan
(Shtooka project), CC BY-SA. To regenerate (needs `ffmpeg`):

```bash
git clone --filter=blob:none --no-checkout https://github.com/hugolpz/audio-cmn /tmp/audio-cmn
npm run build-bank -- /tmp/audio-cmn
```

Adding `FILL=1` before `npm run build-bank` instead *adds* recordings for tone patterns that have fewer than 4 items,
keeping every existing item and id (so saved progress stays valid).

The script picks common HSK words per tone combination (mixing sonorant-only
words like 妈妈/名人 with words containing stops and fricatives), runs every clip
through the app's own pitch analysis, and drops clips whose contour contradicts
the expected tones (catching wrong polyphone readings and missing neutral tones).

## How the analysis works

| Step | Where |
|---|---|
| YIN pitch tracking at 16 kHz / 10 ms, octave-error repair, creaky-voice detection | `src/analysis/pitch.ts` |
| Hz → semitones → Chao 1–5 using a speaker range (5th–95th percentile) | `src/analysis/normalize.ts` |
| Syllable segmentation with a known syllable count (gaps, energy dips, pitch breaks) | `src/analysis/segment.ts` |
| Per-syllable height/shape scoring, notes | `src/analysis/score.ts` |
| Template tone recognition (hint only) | `src/analysis/tones.ts` |
| Whole-line DTW comparison for shadowing | `src/analysis/shadow.ts` |
| Ear training: adaptive item choice, clip splitting and timing | `src/ear/` |
| Lexical/surface tones, sandhi | `src/g2p/tones.ts` |

Creaky voice — common at the bottom of T3 and T4 — has no measurable pitch, so
loud unpitched frames right after voicing are treated as creak and drawn as a
ramp down to Chao 1 rather than as silence.
