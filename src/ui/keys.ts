/**
 * True when a key press belongs to a form control (typing in a text field, moving a slider, ticking a
 * checkbox, opening a <details>), so page-wide shortcuts must leave it alone.
 */
export function inField(e: KeyboardEvent): boolean {
  const el = e.target
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'SUMMARY'].includes(el.tagName)
}
