import { useEffect, useState } from 'react'
import { samplesFor } from '../audio/scrub'

/** 16 kHz samples of a URL (cached), or null while loading / on failure. */
export function useSamples(url: string | null): Float32Array | null {
  const [got, setGot] = useState<{ url: string; samples: Float32Array } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    samplesFor(url).then(
      (samples) => live && setGot({ url, samples }),
      () => {},
    )
    return () => {
      live = false
    }
  }, [url])
  return got && got.url === url ? got.samples : null
}
