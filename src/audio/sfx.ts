import { audioContext } from './context'

function note(ctx: AudioContext, freq: number, at: number, len: number, type: OscillatorType, peak: number, to = freq) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, at + len)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + len)
  osc.connect(gain).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + len + 0.02)
}

/** Duration (s) of the feedback sound, so callers can wait before playing speech. */
export const FEEDBACK_SECONDS = 0.4

/** A bright two-note chime for right, a low soft buzz for wrong. Also vibrates on phones. */
export function playFeedback(correct: boolean) {
  try {
    const ctx = audioContext()
    const t = ctx.currentTime + 0.01
    if (correct) {
      note(ctx, 784, t, 0.18, 'triangle', 0.22)
      note(ctx, 1175, t + 0.1, 0.3, 'triangle', 0.22)
    } else {
      note(ctx, 196, t, 0.32, 'sawtooth', 0.12, 130)
      note(ctx, 185, t, 0.32, 'square', 0.05, 123)
    }
    navigator.vibrate?.(correct ? 25 : [70, 50, 70])
  } catch {
    // audio is optional feedback; never break the exercise
  }
}
