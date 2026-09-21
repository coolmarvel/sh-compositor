/**
 * 이동·변형 도구 (V) — Compositor `TransformOverlay`·`LayerTransform`·`Distort`.
 *  - 드래그 = 이동 (Shift = 가로/세로 고정), Alt 드래그 = 복제 후 이동
 *  - 모서리·변 핸들 = 크기 (비율 잠금이 기본 — Shift 로 반대), Alt = 가운데 기준
 *  - 상자 밖 둥근 핸들 = 회전 (Shift = 15° 단위)
 *  - Ctrl + 모서리 = 자유 변형(네 모서리) → 확정하면 픽셀을 새 모양으로 리샘플 (Compositor 와 같다)
 *  - 캔버스·다른 레이어의 가장자리·가운데에 스냅, 안내선 표시
 *  - 방향키 = 1px (Shift = 10px), Ctrl+클릭 = 아래 레이어 고르기
 */
import { editor } from '../editor/store'
import {
  getLayer,
  updateLayer,
  duplicateLayers,
  transformCorners,
  hitTransform,
  rasterizeBitmap,
  rectToQuadHomography,
  applyHomography,
  type Doc,
  type Layer,
  type LayerTransform,
  type Quad
} from '@core/index'
import type { ToolHandler, ToolCtx, PointerInfo, Pt } from './types'

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot'
type Drag =
  | { kind: 'move'; start: Pt; orig: LayerTransform; ids: string[]; origs: Map<string, LayerTransform> }
  | { kind: 'scale'; handle: Handle; start: Pt; orig: LayerTransform }
  | { kind: 'rotate'; start: Pt; orig: LayerTransform; a0: number }
  | { kind: 'distort'; corner: number; quad: Pt[] }

let drag: Drag | null = null
let guides: { xs: number[]; ys: number[] } = { xs: [], ys: [] }
/** 진행 중인 자유 변형 (확정 전) */
let distort: { layerId: string; quad: Pt[] } | null = null

const HANDLE_R = 5
const ROT_OFFSET = 24

function activeLayer(doc: Doc): Layer | null {
  const l = getLayer(doc, doc.activeId)
  return l && l.kind !== 'adjustment' ? l : null
}

/** 폴더면 자손 픽셀 레이어까지 함께 움직인다 */
function movable(doc: Doc, l: Layer): Layer[] {
  if (l.kind !== 'group') return [l]
  const out: Layer[] = []
  const walk = (id: string): void => {
    for (const k of doc.layers)
      if (k.parentId === id) {
        if (k.kind === 'group') walk(k.id)
        else if (k.bitmap) out.push(k)
      }
  }
  walk(l.id)
  return out
}

function handles(c: ToolCtx, t: LayerTransform): { h: Handle; s: Pt }[] {
  const cs = transformCorners(t).map((p) => c.toScreen(p.x, p.y))
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  const top = mid(cs[0], cs[1])
  const center = mid(cs[0], cs[2])
  const dx = top.x - center.x
  const dy = top.y - center.y
  const len = Math.hypot(dx, dy) || 1
  return [
    { h: 'nw', s: cs[0] },
    { h: 'n', s: top },
    { h: 'ne', s: cs[1] },
    { h: 'e', s: mid(cs[1], cs[2]) },
    { h: 'se', s: cs[2] },
    { h: 's', s: mid(cs[2], cs[3]) },
    { h: 'sw', s: cs[3] },
    { h: 'w', s: mid(cs[3], cs[0]) },
    { h: 'rot', s: { x: top.x + (dx / len) * ROT_OFFSET, y: top.y + (dy / len) * ROT_OFFSET } }
  ]
}

function hitHandle(c: ToolCtx, t: LayerTransform, s: Pt): Handle | null {
  for (const { h, s: hs } of handles(c, t)) if (Math.hypot(hs.x - s.x, hs.y - s.y) <= HANDLE_R + 3) return h
  return null
}

