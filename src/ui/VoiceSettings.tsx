import { useState } from 'react'
import type { Manifest } from '../bank/types'
import { setTtsEnabled, setVoiceOn, ttsEnabled, voiceOn } from '../bank/voices'
import { Toggle } from './Toggle'

/** Voice choices shared by Drills and Ear: synthetic voices on/off, plus each voice on its own. */
export function VoiceSettings({ manifest, onChange }: { manifest: Manifest; onChange?: () => void }) {
  const [, redraw] = useState(0)
  const speakers = Object.entries(manifest.speakers)
  const human = speakers.filter(([, s]) => !s.tts)
  const tts = speakers.filter(([, s]) => s.tts)
  const changed = () => {
    redraw((x) => x + 1)
    onChange?.()
  }
  if (speakers.length < 2) return null
  const voice = ([id, s]: (typeof speakers)[number], disabled = false) => (
    <label key={id} className={`toggle voice${disabled ? ' muted' : ''}`}>
      <input type="checkbox" checked={voiceOn(id)} disabled={disabled} onChange={(e) => { setVoiceOn(id, e.target.checked); changed() }} />
      <span>{s.short ?? s.name}</span>
    </label>
  )
  return (
    <div className="voice-settings">
      <p className="muted small">Voices — each word is played by a random voice that has recorded it.</p>
      {human.map((v) => voice(v))}
      {tts.length > 0 && (
        <>
          <Toggle label="Synthetic voices (text-to-speech)" value={ttsEnabled()} onChange={(v) => { setTtsEnabled(v); changed() }} />
          <div className="voice-list">{tts.map((v) => voice(v, !ttsEnabled()))}</div>
        </>
      )}
    </div>
  )
}
