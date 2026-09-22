/**
 * 선택 도구 — 사각·타원 선택(M), 올가미·다각형 올가미(L), 마법봉(W).
 * Compositor `Selection`·`LassoControls`·`MagicWand` 의 조작 규칙:
 *  - Shift = 더하기, Alt = 빼기, Shift+Alt = 교집합. 드래그 중 Shift 를 다시 누르면 정사각/원.
 *  - 선택 안에서 끌기 = 선택 테두리만 이동, Ctrl+끌기 = 선택 안 픽셀을 떼어 이동(Alt 까지 누르면 복제 이동).
 *  - 다각형 올가미: 클릭으로 꼭짓점, 시작점 클릭·더블클릭·Enter 로 닫기, Backspace = 마지막 점 삭제, Esc 취소.
 *  - 마법봉: 허용 오차·인접·모든 레이어 표본.
 */
import { guideSnapTargets } from '../editor/guides'
import { editor } from '../editor/store'
import {
  rectMask,
  ellipseMask,
  polygonMask,
  combine,
  moveSelection,
  magicWand,
  getLayer,
  updateLayer,
  flattenDoc,
  rasterizeLayer,
  makeLayer,
  insertLayer,
  mergeDown,
  cropBitmap,
  identityTransform,
  selectionOutline,
  type Doc,
  type Selection,
  type SelectMode
} from '@core/index'
import { antsStroke, type ToolHandler, type ToolCtx, type PointerInfo, type Pt } from './types'
import { eraseSelection } from '../editor/pixels'

type Drag =
  | { kind: 'draw'; start: Pt; cur: Pt; mode: SelectMode; square: boolean }
  | { kind: 'moveSel'; start: Pt; orig: Selection }
  | { kind: 'movePix'; start: Pt; layerId: string; floatId: string; base: Doc }
  | { kind: 'lasso'; pts: Pt[]; mode: SelectMode }

let drag: Drag | null = null
/** 다각형 올가미 진행 중 꼭짓점 */
let poly: { pts: Pt[]; mode: SelectMode; hover: Pt | null } | null = null

export function modeOf(p: { shift: boolean; alt: boolean }): SelectMode {
  return p.shift && p.alt ? 'intersect' : p.shift ? 'add' : p.alt ? 'subtract' : 'replace'
}

const inSelection = (doc: Doc, p: Pt): boolean => {
  const s = doc.selection
  if (!s) return false
  const x = Math.floor(p.x)
  const y = Math.floor(p.y)
  return x >= 0 && y >= 0 && x < s.width && y < s.height && s.mask[y * s.width + x] >= 128
}

function applyMask(doc: Doc, mask: Uint8Array, mode: SelectMode, label: string): void {
  editor.commit({ ...doc, selection: combine(doc.selection, doc.width, doc.height, mask, mode) }, label)
}

/** Ctrl+끌기: 선택 안 픽셀을 떼어 "떠 있는" 레이어로 → 끌어서 → 놓으면 원래 레이어로 합친다 */
function startPixelMove(doc: Doc, p: PointerInfo): Drag | null {
  const l = getLayer(doc, doc.activeId)
  if (!l?.bitmap || !doc.selection?.bounds) return null
  const r = rasterizeLayer({ ...l, effects: null, opacity: 1 }, doc.width, doc.height)
  if (!r) return null
  const b = doc.selection.bounds
  const full = { width: doc.width, height: doc.height, data: new Uint8ClampedArray(doc.width * doc.height * 4) }
  for (let y = 0; y < r.height; y++) full.data.set(r.data.subarray(y * r.width * 4, (y + 1) * r.width * 4), ((r.y + y) * doc.width + r.x) * 4)
  const piece = cropBitmap(full, b.x, b.y, b.w, b.h)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) piece.data[(y * b.w + x) * 4 + 3] = (piece.data[(y * b.w + x) * 4 + 3] * doc.selection.mask[(b.y + y) * doc.width + b.x + x]) / 255
  let d = doc
  if (!p.alt) d = eraseSelection(d, l.id) // Alt = 복제 이동 (원본 유지)
  const float = makeLayer('pixel', `${l.name} 조각`, piece, identityTransform(b.w, b.h, b.x, b.y))
  d = insertLayer(d, float, l.id)
  return { kind: 'movePix', start: p.p, layerId: l.id, floatId: float.id, base: d }
}

