import { trackPitch, type PitchTrack } from './pitch'

/** Pitch-track a whole file off the main thread (falls back to the main thread). */
export function trackInWorker(samples: Float32Array): Promise<PitchTrack> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./pitch.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<PitchTrack>) => {
      resolve(e.data)
      w.terminate()
    }
    w.onerror = (e) => {
      w.terminate()
      try {
        resolve(trackPitch(samples))
      } catch {
        reject(e)
      }
    }
    w.postMessage(samples)
  })
}
