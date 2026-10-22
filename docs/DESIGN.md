# tonemi — design proposal

Target user: someone who already knows tone theory (Chao values, 3rd tone is low,
sandhi, coarticulation) and wants to **produce** tones better. The app is about
*production feedback*, not teaching rules.

---

## 1. Core idea

Everything rests on one loop:

```
listen to reference  →  speak  →  see your pitch vs. the reference  →  hear yourself  →  repeat
```

Three exercise modes share that loop and one analysis pipeline:

| Mode | Input | Expected tones come from |
|---|---|---|
| **Tone drills** | 1–3 syllable items | the item (known) |
| **Read-aloud** | any Chinese text | text → pinyin → sandhi rules |
| **Shadowing** | audio/video + subtitles | native recording (contour) + subtitle text (tones) |

## 2. The analysis pipeline (shared by all modes)

1. **Capture** — Web Audio API + `AudioWorklet`, 16 kHz mono.
2. **F0 (pitch) tracking**
   - Live, in browser: McLeod/YIN (`pitchy` npm) — cheap, good enough for the live trace.
   - Accurate, for scoring: Praat via `parselmouth` (server) or CREPE (`torchcrepe` server /
     ONNX in browser later). Octave-jump cleanup + median smoothing either way.
3. **Speaker normalisation** — convert Hz → semitones relative to a *calibrated* floor.
   A 30-second calibration (glide lowest→highest, read a neutral sentence) gives the
   speaker's range, which is mapped onto Chao levels 1–5. References get the same
   treatment with their own speaker's range, so male/female/robot are comparable.
4. **Syllable segmentation**
   - Drills: number of syllables is known → split on voicing/energy, constrained to *N* segments.
   - Read-aloud / shadowing: text is known → **forced alignment** (Montreal Forced Aligner
     Mandarin model, or a CTC model such as wav2vec2-XLSR-zh + `torchaudio.functional.forced_align`).
     Prefer forced alignment over Whisper timestamps, which are too loose per character.
5. **Contour features per syllable** — resample voiced part to ~20 points; keep
   mean height (in Chao units), slope, min position, range, duration.
6. **Scoring** (see §4) and **tone recognition** (see §5).

**Normalise per utterance, not per syllable.** Relative height between syllables is
the whole point of things like 2+1 vs 2+2 or the half-3rd before 1/2/4. Per-syllable
normalisation would hide exactly the errors you care about.

## 3. Modes in detail

### 3.1 Tone drills

- **Item bank built on real words**, not nonsense syllables: for every disyllabic combo
  (4 tones × 5 incl. neutral = **20 combos**) and a set of trisyllabic patterns, pick
  common words (e.g. 飞机 1-1, 中国 1-2, 你好 3-3 → 2-3, 东西 1-0 …). Monosyllables for
  isolation warm-up only.
- **Exercise variants**
  - *Echo*: hear → repeat → overlay.
  - *Hum-back*: hum the melody without segments (isolates pitch from articulation —
    very effective).
  - *Slow*: reference time-stretched (pitch preserved, WSOLA) to 0.6×.
  - *Carrier sentence*: say the word inside 我说___给你听, because tones in isolation are
    not tones in speech.
  - *Minimal-contrast sets*: drill 2-1 / 2-2 / 2-3 / 2-4 back-to-back so you feel how the
    second tone changes the first.
- **Tone-pair matrix**: a 4×5 heatmap of your accuracy per combo; a simple spaced-
  repetition scheduler picks the weakest combos more often.

**Reference audio options** (in order of preference):

| Source | Quality | Notes |
|---|---|---|
| Your own curated native recordings | best | a tutor/friend recording ~100 words covers all combos |
| Forvo API | native, variable | paid API; per-word coverage good for common words; check caching terms |
| Neural TTS (Azure / Google zh-CN voices) | very natural now | pre-generate & cache; SSML phoneme tags to force the right reading; verify each item's contour once |
| Tone Perfect (MSU) | native, clean | **monosyllables only**, 6 speakers, non-commercial licence — good for isolation warm-ups |

Practical plan: TTS for breadth, cached and spot-checked by the analysis pipeline
itself (if a TTS item's contour doesn't match its expected tones, flag it), plus
your own native recordings where TTS is weak.

### 3.2 Read-aloud

1. Paste text (or pick a passage).
2. Text → pinyin with polyphone handling (`pypinyin`, or `g2pW` for better polyphones),
   then apply sandhi: 3-3, 一, 不, and neutral-tone words. Show *expected surface tones*,
   letting you toggle "show / hide" so you're reading characters, not pinyin.