function marqueeOrLasso(kind: 'marquee' | 'lasso'): ToolHandler {
  return {
    down(c, p) {
      const doc = c.doc()
      if (!doc) return
      if (kind === 'lasso' && editor.state.settings.lassoKind === 'polygon') {
        if (!poly) poly = { pts: [p.p], mode: modeOf(p), hover: p.p }
        else {
          const first = c.toScreen(poly.pts[0].x, poly.pts[0].y)
          if (poly.pts.length > 2 && Math.hypot(first.x - p.s.x, first.y - p.s.y) < 8) return this.commit!(c)
          poly.pts.push(p.p)
        }
        c.redraw()
        return
      }
      if (inSelection(doc, p.p) && !p.shift && !p.alt) {
        if (p.ctrl) {
          drag = startPixelMove(doc, p)
          if (drag) editor.commitGesture((drag as { base: Doc }).base, '픽셀 이동')
          return
        }
        drag = { kind: 'moveSel', start: p.p, orig: doc.selection! }
        return
      }
      if (inSelection(doc, p.p) && p.ctrl && p.alt) {
        drag = startPixelMove(doc, p)
        if (drag) editor.commitGesture((drag as { base: Doc }).base, '픽셀 복제 이동')
        return
      }
      drag = kind === 'marquee' ? { kind: 'draw', start: p.p, cur: p.p, mode: modeOf(p), square: false } : { kind: 'lasso', pts: [p.p], mode: modeOf(p) }
    },
    move(c, p, dragging) {
      if (poly) {
        poly.hover = p.p
        c.redraw()
        return
      }
      if (!dragging || !drag) return
      const doc = c.doc()
      if (!doc) return
      if (drag.kind === 'draw') {
        drag.cur = p.p
        drag.square = p.shift && drag.mode !== 'add' ? true : drag.square || (p.shift && drag.mode === 'add' && false)
        c.redraw()
      } else if (drag.kind === 'lasso') {
        drag.pts.push(p.p)
        c.redraw()
      } else if (drag.kind === 'moveSel') {
        const dx = Math.round(p.p.x - drag.start.x)
        const dy = Math.round(p.p.y - drag.start.y)
        editor.commitGesture({ ...doc, selection: moveSelection(drag.orig, dx, dy) }, '선택 이동')
      } else if (drag.kind === 'movePix') {
        const dx = Math.round(p.p.x - drag.start.x)
        const dy = Math.round(p.p.y - drag.start.y)
        const f = getLayer(drag.base, drag.floatId)!
        let d = updateLayer(drag.base, drag.floatId, { transform: { ...f.transform, x: f.transform.x + dx, y: f.transform.y + dy } })
        if (drag.base.selection) d = { ...d, selection: moveSelection(drag.base.selection, dx, dy) }
        editor.commitGesture(d, '픽셀 이동')
      }
    },
    up(c, p) {
      const doc = c.doc()
      const d = drag
      drag = null
      if (!doc || !d) return
      if (d.kind === 'draw') {
        const r = snapToGuides(rectOf(d.start, p.p, p.shift, p.alt), doc, 6 / c.view().zoom)
        if (r.w < 1 || r.h < 1) {
          if (d.mode === 'replace' && doc.selection) editor.commit({ ...doc, selection: null }, '선택 해제')
        } else {
          const m = editor.state.settings.marqueeKind === 'ellipse' ? ellipseMask(doc.width, doc.height, r) : rectMask(doc.width, doc.height, snapRect(r))
          applyMask(doc, m, d.mode, editor.state.settings.marqueeKind === 'ellipse' ? '타원 선택' : '사각 선택')
        }
      } else if (d.kind === 'lasso') {
        if (d.pts.length > 2) applyMask(doc, polygonMask(doc.width, doc.height, d.pts), d.mode, '올가미')
      } else if (d.kind === 'moveSel') editor.endGesture()
      else if (d.kind === 'movePix') {
        // 떠 있던 조각을 원래 레이어로 합친다 (Photoshop 과 같이 선택 해제 전까지는 하나로)
        const merged = mergeDown(doc, d.floatId)
        editor.commitGesture(merged, '픽셀 이동')
        editor.endGesture()
      }
      c.redraw()
    },
    dbl(c) {
      if (poly) this.commit!(c)
    },
    commit(c) {
      const doc = c.doc()
      if (poly && doc) {
        if (poly.pts.length > 2) applyMask(doc, polygonMask(doc.width, doc.height, poly.pts), poly.mode, '다각형 올가미')
        poly = null
        c.redraw()
      }
    },
    cancel(c) {
      poly = null
      drag = null
      c.redraw()
    },
    leave(c) {
      poly = null
      drag = null
      c.redraw()
    },
    key(c, e) {
      if (poly && e.key === 'Backspace') {
        poly.pts.pop()
        if (!poly.pts.length) poly = null
        c.redraw()
        return true
      }
      return nudgeSelection(c, e)
    },
    overlay(c, g) {
      if (drag?.kind === 'draw') {
        const d0 = c.doc()
        const r0 = rectOf(drag.start, drag.cur, false, false)
        const r = d0 ? snapToGuides(r0, d0, 6 / c.view().zoom) : r0
        const a = c.toScreen(r.x, r.y)
        const b = c.toScreen(r.x + r.w, r.y + r.h)
        antsStroke(g, () => {
          g.beginPath()
          if (editor.state.settings.marqueeKind === 'ellipse') g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
          else g.rect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y))
        })
      }
      const pts = drag?.kind === 'lasso' ? drag.pts : poly ? [...poly.pts, ...(poly.hover ? [poly.hover] : [])] : null
      if (pts) {
        antsStroke(g, () => {
          g.beginPath()
          pts.forEach((q, i) => {
            const s = c.toScreen(q.x, q.y)
            i ? g.lineTo(s.x, s.y) : g.moveTo(s.x, s.y)
          })
          if (!poly) g.closePath()
        })
        if (poly) {
          for (const q of poly.pts) {
            const s = c.toScreen(q.x, q.y)
            g.fillStyle = '#fff'
            g.fillRect(s.x - 2, s.y - 2, 4, 4)
          }
        }
      }
    },
    cursor(c, hover) {
      const doc = c.doc()
      if (doc && hover && inSelection(doc, hover.p) && !hover.shift && !hover.alt) return hover.ctrl ? 'move' : 'default'
      return 'crosshair'
    }
  }
}

