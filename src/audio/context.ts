let ctx: AudioContext | null = null

/** Shared AudioContext. Call from a tap/click handler the first time (iOS requirement). */
export function audioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}
