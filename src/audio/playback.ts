import { SR } from '../analysis/pitch'

let current: HTMLAudioElement | null = null

/**
 * Play a URL; resolves when playback ends. Other rates keep the pitch unless `keepPitch` is false
 * (then pitch moves with speed, like a tape).
 * `onTime` gets the playback position (s) every frame, then NaN when finished.
 */
export function playUrl(url: string, rate = 1, onTime?: (t: number) => void, keepPitch = true): Promise<void> {
  stopPlayback()
  const el = new Audio(url)
  el.playbackRate = rate
  el.preservesPitch = keepPitch
  current = el
  return new Promise((resolve, reject) => {
    let raf = 0
    const stop = () => {
      cancelAnimationFrame(raf)
      onTime?.(NaN)
    }
    const tick = () => {
      onTime?.(el.currentTime)
      raf = requestAnimationFrame(tick)
    }
    el.onended = () => { stop(); resolve() }
    el.onpause = () => { stop(); resolve() }
    el.onerror = () => { stop(); reject(new Error(`Could not play ${url}`)) }
    el.play().then(() => onTime && (raf = requestAnimationFrame(tick)), (e) => { stop(); reject(e) })
  })
}

export function stopPlayback() {
  if (current) {
    current.pause()
    current = null
  }
}

/** 16-bit PCM WAV blob URL for 16 kHz mono samples. */
export function wavUrl(samples: Float32Array): string {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, SR, true)
  v.setUint32(28, SR * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

/**
 * Play URLs one after another with `gap` seconds between. `onStep` gets the index being played, then
 * -1 at the end. Stops early (resolving false) when `alive()` turns false, e.g. the learner moved on.
 */
export async function playSequence(urls: string[], alive: () => boolean, onStep?: (i: number) => void, gap = 0.35): Promise<boolean> {
  for (let i = 0; i < urls.length; i++) {
    if (!alive()) return false
    onStep?.(i)
    try {
      await playUrl(urls[i])
    } catch {
      // skip a clip that fails to play
    }
    if (i < urls.length - 1) await new Promise((r) => setTimeout(r, gap * 1000))
  }
  const done = alive()
  if (done) onStep?.(-1)
  return done
}
