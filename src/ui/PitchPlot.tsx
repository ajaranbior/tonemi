import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { getLoopMs, Scrubber } from '../audio/scrub'
import { GLYPH_POINTS } from './toneShapes'

export interface PlotLine {
  t: ArrayLike<number>
  /** Chao values; NaN breaks the line. */
  v: ArrayLike<number>
  /** 'wrong' (red) marks the tone the learner picked when it was incorrect. */
  kind: 'ref' | 'user' | 'live' | 'wrong'
  /** Draw straight through time gaps (hand-drawn strokes); NaN still breaks the line. */
  joined?: boolean
}

export interface PlotLabel {
  /** Centre time, seconds. */
  t: number
  text: string
  tone?: number
  /** Second line under the main label (e.g. recognised tone). */
  sub?: string
  ok?: boolean
  /** Answer-chart labels: the real tone (icon) and, when wrong, the one the learner picked. */
  target?: number
  pick?: number
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
  /** Pixels, or any CSS height such as '100%'. */
  height?: number | string
  /**
   * The recording behind the chart: hold and drag on the plot to loop the sound at that point.
   * Plot time t is `offset + t` seconds into `samples` (16 kHz). Null while it loads.
   */
  scrub?: { samples: Float32Array | null; offset: number }
  /** Drawing mode: pointer strokes on the plot report points (time s, Chao); `start` begins a stroke. */
  draw?: (pt: { t: number; v: number }, start: boolean) => void
  /** Time range [start, end] (s) of the syllable being asked about: outlined, and shaded until graded. */
  focus?: [number, number]
}

interface Probe {
  t: number
  held: boolean
}

const Y_MIN = 0.3
const Y_MAX = 5.7

/** Chao-scale pitch plot (1 = bottom of your range, 5 = top). */
export function PitchPlot({ lines, duration, boundaries = [], labels = [], cursor, height = 220, scrub, draw, focus }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const size = useRef({ w: 0, h: 0 })
  const [probe, setProbe] = useState<Probe | null>(null)
  type Scene = Parameters<typeof paint>[2]
  const scene = useRef<Scene | null>(null)

  useEffect(() => {
    const el = canvas.current!
    const ro = new ResizeObserver(([entry]) => {
      size.current = { w: entry.contentRect.width, h: entry.contentRect.height }
      if (scene.current) paint(el, size.current, scene.current)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    scene.current = { lines, duration, boundaries, labels, cursor, probe, focus }
    paint(canvas.current!, size.current, scene.current)
  }, [lines, duration, boundaries, labels, cursor, probe, focus])

  const samples = scrub?.samples ?? null
  const scrubber = useMemo(() => (samples ? new Scrubber(samples) : null), [samples])
  useEffect(() => () => scrubber?.stop(), [scrubber])

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = ((e.clientX - r.left - PLOT_LEFT) / Math.max(1, r.width - PLOT_LEFT - PLOT_RIGHT)) * Math.max(duration, 0.1)
    return Math.max(0, Math.min(duration, t))
  }
  const hear = (t: number) => scrubber?.set(scrub!.offset + t)
  const release = () => {
    scrubber?.stop()
    setProbe((p) => (p ? { ...p, held: false } : p))
  }
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const top = plotTop(labels)
    const v = Y_MAX - ((e.clientY - r.top - top) / Math.max(1, r.height - top - PLOT_BOTTOM)) * (Y_MAX - Y_MIN)
    return { t: at(e), v: Math.max(Y_MIN, Math.min(Y_MAX, v)) }
  }
  const handlers = draw
    ? {
        onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => {
          if (e.button !== 0) return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          draw(point(e), true)
        },
        onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) draw(point(e), false)
        },
      }
    : scrubber
    ? {
        onPointerDown: (e: PointerEvent<HTMLCanvasElement>) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          const t = at(e)
          setProbe({ t, held: true })
          hear(t)
        },
        onPointerMove: (e: PointerEvent<HTMLCanvasElement>) => {
          const held = e.currentTarget.hasPointerCapture(e.pointerId)
          if (!held && e.pointerType !== 'mouse') return
          const t = at(e)
          setProbe({ t, held })
          if (held) hear(t)
        },
        onPointerUp: release,
        onPointerCancel: () => {
          scrubber.stop()
          setProbe(null)
        },
        onPointerLeave: (e: PointerEvent<HTMLCanvasElement>) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) setProbe(null)
        },
        onContextMenu: (e: MouseEvent<HTMLCanvasElement>) => e.preventDefault(),
      }
    : {}

  return (
    <canvas
      ref={canvas}
      className={`pitch-plot${draw ? ' drawable' : scrubber ? ' scrubbable' : ''}`}
      style={{ height }}
      role="img"
      aria-label={draw ? 'Pitch chart: draw the melody you heard' : scrubber ? 'Pitch contour. Hold and drag to loop the sound at that point.' : 'Pitch contour'}
      title={draw ? 'Draw the pitch you heard' : scrubber ? 'Hold and drag to hear the pitch at that point' : undefined}
      {...handlers}
    />
  )
}

