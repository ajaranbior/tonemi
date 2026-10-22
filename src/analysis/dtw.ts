export interface DtwResult {
  /** Matched index pairs [i in a, j in b]. */
  path: [number, number][]
  /** Mean absolute difference along the path. */
  meanAbs: number
}

/** Classic DTW with absolute-difference cost and a Sakoe–Chiba band. */
export function dtw(a: number[], b: number[], bandFraction = 0.35): DtwResult {
  const n = a.length
  const m = b.length
  const band = Math.max(Math.abs(n - m) + 2, Math.ceil(Math.max(n, m) * bandFraction))
  const INF = Number.POSITIVE_INFINITY
  const cost = new Float64Array((n + 1) * (m + 1)).fill(INF)
  const at = (i: number, j: number) => i * (m + 1) + j
  cost[0] = 0
  for (let i = 1; i <= n; i++) {
    const center = Math.round((i * m) / n)
    for (let j = Math.max(1, center - band); j <= Math.min(m, center + band); j++) {
      const d = Math.abs(a[i - 1] - b[j - 1])
      cost[at(i, j)] = d + Math.min(cost[at(i - 1, j)], cost[at(i, j - 1)], cost[at(i - 1, j - 1)])
    }
  }
  const path: [number, number][] = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1])
    const diag = cost[at(i - 1, j - 1)]
    const up = cost[at(i - 1, j)]
    const left = cost[at(i, j - 1)]
    if (diag <= up && diag <= left) { i--; j-- }
    else if (up < left) i--
    else j--
  }
  path.reverse()
  let sum = 0
  for (const [p, q] of path) sum += Math.abs(a[p] - b[q])
  return { path, meanAbs: path.length ? sum / path.length : NaN }
}