/** 두 점 → 사각형 (Shift = 정사각, Alt = 시작점이 가운데) */
function rectOf(a: Pt, b: Pt, square: boolean, center: boolean): { x: number; y: number; w: number; h: number } {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (square) {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * m
    dy = Math.sign(dy || 1) * m
  }
  if (center) return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) }
}
/** 사각 선택 가장자리를 안내선에 붙인다 (보기 ▸ 안내선에 맞추기) */
function snapToGuides(r: { x: number; y: number; w: number; h: number }, doc: Doc, tol: number): { x: number; y: number; w: number; h: number } {
  const g = guideSnapTargets(doc)
  if (!g.xs.length && !g.ys.length) return r
  const near = (v: number, ts: number[]): number => ts.find((t) => Math.abs(t - v) < tol) ?? v
  const x0 = near(r.x, g.xs)
  const y0 = near(r.y, g.ys)
  const x1 = near(r.x + r.w, g.xs)
  const y1 = near(r.y + r.h, g.ys)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** 사각 선택은 픽셀 격자에 맞춘다 (Photoshop 과 같이 반쪽 픽셀 없음) */
const snapRect = (r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => {
  const x0 = Math.round(r.x)
  const y0 = Math.round(r.y)
  return { x: x0, y: y0, w: Math.round(r.x + r.w) - x0, h: Math.round(r.y + r.h) - y0 }
}

/** 방향키로 선택 테두리 1px 이동 (선택 도구일 때) */
function nudgeSelection(c: ToolCtx, e: KeyboardEvent): boolean {
  const doc = c.doc()
  if (!doc?.selection) return false
  const step = e.shiftKey ? 10 : 1
  const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
  if (!dir) return false
  editor.commit({ ...doc, selection: moveSelection(doc.selection, dir[0], dir[1]) }, '선택 이동')
  return true
}

export const marqueeTool = marqueeOrLasso('marquee')
export const lassoTool = marqueeOrLasso('lasso')

export const wandTool: ToolHandler = {
  down(c, p) {
    const doc = c.doc()
    if (!doc) return
    const s = editor.state.settings
    let rgba: Uint8ClampedArray
    if (s.wandSampleAll) rgba = flattenDoc(doc).data
    else {
      const l = getLayer(doc, doc.activeId)
      if (!l) return
      rgba = flattenDoc({ ...doc, layers: [{ ...l, parentId: null, clip: false, visible: true, opacity: 1, blend: 'normal' }] }).data
    }
    const m = magicWand(rgba, doc.width, doc.height, p.p.x, p.p.y, s.wandTolerance, s.wandContiguous, 1)
    applyMask(doc, m, modeOf(p), '마법봉')
    c.redraw()
  },
  key: nudgeSelection,
  cursor: () => 'crosshair'
}

/** 선택 테두리(개미 행진) — 모든 도구 공통으로 캔버스가 그린다. 선분은 선택 객체마다 한 번만 계산 */
const outlineCache = new WeakMap<Selection, Float32Array>()
export function drawSelection(c: ToolCtx, g: CanvasRenderingContext2D, sel: Selection): void {
  let segs = outlineCache.get(sel)
  if (!segs) {
    segs = selectionOutline(sel)
    outlineCache.set(sel, segs)
  }
  const v = c.view()
  const dpr = 1
  antsStroke(g, () => {
    g.beginPath()
    for (let i = 0; i < segs!.length; i += 4) {
      const x1 = Math.round(v.panX + segs![i] * v.zoom * dpr) + 0.5
      const y1 = Math.round(v.panY + segs![i + 1] * v.zoom * dpr) + 0.5
      const x2 = Math.round(v.panX + segs![i + 2] * v.zoom * dpr) + 0.5
      const y2 = Math.round(v.panY + segs![i + 3] * v.zoom * dpr) + 0.5
      g.moveTo(x1, y1)
      g.lineTo(x2, y2)
    }
  })
}

export function hasPolygon(): boolean {
  return !!poly
}