const PLOT_LEFT = 22
const PLOT_RIGHT = 6
const PLOT_BOTTOM = 6
/** Space above the plot for the labels. */
const plotTop = (labels: PlotLabel[]) => (labels.some((l) => l.target !== undefined && l.ok === false) ? 86 : labels.length ? 52 : 6)

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function paint(
  el: HTMLCanvasElement,
  { w, h }: { w: number; h: number },
  { lines, duration, boundaries, labels, cursor, probe, focus }: Omit<Props, 'height' | 'scrub'> & { boundaries: number[]; labels: PlotLabel[]; probe: Probe | null },
) {
  if (!w || !h) return
  const dpr = window.devicePixelRatio || 1
  el.width = Math.round(w * dpr)
  el.height = Math.round(h * dpr)
  const g = el.getContext('2d')!
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  const left = PLOT_LEFT
  const top = plotTop(labels)
  const bottom = PLOT_BOTTOM
  const plotH = h - top - bottom
  const x = (t: number) => left + (t / Math.max(duration, 0.1)) * (w - left - PLOT_RIGHT)
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

  // The syllable being asked about: tinted while unanswered (graded shading takes over after).
  if (focus) {
    const fx = x(focus[0])
    const fw = Math.max(4, x(focus[1]) - fx)
    const graded = labels.some((l) => l.ok !== undefined && l.span && l.span[0] < focus[1] && l.span[1] > focus[0])
    if (!graded) {
      g.globalAlpha = 0.16
      g.fillStyle = css('--accent')
      g.fillRect(fx, top, fw, h - top - bottom)
      g.globalAlpha = 1
    }
    g.fillStyle = css('--accent')
    g.fillRect(fx, top, fw, 4)
    g.fillRect(fx, h - bottom - 4, fw, 4)
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
    const color = line.kind === 'ref' ? css('--ref') : line.kind === 'wrong' ? css('--bad') : css('--user')
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
      if (Number.isNaN(v) || (pen && !line.joined && t - lastT > 0.05)) {
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

  if (probe) {
    // While held: shade the looped slice and mark the line; on hover just a faint guide.
    if (probe.held) {
      g.globalAlpha = 0.18
      g.fillStyle = css('--accent')
      const half = getLoopMs() / 2000
      g.fillRect(x(probe.t - half), top, Math.max(2, x(2 * half) - x(0)), h - top - bottom)
      g.globalAlpha = 1
    }
    g.strokeStyle = probe.held ? css('--accent') : css('--muted')
    g.lineWidth = probe.held ? 2 : 1
    g.setLineDash(probe.held ? [] : [4, 3])
    g.beginPath()
    g.moveTo(x(probe.t), top)
    g.lineTo(x(probe.t), h - bottom)
    g.stroke()
    g.setLineDash([])
  }

  g.textBaseline = 'alphabetic'
  for (const l of labels) {
    g.font = '600 18px system-ui, sans-serif'
    g.fillStyle = l.tone !== undefined ? css(`--t${l.tone}`) : css('--fg')
    g.fillText(l.text, x(l.t), 20)
    if (l.target !== undefined) {
      // Rows of "text + icon" share one icon column so target and pick line up.
      const rows: { text: string; tone: number; textColor: string; iconColor: string; bold: boolean }[] = []
      // Narrow columns (3+ syllables on a phone): drop the words and let the icons carry the tones.
      const room = l.span ? x(l.span[1]) - x(l.span[0]) - 6 : Infinity
      g.font = '700 15px system-ui, sans-serif'
      const longest = g.measureText(l.pick !== undefined ? `✗ you ${toneWord(l.pick)}` : `target ${toneWord(l.target)}`).width + 8 + 26
      const wide = longest <= room
      const name = (t: number) => (wide ? ` ${toneWord(t)}` : '')
      if (l.ok) rows.push({ text: '✓', tone: l.target, textColor: css('--good'), iconColor: css(`--t${l.target}`), bold: true })
      else {
        rows.push({ text: `${wide ? 'target' : 'is'}${name(l.target)}`, tone: l.target, textColor: css('--fg'), iconColor: css(`--t${l.target}`), bold: false })
        if (l.pick !== undefined) rows.push({ text: `✗ you${name(l.pick)}`, tone: l.pick, textColor: css('--bad'), iconColor: css('--bad'), bold: true })
      }
      const scale = 1.1
      let tw = 0
      for (const r of rows) {
        g.font = `${r.bold ? '700' : '500'} 15px system-ui, sans-serif`
        tw = Math.max(tw, g.measureText(r.text).width)
      }
      const x0 = x(l.t) - (tw + 8 + 24 * scale) / 2
      rows.forEach((r, k) => {
        const y0 = 44 + k * 23
        g.font = `${r.bold ? '700' : '500'} 15px system-ui, sans-serif`
        g.fillStyle = r.textColor
        g.textAlign = 'left'
        g.fillText(r.text, x0, y0)
        drawGlyph(g, r.tone, x0 + tw + 8, y0 - 13, r.iconColor, scale)
      })
      g.textAlign = 'center'
    } else if (l.sub) {
      g.font = l.ok === undefined ? '12px system-ui, sans-serif' : '600 13px system-ui, sans-serif'
      g.fillStyle = l.ok === false ? css('--bad') : css('--muted')
      g.fillText(l.sub, x(l.t), 43)
    }
  }
}

const toneWord = (t: number) => (t === 0 ? 'neutral' : `T${t}`)

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
