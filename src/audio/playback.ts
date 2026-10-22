import { SR } from '../analysis/pitch'

let current: HTMLAudioElement | null = null

/** Play a URL; resolves when playback ends. Slow rates keep the pitch. */
export function playUrl(url: string, rate = 1): Promise<void> {
  stopPlayback()
  const el = new Audio(url)
  el.playbackRate = rate
  el.preservesPitch = true
  current = el
  return new Promise((resolve, reject) => {
    el.onended = () => resolve()
    el.onpause = () => resolve()
    el.onerror = () => reject(new Error(`Could not play ${url}`))
    el.play().catch(reject)
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
