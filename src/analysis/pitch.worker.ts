import { trackPitch } from './pitch'

self.onmessage = (e: MessageEvent<Float32Array>) => {
  const t = trackPitch(e.data)
  ;(self as unknown as Worker).postMessage(t, [t.hz.buffer, t.rms.buffer, t.zcr.buffer, t.creak.buffer])
}
