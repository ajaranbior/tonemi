import { useEffect, useRef } from 'react'
import { GLYPH_POINTS } from './toneShapes'

export interface PlotLine {
  t: ArrayLike<number>
  /** Chao values; NaN breaks the line. */
  v: ArrayLike<number>
  kind: 'ref' | 'user' | 'live'
}

export interface PlotLabel {
  /** Centre time, seconds. */
  t: number
  text: string
  tone?: number
  /** Second line under the main label (e.g. recognised tone). */
  sub?: string
  ok?: boolean
  /** Draws this tone's icon after the second line (e.g. what the learner picked). */
  subTone?: number
  /** Time range [start, end] of the syllable; shaded green/red when `ok` is set. */
  span?: [number, number]
}

interface Props {
  lines: PlotLine[]
  duration: number
  boundaries?: number[]
  labels?: PlotLabel[]
  /** Moving playhead, seconds. */
  cursor?: number
  height?: number
}

const Y_MIN = 0.3
const Y_MAX = 5.7

/** Chao-scale pitch plot (1 = bottom of your range, 5 = top). */
export function PitchPlot({ lines, duration, boundaries = [], labels = [], cursor, height = 220 }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 0, h: 0 })

  useEffect(() => {
    const el = canvas.current!
    const draw = () => paint(el, size.current, { lines, duration, boundaries, labels, cursor })
    const ro = new ResizeObserver(([entry]) => {
      size.current = { w: entry.contentRect.width, h: entry.contentRect.height }
      draw()
    })
    ro.observe(el)
    draw()
    return () => ro.disconnect()
  }, [lines, duration, boundaries, labels, cursor])

  return <canvas ref={canvas} className="pitch-plot" style={{ height }} role="img" aria-label="Pitch contour" />
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function paint(
  el: HTMLCanvasElement,
  { w, h }: { w: number; h: number },
  { lines, duration, boundaries, labels, cursor }: Omit<Props, 'height'> & { boundaries: number[]; labels: PlotLabel[] },
) {
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  el.width = Math.round(w * dpr)
  el.height = Math.round(h * dpr)
  const g = el.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  const left = 22
  const top = labels.length ? 52 : 6
  const bottom = 6
  const plotH = h - top - bottom
  const x = (t: number) => left + (t / Math.max(duration, 0.1)) * (w - left - 6)
  const y = (v: number) => top + ((Y_MAX - v) / (Y_MAX - Y_MIN)) * plotH

  // Chao bands
  g.font = '11px system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  for (let level = 1; level <= 5; level++) {
    g.fillStyle = level % 2 ? css('--band-a') : css('--band-b')
    g.fillRect(left, y(level + 0.5), w - left, y(level - 0.5) - y(level + 0.5))
    g.fillStyle = css('--muted')
    g.fillText(String(level), left / 2, y(level))
  }

  // Right/wrong shading behind each answered syllable.
  for (const l of labels) {
    if (l.ok === undefined || !l.span) continue
    g.globalAlpha = 0.16
    g.fillStyle = l.ok ? css('--good') : css('--bad')
    g.fillRect(x(l.span[0]), top, x(l.span[1]) - x(l.span[0]), h - top - bottom)
    g.globalAlpha = 1
  }

  g.strokeStyle = css('--grid')
  g.lineWidth = 1
  g.setLineDash([3, 3])
  for (const b of boundaries) {
    g.beginPath()
    g.moveTo(x(b), top)
    g.lineTo(x(b), h - bottom)
    g.stroke()
  }
  g.setLineDash([])

  for (const line of lines) {
    const color = line.kind === 'ref' ? css('--ref') : css('--user')
    g.strokeStyle = color
    g.lineWidth = line.kind === 'ref' ? 5 : 3
    g.globalAlpha = line.kind === 'ref' ? 0.45 : 1
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    let pen = false
    let lastT = -1
    for (let i = 0; i < line.t.length; i++) {
      const v = line.v[i]
      const t = line.t[i]
      // Break across NaN and across gaps longer than 50 ms.
      if (Number.isNaN(v) || (pen && t - lastT > 0.05)) {
        pen = false
        if (Number.isNaN(v)) continue
      }
      const py = y(Math.max(Y_MIN, Math.min(Y_MAX, v)))
      if (pen) g.lineTo(x(t), py)
      else g.moveTo(x(t), py)
      pen = true
      lastT = t
    }
    g.stroke()
    g.globalAlpha = 1
  }

  if (cursor !== undefined) {
    g.strokeStyle = css('--accent')
    g.lineWidth = 1.5
    g.beginPath()
    g.moveTo(x(cursor), top)
    g.lineTo(x(cursor), h - bottom)
    g.stroke()
  }

  g.textBaseline = 'alphabetic'
  for (const l of labels) {
    g.font = '600 18px system-ui, sans-serif'
    g.fillStyle = l.tone !== undefined ? css(`--t${l.tone}`) : css('--fg')
    g.fillText(l.text, x(l.t), 20)
    if (l.sub) {
      if (l.ok === undefined) {
        g.font = '12px system-ui, sans-serif'
        g.fillStyle = css('--muted')
      } else {
        g.font = '700 17px system-ui, sans-serif'
        g.fillStyle = l.ok ? css('--good') : css('--bad')
      }
      if (l.subTone === undefined) g.fillText(l.sub, x(l.t), 43)
      else {
        // text + icon, centred together
        const scale = 1.2
        const gw = 24 * scale
        const tw = g.measureText(l.sub).width
        const x0 = x(l.t) - (tw + 6 + gw) / 2
        g.textAlign = 'left'
        g.fillText(l.sub, x0, 43)
        g.textAlign = 'center'
        drawGlyph(g, l.subTone, x0 + tw + 6, 43 - 16, l.ok === false ? css('--bad') : css('--fg'), scale)
      }
    }
  }
}

/** Tone icon in a 24×16 box at (x, y). */
function drawGlyph(g: CanvasRenderingContext2D, tone: number, x: number, y: number, color: string, scale = 1) {
  g.save()
  g.translate(x, y)
  g.scale(scale, scale)
  g.strokeStyle = color
  g.fillStyle = color
  g.lineWidth = 2.6
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (tone === 0) {
    g.beginPath()
    g.arc(12, 12, 2.4, 0, Math.PI * 2)
    g.fill()
  } else {
    g.beginPath()
    GLYPH_POINTS[tone as 1 | 2 | 3 | 4].forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)))
    g.stroke()
  }
  g.restore()
}
