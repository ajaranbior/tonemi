import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

env.allowLocalModels = false
// GitHub Pages has no cross-origin isolation. A single WASM thread works there and on phones.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1
let model: Promise<AutomaticSpeechRecognitionPipeline> | null = null

self.onmessage = async (event: MessageEvent<Float32Array>) => {
  try {
    model ??= pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      dtype: 'q8', device: 'wasm',
      progress_callback: (p) => {
        if (p.status === 'progress') self.postMessage({ status: 'progress', message: `Downloading speech model · ${Math.round(p.progress)}% of ${p.file}` })
      },
    }).catch((e) => { model = null; throw e })
    const transcriber = await model
    self.postMessage({ status: 'progress', message: 'Recognizing Mandarin on this device…' })
    const result = await transcriber(event.data, { language: 'chinese', task: 'transcribe', return_timestamps: true, chunk_length_s: 30 })
    self.postMessage({ status: 'done', result })
  } catch (e) {
    self.postMessage({ status: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
