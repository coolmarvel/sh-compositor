/**
 * AI 지우개 도구 (갤럭시 AI 지우개·구글 매직 이레이저·포토샵 제거 도구처럼) — 지울 것 위를 빨간 형광펜처럼 칠하고 손을 떼면
 * AI 가 그 자리를 지우고 주변에 맞게 새로 그려 채운다. 한 번에 다 안 지워지면 남은 곳을 다시 칠하면 된다.
 *  - [ ] 로 붓 크기, Esc 로 칠하던 것 취소
 */
import { editor } from '../editor/store'
import { aiErase } from '../editor/actions'
import type { ToolHandler, ToolCtx, Pt } from './types'

let stroke: { pts: Pt[]; size: number } | null = null
/** 손을 뗀 뒤 AI 가 채우는 동안에도 칠한 자리를 보여 준다 */
let pending: { pts: Pt[]; size: number } | null = null
let hover: Pt | null = null
let running = false

const HIGHLIGHT = 'rgba(255,48,64,0.45)'

/** 칠한 자리 → 문서 크기 마스크 (0~255) — 획 경계만 그려서 옮긴다 */
function rasterize(c: ToolCtx, s: { pts: Pt[]; size: number }): Uint8Array | null {
  const d = c.doc()
  if (!d) return null
  const r = s.size / 2
  // 긴 획에서 spread(Math.min(...)) 는 인자 수 한도에 걸린다 — 한 번 훑는다
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of s.pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const x0 = Math.max(0, Math.floor(minX - r - 1))
  const y0 = Math.max(0, Math.floor(minY - r - 1))
  const x1 = Math.min(d.width, Math.ceil(maxX + r + 1))
  const y1 = Math.min(d.height, Math.ceil(maxY + r + 1))
  if (x1 <= x0 || y1 <= y0) return null
  const w = x1 - x0
  const h = y1 - y0
  const g = new OffscreenCanvas(w, h).getContext('2d')!
  g.fillStyle = g.strokeStyle = '#fff'
  g.lineWidth = s.size
  g.lineCap = 'round'
  g.lineJoin = 'round'
  if (s.pts.length === 1) {
    g.beginPath()
    g.arc(s.pts[0].x - x0, s.pts[0].y - y0, r, 0, Math.PI * 2)
    g.fill()
  } else {
    g.beginPath()
    s.pts.forEach((p, i) => (i ? g.lineTo(p.x - x0, p.y - y0) : g.moveTo(p.x - x0, p.y - y0)))
    g.stroke()
  }
  const a = g.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(d.width * d.height)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[(y + y0) * d.width + x + x0] = a[(y * w + x) * 4 + 3]
  return mask
}

function drawStroke(c: ToolCtx, g: CanvasRenderingContext2D, s: { pts: Pt[]; size: number }): void {
  const z = c.view().zoom
  g.save()
  g.strokeStyle = g.fillStyle = HIGHLIGHT
  g.lineWidth = Math.max(1, s.size * z)
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.beginPath()
  if (s.pts.length === 1) {
    const p = c.toScreen(s.pts[0].x, s.pts[0].y)
    g.arc(p.x, p.y, Math.max(1, (s.size / 2) * z), 0, Math.PI * 2)
    g.fill()
  } else {
    s.pts.forEach((q, i) => {
      const p = c.toScreen(q.x, q.y)
      if (i) g.lineTo(p.x, p.y)
      else g.moveTo(p.x, p.y)
    })
    g.stroke()
  }
  g.restore()
}

export const aiEraserTool: ToolHandler = {
  down(c, p) {
    if (running) return
    stroke = { pts: [p.p], size: editor.state.settings.aiEraserSize }
    c.redraw()
  },
  move(c, p, dragging) {
    hover = p.p
    if (dragging && stroke) {
      const last = stroke.pts[stroke.pts.length - 1]
      if (Math.hypot(p.p.x - last.x, p.p.y - last.y) >= 1) stroke.pts.push(p.p)
    }
    c.redraw()
  },
  up(c) {
    const s = stroke
    stroke = null
    if (!s || running) return
    const mask = rasterize(c, s)
    if (!mask) return c.redraw()
    pending = s
    running = true
    c.redraw()
    void aiErase(mask).finally(() => {
      running = false
      pending = null
      c.redraw()
    })
  },
  cancel(c) {
    stroke = null
    c.redraw()
  },
  key(c, e) {
    if (e.key !== '[' && e.key !== ']') return false
    const cur = editor.state.settings.aiEraserSize
    const next = e.key === ']' ? Math.min(1000, Math.round(cur * 1.2) + 1) : Math.max(4, Math.round(cur / 1.2) - 1)
    editor.setSettings({ aiEraserSize: next })
    c.redraw()
    return true
  },
  overlay(c, g) {
    if (pending) drawStroke(c, g, pending)
    if (stroke) drawStroke(c, g, stroke)
    if (!hover || running) return
    const s = c.toScreen(hover.x, hover.y)
    const R = (editor.state.settings.aiEraserSize / 2) * c.view().zoom
    g.save()
    g.lineWidth = 1
    g.strokeStyle = 'rgba(0,0,0,.8)'
    g.beginPath()
    g.arc(s.x, s.y, Math.max(1, R), 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = 'rgba(255,255,255,.9)'
    g.beginPath()
    g.arc(s.x, s.y, Math.max(1, R - 1), 0, Math.PI * 2)
    g.stroke()
    g.restore()
  },
  leave() {
    hover = null
  },
  cursor: () => (running ? 'progress' : 'crosshair')
}