/** 스냅 후보: 캔버스 가장자리·가운데 + 다른 보이는 레이어의 가장자리·가운데 */
function snapTargets(doc: Doc, exclude: Set<string>): { xs: number[]; ys: number[] } {
  const xs = [0, doc.width / 2, doc.width]
  const ys = [0, doc.height / 2, doc.height]
  for (const l of doc.layers) {
    if (exclude.has(l.id) || !l.visible || !l.bitmap) continue
    const cs = transformCorners(l.transform)
    const x0 = Math.min(...cs.map((p) => p.x))
    const x1 = Math.max(...cs.map((p) => p.x))
    const y0 = Math.min(...cs.map((p) => p.y))
    const y1 = Math.max(...cs.map((p) => p.y))
    xs.push(x0, (x0 + x1) / 2, x1)
    ys.push(y0, (y0 + y1) / 2, y1)
  }
  return { xs, ys }
}

function snapMove(doc: Doc, t: LayerTransform, tol: number, exclude: Set<string>): { dx: number; dy: number; gx: number[]; gy: number[] } {
  const cs = transformCorners(t)
  const x0 = Math.min(...cs.map((p) => p.x))
  const x1 = Math.max(...cs.map((p) => p.x))
  const y0 = Math.min(...cs.map((p) => p.y))
  const y1 = Math.max(...cs.map((p) => p.y))
  const tg = snapTargets(doc, exclude)
  let dx = 0
  let dy = 0
  let best = tol
  const gx: number[] = []
  const gy: number[] = []
  for (const v of [x0, (x0 + x1) / 2, x1])
    for (const s of tg.xs)
      if (Math.abs(s - v) < best) {
        best = Math.abs(s - v)
        dx = s - v
        gx[0] = s
      }
  best = tol
  for (const v of [y0, (y0 + y1) / 2, y1])
    for (const s of tg.ys)
      if (Math.abs(s - v) < best) {
        best = Math.abs(s - v)
        dy = s - v
        gy[0] = s
      }
  return { dx, dy, gx, gy }
}

/** 로컬(회전 전) 좌표계로 점을 돌려 놓는다 */
function toLocal(t: LayerTransform, p: Pt): Pt {
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  const r = (-t.rotation * Math.PI) / 180
  const dx = p.x - cx
  const dy = p.y - cy
  return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) }
}

function scaled(o: LayerTransform, h: Handle, p: Pt, keepRatio: boolean, fromCenter: boolean): LayerTransform {
  const lp = toLocal(o, p)
  const hw = o.width / 2
  const hh = o.height / 2
  // 반대편 고정점 (로컬)
  const sx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0
  const sy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0
  let w = o.width
  let hgt = o.height
  if (sx) w = fromCenter ? Math.abs(lp.x) * 2 : Math.max(1, sx * lp.x + hw)
  if (sy) hgt = fromCenter ? Math.abs(lp.y) * 2 : Math.max(1, sy * lp.y + hh)
  if (keepRatio) {
    const ratio = o.width / o.height
    if (sx && sy) {
      if (w / ratio > hgt) hgt = w / ratio
      else w = hgt * ratio
    } else if (sx) hgt = w / ratio
    else if (sy) w = hgt * ratio
  }
  w = Math.max(1, w)
  hgt = Math.max(1, hgt)
  // 새 중심 (로컬): 고정점 + 새 크기의 절반
  const cxL = fromCenter ? 0 : sx ? -sx * hw + (sx * w) / 2 : 0
  const cyL = fromCenter ? 0 : sy ? -sy * hh + (sy * hgt) / 2 : 0
  const r = (o.rotation * Math.PI) / 180
  const cx = o.x + o.width / 2 + cxL * Math.cos(r) - cyL * Math.sin(r)
  const cy = o.y + o.height / 2 + cxL * Math.sin(r) + cyL * Math.cos(r)
  return { ...o, x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt }
}

