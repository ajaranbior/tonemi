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
  card lists your most-confused tone pairs. For 2- and 3-syllable words you can choose how many
  tones to name (1, 2 or all): the other syllables' tones are shown, and a single asked syllable is
  outlined on the chart. *🧭 Path* turns this into a progression — single syllables → 1 of 2 → 2 of 2 →
  1 of 3 → 2 of 3 → 3 of 3 — where the next step opens after 20 answers at 85% recent accuracy (any
  step can be picked directly). Partial questions count toward mix-ups but not toward tone-pattern scores. After each answer you see the speaker's real
  pitch chart, and on a mistake the textbook shape of the tone you picked drawn over it.
  The chart lives in a fixed-size box, so the buttons never move when the answer appears; after a
  mistake a second tab plays your answer: the same recording with its pitch moved to the tones you
  picked (TD-PSOLA resynthesis, so it's the same voice and word), or a real recording of another word
  with those tones. Optional streaks and points (Ear
  settings): a daily-practice streak that counts any answer, a right-in-a-row combo, and a bonus
  for getting a previously missed word right. Words are played in a random voice (the native
  speakers by default); a missed word comes back in another available voice. Five optional neural TTS
  voices can be enabled separately for single syllables, pairs and triples in Experiments. Beside the
  current voice, “Don’t play this voice for this word again” excludes just that word/voice recording.
  Exclusions persist in this browser and can be restored in Drill/Ear settings.
  *Video mode*: load audio/video plus `.srt`/`.vtt`, the lines are split into words
  (`Intl.Segmenter`), clip boundaries are estimated from the pitch/energy of the audio,
  and you train on 1–3 words or a whole phrase at a time.
  *Anki mode*: train on the audio of your own Anki cards. With Anki desktop open and the
  [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on installed, pick a deck (plus an
  optional Anki search such as `tag:hsk3` or `rated:7`). Each load reads the cards' `[sound:…]` audio and
  Chinese text straight from Anki, so new and edited cards show up the next time; the field holding the
  audio and the one holding the sentence are found automatically or can be chosen. If a field holds the
  word you're learning (e.g. `学习 xuéxí`, tone marks or numbers), only that word is cut out of the
  sentence audio and quizzed, with its tones taken from your pinyin; the whole sentence stays one tap
  away. A preview shows how the cards were read before any audio loads. The first time, Anki asks
  whether to allow the site. Chrome, Edge and Firefox on the computer running Anki; Safari and phones
  can't reach AnkiConnect.
- **Ear experiments** (Ear → 🧪 Experiments, each a switch): aimed at hearing the pitch instead of
  remembering recordings. A missed pattern comes back as a *different* word; words heard least come up first;
  *retoned questions* play a word with its pitch moved to other tones (TD-PSOLA), so knowing the word is no help;
  every play can vary ±10% in speed and pitch; after a miss the app plays right → yours → right; *melody first*
  plays weak patterns as a hum of the speaker's real pitch, then muffled, then the full word; you can draw the
  pitch before answering; two extra exercises, *A or B?* on your most-confused tone pair and *same or
  different?* on two words; and Progress shows first-listen vs repeat accuracy.
- **Shadowing** — load your own audio/video + `.srt`/`.vtt`, loop a line, echo
  it or shadow along; the whole-line melody is compared with DTW and scored.
  Subtitles show Mainland surface tones (一/不/3-3 sandhi, neutral tones).
- **Range calibration** — pitch is mapped onto Chao levels 1–5 of *your* range,
  and the native speaker onto theirs, so heights compare fairly.

See [docs/DESIGN.md](docs/DESIGN.md) for the concept and roadmap.

## More real voices

The bank includes Yue Tan for all 696 words and Chen Wang for 200 of the 256 single-syllable items.
There are 64 single-syllable words per tone, with 64 distinct syllable sounds within each tone.
Human recordings are enabled by default; synthetic voices start off, including on existing installations.
To rebuild Chen Wang's additions from an [audio-cmn](https://github.com/hugolpz/audio-cmn) clone (needs `ffmpeg`):

```bash
git -C /path/to/audio-cmn checkout HEAD -- 64k/syllabs
npm run build-syllables -- /path/to/audio-cmn
```

Use `APPEND=1` to add missing Chen Wang recordings while preserving existing recordings and pitch references.

The importer matches toned pinyin, checks segmentation and pitch, and copies accepted original MP3s
unchanged. It preserves word IDs, progress, other voices and recording exclusions. Attribution is shown
in About and source links are kept per recording. Automated pitch checks are a filter, not a listening review.

`npm run build-commons` adds native speakers from [Lingua Libre](https://lingualibre.org) (Wikimedia Commons,
CC BY-SA) to the word bank as extra voices: it searches Commons for each bank word, downloads the recordings,
keeps only clips whose pitch matches the expected tones (same check as the other voices), and credits each
speaker in the app. `LIST=1` shows the speakers found; `SPEAKERS=` / `EXCLUDE=` pick whose voices to use.
Needs `ffmpeg` and `curl`, and network access to commons.wikimedia.org.

Tone Perfect access/redistribution is still pending; see [audio source notes](docs/AUDIO-SOURCES.md).

## Run

```bash
npm install
npm run dev          # http://localhost:5173 (mic works on localhost)
npm run dev:https    # self-signed HTTPS on your LAN, to test on a phone
npm test             # analysis and UI regression tests
npm run build        # static site in dist/
```

The microphone needs HTTPS (or localhost). On iOS, audio starts only after a tap.

### Deploy to GitHub Pages

`.github/workflows/pages.yml` runs lint, tests and the build on branch pushes
(except `gh-pages`) and pull requests. Successful `main` builds publish `dist/`
to the `gh-pages` branch. Pages serves that branch
(**Settings → Pages → Source: Deploy from a branch → `gh-pages` / root**).
Live at <https://ajaranbior.github.io/tonemi/>.

### Using a YouTube video (Shadow and Ear)

Browsers can't download YouTube audio, so download the audio and Chinese subtitles locally, then load both files:

```bash
yt-dlp -x --audio-format m4a --write-subs --write-auto-subs --sub-langs zh-Hans --convert-subs srt URL
```

## Word bank

`public/bank/` (≈15 MB, committed) is generated from
[audio-cmn](https://github.com/hugolpz/audio-cmn) — native recordings by Yue Tan
(Shtooka project), CC BY-SA. To regenerate (needs `ffmpeg`):

```bash
git clone --filter=blob:none --no-checkout https://github.com/hugolpz/audio-cmn /tmp/audio-cmn
npm run build-bank -- /tmp/audio-cmn
```

Adding `FILL=1` before `npm run build-bank` instead *adds* recordings for tone patterns that have fewer than 4 items,
keeping every existing item and id (so saved progress stays valid).

To expand only single-syllable words without rebuilding the bank:

```bash
SINGLE_PER_TONE=64 npm run build-bank -- /path/to/audio-cmn
```

This adds common HSK 1–6 words, favors syllable sounds not already represented in each tone, and
keeps the normal pitch check. Existing items, recordings, IDs, progress and exclusions are preserved.
Running it again at the same target leaves the bank unchanged. Check out the matching `64k/syllabs`
files and run `APPEND=1 npm run build-syllables -- /path/to/audio-cmn` to add a second human voice.

**Extra voices.** `npm run build-voices` (needs `pip install edge-tts` and `ffmpeg`) has five Microsoft Edge neural
voices say every bank word, keeps only clips that pass the same pitch check, and stores them as extra recordings
(`alts`) of the existing words, so ids and progress don't change. Currently 392 of the 696
words have at least one synthetic voice; the latest 192 additions use human recordings. Each word is played by a random enabled voice. Experiments
(in Ear, or inside Drill settings) enables synthetic voices by syllable count and lets you switch individual
synthetic speakers off. These choices are shared by Drills and Ear and apply to the next question.
Excluding a recording only affects that word and speaker, across both modes; switching categories or
speakers off and back on never clears exclusions. Clearing browser site data does clear these preferences.

The script picks common HSK words per tone combination (mixing sonorant-only
words like 妈妈/名人 with words containing stops and fricatives), runs every clip
through the app's own pitch analysis, and drops clips whose contour contradicts
the expected tones (catching wrong polyphone readings and missing neutral tones).

## How the analysis works

| Step | Where |
|---|---|
| YIN pitch tracking at 16 kHz / 10 ms (FFT fixed-window difference), octave-error repair, creaky-voice detection | `src/analysis/pitch.ts`, `src/analysis/yinDifference.ts` |
| Hz → semitones → Chao 1–5 using a speaker range (5th–95th percentile) | `src/analysis/normalize.ts` |
| Syllable segmentation with a known syllable count (gaps, energy dips, pitch breaks) | `src/analysis/segment.ts` |
| Per-syllable height/shape scoring, notes | `src/analysis/score.ts` |
| Template tone recognition (hint only) | `src/analysis/tones.ts` |
| Whole-line DTW comparison for shadowing | `src/analysis/shadow.ts` |
| Ear training: adaptive item choice, clip splitting and timing | `src/ear/` |
| Lexical/surface tones, sandhi | `src/g2p/tones.ts` |

To compare the FFT YIN analyzer with the original direct implementation on the
recorded bank, run `npx tsx scripts/check-pitch.ts 100` (requires `ffmpeg`). This
checks pitch and voicing frame by frame and times analysis separately from decoding.
Omit the number to check the entire bank, including alternate voices.

Creaky voice — common at the bottom of T3 and T4 — has no measurable pitch, so
loud unpitched frames right after voicing are treated as creak and drawn as a
ramp down to Chao 1 rather than as silence.

## Capture your own tone exercises

Open **Snippets** to turn a short Mandarin recording into exercises:

1. Record with the microphone, import a browser-playable audio/video file (including a phone
   screen recording), or choose **Anki**, connect to Anki desktop, pick a deck/search and import
   one of its audio tracks. Clips can be up to 30 seconds. The Anki picker lists every
   `[sound:…]` attachment, including multiple tracks per card, with optional audio/transcript
   field selection. It reads at most 500 matching notes; narrow the search for larger decks.
2. Quiet edges are trimmed and long silent pauses shortened. A multilingual Whisper tiny model
   transcribes Mandarin in a Web Worker on your device. First use downloads model files from
   Hugging Face (and caches them where the browser supports it); audio is not uploaded. Anki
   imports use the card's Chinese text when available. Check it against the selected recording,
   or use **Recognize again from audio**. You can always enter/correct the transcript manually.
3. Tap the first and last Chinese character of a span of 1–3 syllables. Preview the cut, adjust
   its start/end, and check the pinyin and spoken tones. Timing is estimated from sentence
   timestamps and pitch/energy, not forced alignment. Tone sandhi is kept from the full sentence;
   correct polyphones or spoken-tone labels before saving when needed.
4. **Save to tone exercises** adds a standalone WAV clip and pitch reference to your bank.
   **Practice** opens it in Drills; **My snippets** in Drills or Ear → Words limits practice to
   saved clips. Save several spans from the same sentence without recording it again.

Clips are stored in IndexedDB on the current browser/device, survive reloads, and can be deleted
from the snippet bank. They do not sync across devices; clearing site data deletes them.
Automatic trimming removes quiet sections, not background music or overlapping speakers.
Recognition quality and speed depend on the recording and device; text and timings remain editable.

Mobile browsers cannot reliably capture another app's internal audio directly. Use your phone's
screen recorder with device audio enabled and import the resulting file (capture may be restricted
by the source app). AnkiConnect import needs Anki desktop and its add-on on the same computer;
importing from Anki mobile directly is not supported.
