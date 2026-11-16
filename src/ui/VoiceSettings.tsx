import { useEffect, useState } from 'react'
import { loadManifest } from '../bank/load'
import type { Manifest } from '../bank/types'
import { recordingExcluded, recordings, setRecordingExcluded, setTtsKindEnabled, setVoiceOn, ttsEnabled, useVoiceVersion, voiceLabel, voiceOn } from '../bank/voices'
import { Toggle } from './Toggle'

/** Human voice choices shared by Drills and Ear. */
export function VoiceSettings({ manifest, experiments = false }: { manifest: Manifest; experiments?: boolean }) {
  useVoiceVersion()
  const speakers = Object.entries(manifest.speakers)
  const human = speakers.filter(([, s]) => !s.tts)
  if (speakers.length < 2) return null
  return (
    <div className="voice-settings">
      <p className="muted small">Human recordings — each word is played by a random enabled speaker who recorded it.</p>
      {human.map(([id, s]) => <Toggle key={id} label={s.short ?? s.name} value={voiceOn(id)} onChange={(on) => setVoiceOn(id, on)} />)}
      <ExcludedRecordings manifest={manifest} />
      {experiments ? <details className="experiments">
        <summary>🧪 Experiments</summary>
        <SyntheticVoiceSettings manifest={manifest} />
      </details> : <p className="muted small">Synthetic voices are optional in Experiments below.</p>}
    </div>
  )
}

function ExcludedRecordings({ manifest }: { manifest: Manifest }) {
  const excluded = manifest.items.flatMap((item) => recordings(item).filter((r) => recordingExcluded(item.id, r.speaker)).map((r) => ({ item, recording: r })))
  if (!excluded.length) return null
  return <details>
    <summary>Excluded recordings ({excluded.length})</summary>
    <p className="muted small">Saved in this browser until you restore them or clear site data.</p>
    {excluded.map(({ item, recording }) => <div className="small excluded-recording" key={`${item.id}/${recording.speaker}`}>
      <span>{item.hanzi} · {voiceLabel(manifest, recording.speaker)}</span>{' '}
      <button className="link" onClick={() => setRecordingExcluded(item.id, recording.speaker, false)}>Restore</button>
    </div>)}
  </details>
}

/** Category choices and individual TTS voices, also available in Ear → Experiments. */
export function SyntheticVoiceSettings({ manifest: supplied }: { manifest?: Manifest }) {
  const [loaded, setManifest] = useState<Manifest>()
  const manifest = supplied ?? loaded
  useVoiceVersion()
  useEffect(() => {
    if (supplied) return
    let active = true
    loadManifest().then((m) => { if (active) setManifest(m) }, () => {})
    return () => { active = false }
  }, [supplied])
  const voices = Object.entries(manifest?.speakers ?? {}).filter(([, s]) => s.tts)
  if (!voices.length) return null
  return <div className="voice-settings">
    <p><strong>Synthetic voices (text-to-speech)</strong></p>
    <p className="muted small">Off by default. Mix synthetic voices with human recordings only in the categories you choose. Applies to Drills and Ear from the next question.</p>
    <Toggle label="Single syllables" value={ttsEnabled('single')} onChange={(on) => setTtsKindEnabled('single', on)} />
    <Toggle label="Tone pairs (2 syllables)" value={ttsEnabled('pair')} onChange={(on) => setTtsKindEnabled('pair', on)} />
    <Toggle label="Three-syllable words" value={ttsEnabled('triple')} onChange={(on) => setTtsKindEnabled('triple', on)} />
    <div className="voice-list">{voices.map(([id, s]) => <Toggle key={id} label={s.short ?? s.name} value={voiceOn(id)} onChange={(on) => setVoiceOn(id, on)} />)}</div>
  </div>
}
