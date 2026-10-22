# tonemi — design proposal

> **Status (MVP built):** browser-only app with calibration, tone drills on a
> 466-clip native word bank (audio-cmn), and shadowing with your own media +
> subtitles scored by whole-line DTW. Deviations from the plan below: pitch is
> tracked with a custom YIN (pitchy picked formants on real speech), creaky
> voice is modelled explicitly, and per-syllable alignment for read-aloud /
> shadowing is deferred.

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

- **Item bank built on real words**, not nonsense syllables: every disyllabic combo
  (4 tones × 5 incl. neutral = **20 combos**) and the trisyllabic patterns
  (4 × 4 × 5 = 80, most common first), e.g. 飞机 1-1, 中国 1-2, 你好 3-3 → 2-3, 东西 1-0.
  Monosyllables for isolation warm-up only.
- **Many different words per combo** (target 10–20 each), so you learn the pitch
  pattern rather than memorising a word's melody. Items are tagged by phonetic
  makeup and served in stages:
  1. *Sonorant-heavy* first (m/n/l/r/w/y initials, e.g. 妈妈, 毛衣, 名人) — voicing is
     continuous across the boundary, so the pitch line is unbroken and the
     transition between the two tones is fully visible.
  2. Then *mixed*, including aspirated/fricative initials (e.g. 吃饭, 出租, 喝茶), where
     the voicing gap makes it harder to hold the target.
  3. Shuffled within a combo, never the same word twice in a row.
- **Trisyllabic 3-3-3 by structure**: 展览馆 ([2-2]-3) vs 小老虎 (3-[2-3]) — same
  tones, different sandhi because of word structure.
- The bank is generated: a script takes a frequency-ranked word list (HSK) + pinyin,
  computes surface tones with sandhi, buckets by combo and phonetic tags, and
  intersects with available audio (§3.1.1).
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

#### 3.1.1 Reference audio — free sources only (Mainland Putonghua)

| Source | What | Licence | Use |
|---|---|---|---|
| [audio-cmn](https://github.com/hugolpz/audio-cmn) (built on Shtooka recordings) | native speakers: ~5.6k HSK words + all ~1,700 toned syllables | CC BY-SA (check repo) | **primary source for word drills** |
| Tone Perfect (Michigan State) | 410 syllables × 4 tones × 6 native speakers | non-commercial | isolated-tone warm-ups, several voices |
| Wikimedia Commons / Lingua Libre | native word recordings, mixed coverage | CC BY-SA | gap filling |
| Mozilla Common Voice zh-CN | native read sentences, many speakers | CC0 | read-aloud references, future classifier training |
| Azure neural TTS, free tier | ~0.5 M chars/month — the whole word bank is a few thousand | free tier | fill gaps, extra voices (male/female), sentences |
| `edge-tts` (Python) | same Microsoft neural voices, no key | unofficial endpoint | quick offline generation for personal use |
| Browser `speechSynthesis` | OS-dependent quality | — | **no**: its audio can't be captured, so no pitch overlay |

Plan: a one-off build script assembles the item bank from audio-cmn first, then
generates TTS clips for any gaps. Every clip goes through our own pitch analysis,
and clips whose contour doesn't match the expected tones are flagged and dropped.
Output: static Opus files (~10–20 KB each, a few thousand → tens of MB) shipped
with the app, so there is no runtime TTS dependency.

Forvo is skipped (paid API).

### 3.2 Read-aloud

1. Paste text (or pick a passage).
2. Text → pinyin with polyphone handling (`pinyin-pro` in the browser; `pypinyin` /
   `g2pW` in the local helper), then apply Mainland sandhi: 3-3 (by prosodic
   grouping), 一, 不, and neutral-tone words per 现代汉语词典 conventions. Show *expected surface tones*,
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

## 7. Architecture — static-first, optional local helper

Decisions: **Mainland Putonghua**, runs locally / on GitHub Pages, free resources only.

```
web (TypeScript, React + Vite, PWA)  — deployable to GitHub Pages, no server
 ├─ audio/      capture, AudioWorklet, live F0 (pitchy), playback & time-stretch
 ├─ analysis/   normalisation, segmentation (drills), features, template scoring
 ├─ g2p/        pinyin-pro + Mainland sandhi rules
 ├─ viz/        canvas pitch plot
 ├─ public/audio/  pre-built item bank (Opus) + manifest.json
 └─ storage     IndexedDB (recordings, progress) — local-first, nothing leaves the device

helper (Python, FastAPI) — optional, runs on localhost; the web app detects it
 ├─ /align      forced alignment (wav2vec2 CTC via torchaudio)
 ├─ /transcribe faster-whisper / FunASR when a video has no subtitles
 ├─ /tts        edge-tts / Azure free tier for arbitrary read-aloud text
 └─ /fetch      yt-dlp audio + subtitles (personal use)

scripts/ (Python, run once) — builds the item bank from audio-cmn + TTS gap filling
```

### What runs where, and how heavy it is

| Feature | GitHub Pages only | Cost |
|---|---|---|
| Live pitch trace, calibration, record/playback | ✅ | tiny: YIN/McLeod on 16 kHz frames is <1 % CPU |
| Tone drills + scoring + heatmap | ✅ | tiny; item bank is static files (tens of MB, cached by the service worker) |
| Read-aloud: expected tones (g2p + sandhi) | ✅ | `pinyin-pro` is a few hundred KB |
| Read-aloud / shadowing: syllable alignment | ⚠️ possible in-browser (CTC model via onnxruntime-web, ~100 MB one-off download, a few seconds per sentence) | better done by the helper |
| Shadowing with your own file + `.srt`/`.vtt` | ✅ (browser decodes mp3/m4a/webm/mp4 audio) | needs alignment as above |
| Auto-transcribe a video with no subs | ⚠️ whisper-base in browser is slow | helper: faster-whisper `small` on CPU runs around real time on a laptop |
| YouTube link import | ❌ (CORS/ToS) | helper with yt-dlp — or run yt-dlp yourself and drop the file in |
| Reference audio for arbitrary read-aloud text | ❌ (no free browser TTS we can analyse) | helper: edge-tts |

The helper's main cost is the Python install (torch ≈ 1–2 GB on disk); RAM use
stays at a few GB at most. No GPU needed.

- Keep `analysis/` pure TS with no DOM dependency so it can move into a mobile app
  unchanged.
- **Mobile later**: the cheapest path is wrapping the PWA with **Capacitor** (same code,
  native mic permission). React Native/Expo is possible but real-time audio DSP there
  is more work. If DSP becomes a bottleneck, port `analysis/` to Rust → WASM (web) +
  native libs (mobile).

## 8. Roadmap

| Phase | Deliverable | Needs helper? |
|---|---|---|
| **0** | Calibration + live pitch visualiser + record/playback with overlay of a loaded reference | no |
| **1** | Tone drills: item bank builder (audio-cmn + TTS gaps, many words per combo), segmentation by *N*, template scoring, tone-pair heatmap | no |
| **2** | Read-aloud: g2p + sandhi in browser, alignment, per-syllable report | yes (in-browser alignment later) |
| **3** | Shadowing: file + subs, line looping, alignment-based comparison; yt-dlp import | yes |
| **4** | Learned tone classifier with context, SRS, mobile wrapper | — |

## 9. Open questions

- Licence of audio-cmn content (CC BY-SA) means the published item bank must keep
  attribution and share-alike — fine for a personal/open-source app.
- Front-end framework: React assumed; Svelte would be lighter if preferred.
