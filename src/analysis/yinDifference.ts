/**
 * Fixed-window YIN difference: sum_j (x[j] - x[j + lag])², j < window.
 * Keep the same integration window at every lag. An ordinary autocorrelation
 * of the whole frame would shorten the window and change the pitch decisions.
 */
export function createYinDifference(window: number, longestLag: number) {
  let size = 1
  while (size < window + longestLag) size *= 2
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  const cos = new Float64Array(size / 2)
  const sin = new Float64Array(size / 2)
  const reverse = new Uint32Array(size)
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos(2 * Math.PI * i / size)
    sin[i] = Math.sin(2 * Math.PI * i / size)
  }
  for (let i = 1; i < size; i++) reverse[i] = (reverse[i >> 1] >> 1) | (i & 1 ? size / 2 : 0)

  const fft = (inverse: boolean) => {
    for (let i = 0; i < size; i++) {
      const j = reverse[i]
      if (j > i) {
        const r = re[i]; re[i] = re[j]; re[j] = r
        const v = im[i]; im[i] = im[j]; im[j] = v
      }
    }
    for (let width = 2; width <= size; width *= 2) {
      const half = width / 2
      const step = size / width
      for (let base = 0; base < size; base += width) {
        for (let j = 0; j < half; j++) {
          const a = base + j
          const b = a + half
          const c = cos[j * step]
          const s = inverse ? sin[j * step] : -sin[j * step]
          const r = re[b] * c - im[b] * s
          const v = re[b] * s + im[b] * c
          re[b] = re[a] - r
          im[b] = im[a] - v
          re[a] += r
          im[a] += v
        }
      }
    }
  }

  return (x: Float32Array, maxLag: number, out: Float32Array) => {
    // Pack two real signals into one transform: the fixed window and the
    // longer signal containing every shifted window. Padding prevents wrap
    // around for all the positive lags that YIN examines.
    re.fill(0)
    im.fill(0)
    let energy = 0
    for (let j = 0; j < window + maxLag; j++) {
      im[j] = x[j]
      if (j < window) { re[j] = x[j]; energy += x[j] * x[j] }
    }
    fft(false)
    for (let k = 0; k <= size / 2; k++) {
      const mirror = (size - k) % size
      const ar = (re[k] + re[mirror]) / 2
      const ai = (im[k] - im[mirror]) / 2
      const br = (im[k] + im[mirror]) / 2
      const bi = (re[mirror] - re[k]) / 2
      const r = ar * br + ai * bi
      const v = ar * bi - ai * br
      re[k] = re[mirror] = r
      im[k] = v
      im[mirror] = -v
    }
    fft(true)
    let shiftedEnergy = energy
    out[0] = 0
    for (let lag = 1; lag <= maxLag; lag++) {
      shiftedEnergy += x[window + lag - 1] ** 2 - x[lag - 1] ** 2
      // Roundoff at a perfect match can produce a tiny negative difference.
      out[lag] = Math.max(0, energy + shiftedEnergy - 2 * re[lag] / size)
    }
  }
}