/** 자유 변형 확정: 레이어 픽셀을 네 점 모양으로 리샘플 → 축 정렬된 새 비트맵 (Compositor Distort.apply) */
export function applyDistort(doc: Doc, layerId: string, quad: Pt[]): Doc {
  const l = getLayer(doc, layerId)
  if (!l?.bitmap) return doc
  const xs = quad.map((p) => p.x)
  const ys = quad.map((p) => p.y)
  const x0 = Math.floor(Math.min(...xs))
  const y0 = Math.floor(Math.min(...ys))
  const w = Math.max(1, Math.ceil(Math.max(...xs)) - x0)
  const h = Math.max(1, Math.ceil(Math.max(...ys)) - y0)
  // 원래 모양(변형 사각형)으로 래스터 → 그 사각형 좌표계에서 네 점으로 보냄
  const flatT: LayerTransform = { ...l.transform, rotation: l.transform.rotation }
  const src = rasterizeBitmap(l.bitmap, { transform: { ...flatT, x: 0, y: 0, rotation: 0 } }, Math.ceil(flatT.width), Math.ceil(flatT.height))
  if (!src) return doc
  const Hm = rectToQuadHomography(src.width, src.height, quad.map((p) => ({ x: p.x - x0, y: p.y - y0 })) as Quad)
  // 역행렬 (3×3)
  const [a, b, c, d, e, f, g, hh] = Hm
  const i = 1
  const det = a * (e * i - f * hh) - b * (d * i - f * g) + c * (d * hh - e * g)
  const inv = [
    (e * i - f * hh) / det,
    (c * hh - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * hh - e * g) / det,
    (b * g - a * hh) / det,
    (a * e - b * d) / det
  ]
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = applyHomography(inv, x + 0.5, y + 0.5)
      const sx = Math.floor(s.x)
      const sy = Math.floor(s.y)
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue
      const o = (sy * src.width + sx) * 4
      out.set(src.data.subarray(o, o + 4), (y * w + x) * 4)
    }
  return updateLayer(doc, layerId, { bitmap: { width: w, height: h, data: out }, transform: { x: x0, y: y0, width: w, height: h, rotation: 0, flipH: false, flipV: false }, mask: null })
}

