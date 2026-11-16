import { SR } from '../analysis/pitch'
import { wavBlob } from './wav'

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

/** 16-bit PCM WAV blob URL for 16 kHz mono samples. Revoke it (URL.revokeObjectURL) when it is no longer played. */
export const wavUrl = (samples: Float32Array): string => URL.createObjectURL(wavBlob(samples, SR))

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
