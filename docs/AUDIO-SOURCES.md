# Human audio sources

## Included

- **Yue Tan:** full word bank, 696 items, including 256 single-syllable words (64 per tone).
  The latest expansion adds 192 common HSK 1–6 words with distinct syllable sounds within each tone.
  `SINGLE_PER_TONE=64 npm run build-bank -- <clone>` appends words with the normal pitch check,
  preserving existing items, IDs and recordings. Shtooka recordings via
  [audio-cmn](https://github.com/hugolpz/audio-cmn#voices), credited as CC BY-SA upstream.
- **Chen Wang:** audio-cmn's separate `64k/syllabs` collection, credited as CC BY-SA upstream.
  `npm run build-syllables -- <clone>` adds alternate recordings for existing single-syllable items
  by matching pinyin and tone. The current bank has 200/256 clips: 64 tone 1, 63 tone 2, 52 tone 3,
  and 21 tone 4. The latest import adds 147 recordings using `APPEND=1`, preserving the earlier 53
  recordings and the speaker's calibrated range. Others remain covered by Yue Tan. MP3s are copied unchanged; reference pitch is
  measured on those originals. The pitch check is automated; no manual listening review is claimed.

## Further sources checked, 2026-11-16

**Lingua Libre / Wikimedia Commons.** The existing importer supports attributable CC BY, CC BY-SA,
CC0 and public-domain recordings, with a source file page stored per clip. Fixed its search prefix
(`intitle:LL` rather than `intitle:"LL-Q"`, which returned no matches in the checked queries).
Commons returned HTTP 429 during this attempt; the import was stopped and no Commons recordings
were added. Retry later with `LIST=1 CLIPS=/tmp/tonemi-commons-clips npm run build-commons` to inspect
speakers and coverage before importing. Review accents, pronunciation and recording quality by ear;
pitch matching alone does not establish those qualities.

**Michigan State University's Tone Perfect.** Best prospective source for multiple speakers of
isolated syllables: [MSU's catalog](https://libguides.lib.msu.edu/sb.php?subject_id=21781) describes
410 syllables in four tones from six native speakers. The
[project team's account](https://ideah.pubpub.org/pub/hh90jpsu/release/1) describes educational-use
permission and bulk access by request for non-commercial or educational projects. That is not an
unconditional open-data redistribution license. The collection website could not be accessed during
this attempt (403/timeout), so its current terms could not be confirmed. No recordings were imported
and no permission request was sent.

Before adding Tone Perfect, request the collection and explicit permission for public distribution
in this non-commercial app, including static GitHub Pages hosting, public repository copies,
pitch analysis and optional pitch-shifted practice variants. Confirm the attribution and modification
requirements, then import only the allowed uses.

Suggested request text:

> I maintain tonemi, a non-commercial, browser-based Mandarin tone practice app at
> https://ajaranbior.github.io/tonemi/ (source: https://github.com/ajaranbior/tonemi).
> Could you provide bulk access to Tone Perfect and confirm whether we may redistribute selected
> recordings in the public repository and on GitHub Pages? We would credit the project and speakers,
> display pitch contours, and would like to offer optional pitch-shifted practice variants.
> Please let us know the permitted uses, attribution requirements, and whether the transformed
> variants require separate permission. We can omit those variants for this collection if required.