export const moveTool: ToolHandler = {
  down(c, p) {
    const doc = c.doc()
    if (!doc) return
    let l = activeLayer(doc)
    // Ctrl+클릭(또는 자동 선택) = 누른 곳의 맨 위 레이어를 고른다
    if ((p.ctrl && !drag) || editor.state.settings.autoSelect) {
      const hit = [...doc.layers].reverse().find((k) => k.visible && k.bitmap && hitTransform(k.transform, p.p.x, p.p.y) && alphaAt(k, p.p) > 10)
      if (hit && hit.id !== doc.activeId) {
        editor.quiet({ ...doc, activeId: hit.id })
        l = hit
      }
      if (p.ctrl && !editor.state.settings.autoSelect && !l) return
    }
    if (!l) return
    if (distort && distort.layerId === l.id) {
      const k = distort.quad.findIndex((q) => {
        const s = c.toScreen(q.x, q.y)
        return Math.hypot(s.x - p.s.x, s.y - p.s.y) <= HANDLE_R + 3
      })
      if (k >= 0) {
        drag = { kind: 'distort', corner: k, quad: distort.quad.map((q) => ({ ...q })) }
        return
      }
    }
    const h = editor.state.settings.showTransformControls ? hitHandle(c, l.transform, p.s) : null
    if (h && h !== 'rot' && p.ctrl && ['nw', 'ne', 'se', 'sw'].includes(h)) {
      const quad = transformCorners(l.transform)
      distort = { layerId: l.id, quad }
      drag = { kind: 'distort', corner: ['nw', 'ne', 'se', 'sw'].indexOf(h), quad: quad.map((q) => ({ ...q })) }
      return
    }
    if (h === 'rot') {
      const t = l.transform
      drag = { kind: 'rotate', start: p.p, orig: t, a0: Math.atan2(p.p.y - (t.y + t.height / 2), p.p.x - (t.x + t.width / 2)) }
      return
    }
    if (h) {
      drag = { kind: 'scale', handle: h, start: p.p, orig: l.transform }
      return
    }
    // Alt 드래그 = 복제해서 이동 (Compositor Option-drag)
    let d = doc
    if (p.alt) {
      d = duplicateLayers(doc, [l.id])
      editor.commit(d, '복제')
      l = getLayer(d, d.activeId)!
    }
    const ls = movable(d, l)
    drag = { kind: 'move', start: p.p, orig: l.transform, ids: ls.map((k) => k.id), origs: new Map(ls.map((k) => [k.id, k.transform])) }
  },
  move(c, p, dragging) {
    if (!dragging || !drag) return
    const doc = c.doc()
    if (!doc) return
    const tol = 6 / c.view().zoom
    if (drag.kind === 'move') {
      let dx = p.p.x - drag.start.x
      let dy = p.p.y - drag.start.y
      if (p.shift) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0)
      const main = { ...drag.orig, x: drag.orig.x + dx, y: drag.orig.y + dy }
      const snap = p.ctrl ? { dx: 0, dy: 0, gx: [], gy: [] } : snapMove(doc, main, tol, new Set(drag.ids))
      guides = { xs: snap.gx, ys: snap.gy }
      let d = doc
      for (const id of drag.ids) {
        const o = drag.origs.get(id)!
        d = updateLayer(d, id, { transform: { ...o, x: Math.round((o.x + dx + snap.dx) * 100) / 100, y: Math.round((o.y + dy + snap.dy) * 100) / 100 } })
      }
      editor.commitGesture(d, '이동')
    } else if (drag.kind === 'scale') {
      const lock = editor.state.settings.showTransformControls
      const t = scaled(drag.orig, drag.handle, p.p, lock ? !p.shift : p.shift, p.alt)
      editor.commitGesture(updateLayer(doc, doc.activeId!, { transform: t }), '변형')
    } else if (drag.kind === 'rotate') {
      const t = drag.orig
      const a = Math.atan2(p.p.y - (t.y + t.height / 2), p.p.x - (t.x + t.width / 2))
      let deg = t.rotation + ((a - drag.a0) * 180) / Math.PI
      if (p.shift) deg = Math.round(deg / 15) * 15
      editor.commitGesture(updateLayer(doc, doc.activeId!, { transform: { ...t, rotation: Math.round(deg * 100) / 100 } }), '회전')
    } else if (drag.kind === 'distort' && distort) {
      distort.quad[drag.corner] = { x: p.p.x, y: p.p.y }
      c.redraw()
    }
  },
  up(c) {
    const was = drag
    drag = null
    guides = { xs: [], ys: [] }
    if (was && was.kind !== 'distort') editor.endGesture()
    c.redraw()
  },
  commit(c) {
    const doc = c.doc()
    if (distort && doc) {
      editor.commit(applyDistort(doc, distort.layerId, distort.quad), '자유 변형')
      distort = null
      c.redraw()
    }
  },
  cancel(c) {
    distort = null
    drag = null
    c.redraw()
  },
  leave(c) {
    this.commit?.(c)
  },
  key(c, e) {
    const doc = c.doc()
    if (!doc || !doc.activeId) return false
    const step = e.shiftKey ? 10 : 1
    const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!dir) return false
    const l = getLayer(doc, doc.activeId)
    if (!l) return false
    let d = doc
    for (const k of movable(doc, l)) d = updateLayer(d, k.id, { transform: { ...k.transform, x: k.transform.x + dir[0], y: k.transform.y + dir[1] } })
    editor.commit(d, '이동')
    return true
  },
  overlay(c, g) {
    const doc = c.doc()
    if (!doc) return
    const l = activeLayer(doc)
    const v = c.view()
    g.save()
    // 스냅 안내선
    g.strokeStyle = '#ff2fd1'
    g.lineWidth = 1
    for (const x of guides.xs) {
      const s = c.toScreen(x, 0)
      g.beginPath()
      g.moveTo(Math.round(s.x) + 0.5, 0)
      g.lineTo(Math.round(s.x) + 0.5, g.canvas.height)
      g.stroke()
    }
    for (const y of guides.ys) {
      const s = c.toScreen(0, y)
      g.beginPath()
      g.moveTo(0, Math.round(s.y) + 0.5)
      g.lineTo(g.canvas.width, Math.round(s.y) + 0.5)
      g.stroke()
    }
    if (distort && l && distort.layerId === l.id) {
      const q = distort.quad.map((p) => c.toScreen(p.x, p.y))
      g.strokeStyle = '#2a8dd4'
      g.beginPath()
      q.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
      g.stroke()
      for (const p of q) {
        g.fillStyle = '#fff'
        g.fillRect(p.x - HANDLE_R, p.y - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2)
        g.strokeRect(p.x - HANDLE_R + 0.5, p.y - HANDLE_R + 0.5, HANDLE_R * 2 - 1, HANDLE_R * 2 - 1)
      }
      g.restore()
      return
    }
    if (l && editor.state.settings.showTransformControls && l.kind !== 'group') {
      const cs = transformCorners(l.transform).map((p) => c.toScreen(p.x, p.y))
      g.strokeStyle = '#2a8dd4'
      g.beginPath()
      cs.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
      g.stroke()
      const hs = handles(c, l.transform)
      const top = hs.find((h) => h.h === 'n')!.s
      const rot = hs.find((h) => h.h === 'rot')!.s
      g.beginPath()
      g.moveTo(top.x, top.y)
      g.lineTo(rot.x, rot.y)
      g.stroke()
      for (const { h, s } of hs) {
        g.fillStyle = '#fff'
        g.strokeStyle = '#2a8dd4'
        if (h === 'rot') {
          g.beginPath()
          g.arc(s.x, s.y, HANDLE_R, 0, Math.PI * 2)
          g.fill()
          g.stroke()
        } else {
          g.fillRect(Math.round(s.x) - HANDLE_R, Math.round(s.y) - HANDLE_R, HANDLE_R * 2, HANDLE_R * 2)
          g.strokeRect(Math.round(s.x) - HANDLE_R + 0.5, Math.round(s.y) - HANDLE_R + 0.5, HANDLE_R * 2 - 1, HANDLE_R * 2 - 1)
        }
      }
    }
    void v
    g.restore()
  },
  cursor(c, hover) {
    const doc = c.doc()
    if (!doc || !hover) return 'default'
    const l = activeLayer(doc)
    if (!l) return 'default'
    const h = editor.state.settings.showTransformControls ? hitHandle(c, l.transform, hover.s) : null
    if (h === 'rot') return 'grab'
    if (h)
      return hover.ctrl && ['nw', 'ne', 'se', 'sw'].includes(h)
        ? 'crosshair'
        : { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[h]
    return 'move'
  }
}

/** 레이어 비트맵에서 문서 점의 알파 (Ctrl+클릭으로 레이어 고르기) */
function alphaAt(l: Layer, p: Pt): number {
  if (!l.bitmap) return 0
  const t = l.transform
  const lp = toLocal(t, p)
  let u = (lp.x / t.width + 0.5) * l.bitmap.width
  let v = (lp.y / t.height + 0.5) * l.bitmap.height
  if (t.flipH) u = l.bitmap.width - u
  if (t.flipV) v = l.bitmap.height - v
  const x = Math.floor(u)
  const y = Math.floor(v)
  if (x < 0 || y < 0 || x >= l.bitmap.width || y >= l.bitmap.height) return 0
  return l.bitmap.data[(y * l.bitmap.width + x) * 4 + 3]
}

export function hasPendingDistort(): boolean {
  return !!distort
}
export type { PointerInfo }