3. Record → forced alignment → per-syllable recognised tone vs expected.
4. Output: per-syllable colour (ok / borderline / wrong), sentence contour plot, and
   notes like "3rd tones before non-3rd not low enough (avg Chao 2.6, target ≤ 2)" or
   "2nd tone rises start too high in 2+4".

### 3.3 Shadowing

- **Input**: audio/video file + `.srt`/`.vtt`. If no subs, transcribe with Whisper
  (or FunASR/Paraformer, which is strong on Mandarin) and let you correct them.
- **YouTube**: the browser can't pull audio or captions from an embedded player
  (CORS + ToS). For personal use, a tiny backend with `yt-dlp` can fetch audio and
  manual/auto subtitles. Keep it optional and local.
- **Flow per subtitle line**: loop line → *listen*, *shadow simultaneously*, or
  *echo after*. Both tracks are aligned (forced alignment on the same text, then DTW
  inside each syllable) and their normalised contours compared.
- Line scrubber with per-line scores; "drill my worst lines" button.

## 4. Scoring

Per syllable, against either a reference contour or a tone template:

- **Shape** — distance between mean-removed contours (after DTW/resampling).
- **Register** — mean height in Chao units vs target (this is where 3rd-tone-too-high
  and "everything compressed into a narrow range" show up).
- **Relations** — for multi-syllable items, the height difference between neighbours
  vs the reference (catches 2+1 where the 1 isn't above the end of the 2).
- **Range usage** — your utterance range vs the reference's; flattened range is a
  very common intermediate-learner problem.

Combine into 0–100 but always show the components; the components are the feedback.

## 5. Tone recognition

- **v1: template/rule-based** on normalised features (height, slope, min position,
  with context-specific templates per combo). Transparent, no training data needed,
  and good enough to label "you produced something like a 2" for clear cases.
- **v2: small classifier** (1D CNN/GRU over the contour + context) trained on
  AISHELL-style corpora with forced-aligned tone labels. Train *with left/right context*
  so a coarticulated 2 in 2+4 isn't judged against an isolated 2.
- Always show confidence; ambiguous → "unclear" rather than a wrong label.

## 6. Visualisation

- Live pitch trace in semitones over time on a **Chao 1–5 band background** calibrated
  to your range.
- Reference contour (ghost line) + yours, aligned per syllable, with syllable
  boundaries, expected and recognised tone labels.
- Click a syllable → replays just that syllable for both voices.
- Optional "target lane" mode: draws the expected contour ahead of time while you speak
  (karaoke-style).
- Progress: tone-pair heatmap, score trends per mode.

## 7. Architecture

```
web (TypeScript, React + Vite, PWA)
 ├─ audio/      capture, AudioWorklet, live F0 (pitchy), playback & time-stretch
 ├─ analysis/   normalisation, segmentation (drills), features, template scoring
 ├─ viz/        canvas pitch plot
 └─ storage     IndexedDB (recordings, progress) — local-first

api (Python, FastAPI) — optional, for heavy lifting
 ├─ /f0         parselmouth / torchcrepe accurate F0
 ├─ /align      forced alignment (MFA or wav2vec2 CTC)
 ├─ /g2p        pypinyin + sandhi
 ├─ /tts        Azure/Google TTS with cache
 ├─ /transcribe Whisper / FunASR
 └─ /fetch      yt-dlp (personal use)
```

- Keep `analysis/` pure TS with no DOM dependency so it can move into a mobile app
  unchanged.
- **Mobile later**: the cheapest path is wrapping the PWA with **Capacitor** (same code,
  native mic permission). React Native/Expo is possible but real-time audio DSP there
  is more work. If DSP becomes a bottleneck, port `analysis/` to Rust → WASM (web) +
  native libs (mobile).

## 8. Roadmap

| Phase | Deliverable | Why first |
|---|---|---|
| **0** | Calibration + live pitch visualiser + record/playback with overlay of a loaded reference | Already useful on its own; validates the F0 pipeline |
| **1** | Tone drills: item bank (20 combos), cached TTS references, segmentation by *N*, template scoring, tone-pair heatmap | Core of the app; no ASR needed |
| **2** | Read-aloud: g2p + sandhi, forced alignment backend, per-syllable report | Adds the backend |
| **3** | Shadowing: file + subs, line looping, alignment-based comparison; yt-dlp import | Reuses phase 2 alignment |
| **4** | Learned tone classifier with context, SRS, mobile wrapper | Once there is data and usage |

## 9. Open questions

- Which reference voice(s) — TTS vendor, and do you have access to a native speaker
  to record ~100 items?
- Local-only (runs on your machine with a Python backend) vs hosted?
- Mainland vs Taiwan standard (affects neutral tone frequency and some readings)?
