export function micError(e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError') return 'Microphone access was blocked. Allow it in the browser settings and try again.'
  if (name === 'NotFoundError') return 'No microphone found.'
  if (!window.isSecureContext) return 'The microphone needs HTTPS (or localhost).'
  return `Recording failed: ${String(e)}`
}
