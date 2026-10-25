import { useSyncExternalStore } from 'react'

/** Hash routing (`#/ear/video`): works on static hosting such as GitHub Pages and survives reloads. */
const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)

let cached = { raw: location.hash, segs: parse() }

function snapshot() {
  if (cached.raw !== location.hash) cached = { raw: location.hash, segs: parse() }
  return cached.segs
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

/** Current route segments, e.g. `['ear', 'video']`. */
export const useRoute = () => useSyncExternalStore(subscribe, snapshot)

export function navigate(...segments: string[]) {
  location.hash = `/${segments.join('/')}`
}
