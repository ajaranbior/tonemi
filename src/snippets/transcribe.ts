export interface Transcript {
  text: string
  chunks?: { text: string; timestamp: [number, number | null] }[]
}

/** One cancellable worker per editor; terminating it also cancels model download/inference. */
export function transcribe(samples: Float32Array, onProgress: (message: string) => void, signal: AbortSignal): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' })
    const clean = () => { worker.terminate(); signal.removeEventListener('abort', cancel) }
    const cancel = () => { clean(); reject(new DOMException('Recognition cancelled', 'AbortError')) }
    if (signal.aborted) { cancel(); return }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = ({ data }) => {
      if (data.status === 'progress') onProgress(data.message)
      else if (data.status === 'done') { clean(); resolve(data.result) }
      else { clean(); reject(new Error(data.message)) }
    }
    worker.onerror = (event) => { clean(); reject(new Error(event.message || 'Speech recognition could not start on this browser.')) }
    worker.postMessage(samples)
  })
}
