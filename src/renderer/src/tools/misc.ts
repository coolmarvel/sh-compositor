/**
 * 나머지 도구 — 자르기(C)·그라데이션(G)·도형(U)·문자(T)·스포이트(I)·손(H)·돋보기(Z).
 * 출처: Compositor `Crop`·`Gradient`·`ShapeTool`·`TypeTool`·`ColorPalette`·`CanvasViewport`.
 */
import { editor } from '../editor/store'
import { editPixels, trimToCanvas } from '../editor/pixels'
import { renderText, DEFAULT_TEXT } from '../editor/text'
import { cropDoc, getLayer, updateLayer, insertLayer, makeLayer, identityTransform, hitTransform, flattenDoc, type TextData, type Doc } from '@core/index'
import type { ToolHandler, ToolCtx, PointerInfo, Pt } from './types'

type R = { x: number; y: number; w: number; h: number }

// ── 자르기 ────────────────────────────────────────────────────────────────
let crop: R | null = null
let cropDrag: { kind: 'new'; a: Pt } | { kind: 'move'; a: Pt; orig: R } | { kind: 'edge'; h: string; orig: R } | null = null

const RATIOS: Record<string, number | null> = { free: null, orig: -1, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16 }
export const CROP_RATIO_LIST: { key: string; label: string }[] = [
  { key: 'free', label: '자유' },
  { key: 'orig', label: '원본 비율' },
  { key: '1:1', label: '1:1' },
  { key: '4:3', label: '4:3' },
  { key: '3:2', label: '3:2' },
  { key: '16:9', label: '16:9' },
  { key: '3:4', label: '3:4' },
  { key: '2:3', label: '2:3' },
  { key: '9:16', label: '9:16' }
]

function ratio(doc: Doc): number | null {
  const r = RATIOS[editor.state.settings.cropRatio] ?? null
  return r === -1 ? doc.width / doc.height : r
}

/** 가장자리·가운데 스냅 (6 화면 px) */
function snap(v: number, targets: number[], tol: number): number {
  for (const t of targets) if (Math.abs(v - t) < tol) return t
  return v
}

function cropRect(doc: Doc, a: Pt, b: Pt, shift: boolean, alt: boolean, tol: number): R {
  let dx = b.x - a.x
  let dy = b.y - a.y
  const rr = shift ? 1 : ratio(doc)
  if (rr) {
    if (Math.abs(dx) / rr > Math.abs(dy)) dy = (Math.sign(dy || 1) * Math.abs(dx)) / rr
    else dx = Math.sign(dx || 1) * Math.abs(dy) * rr
  }
  let x0 = alt ? a.x - Math.abs(dx) : Math.min(a.x, a.x + dx)
  let y0 = alt ? a.y - Math.abs(dy) : Math.min(a.y, a.y + dy)
  let x1 = alt ? a.x + Math.abs(dx) : Math.max(a.x, a.x + dx)
  let y1 = alt ? a.y + Math.abs(dy) : Math.max(a.y, a.y + dy)
  if (!rr) {
    x0 = snap(x0, [0, doc.width / 2], tol)
    y0 = snap(y0, [0, doc.height / 2], tol)
    x1 = snap(x1, [doc.width, doc.width / 2], tol)
    y1 = snap(y1, [doc.height, doc.height / 2], tol)
  }
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }
}

export const cropTool: ToolHandler = {
  down(c, p) {
    const doc = c.doc()
    if (!doc) return
    if (crop) {
      const h = cropHandle(c, p.s)
      if (h) {
        cropDrag = { kind: 'edge', h, orig: { ...crop } }
        return
      }
      if (p.p.x >= crop.x && p.p.y >= crop.y && p.p.x <= crop.x + crop.w && p.p.y <= crop.y + crop.h) {
        cropDrag = { kind: 'move', a: p.p, orig: { ...crop } }
        return
      }
    }
    cropDrag = { kind: 'new', a: p.p }
    crop = { x: p.p.x, y: p.p.y, w: 0, h: 0 }
  },
  move(c, p, dragging) {
    const doc = c.doc()
    if (!doc || !dragging || !cropDrag) return
    const tol = 6 / c.view().zoom
    if (cropDrag.kind === 'new') crop = cropRect(doc, cropDrag.a, p.p, p.shift, p.alt, tol)
    else if (cropDrag.kind === 'move') crop = { ...cropDrag.orig, x: Math.round(cropDrag.orig.x + p.p.x - cropDrag.a.x), y: Math.round(cropDrag.orig.y + p.p.y - cropDrag.a.y) }
    else {
      const o = cropDrag.orig
      const h = cropDrag.h
      let x0 = o.x
      let y0 = o.y
      let x1 = o.x + o.w
      let y1 = o.y + o.h
      if (h.includes('w')) x0 = snap(p.p.x, [0], tol)
      if (h.includes('e')) x1 = snap(p.p.x, [doc.width], tol)
      if (h.includes('n')) y0 = snap(p.p.y, [0], tol)
      if (h.includes('s')) y1 = snap(p.p.y, [doc.height], tol)
      if (p.alt) {
        // Alt = 가운데 대칭 (Compositor Option 대칭 자르기)
        const cx = o.x + o.w / 2
        const cy = o.y + o.h / 2
        if (h.includes('w') || h.includes('e')) {
          const hw = Math.abs((h.includes('w') ? x0 : x1) - cx)
          x0 = cx - hw
          x1 = cx + hw
        }
        if (h.includes('n') || h.includes('s')) {
          const hh = Math.abs((h.includes('n') ? y0 : y1) - cy)
          y0 = cy - hh
          y1 = cy + hh
        }
      }
      crop = { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) }
    }
    c.redraw()
  },
  up(c) {
    cropDrag = null
    if (crop && (crop.w < 2 || crop.h < 2)) crop = null
    c.redraw()
  },
  commit(c) {
    const doc = c.doc()
    if (!doc || !crop) return
    let d = cropDoc(doc, crop)
    if (editor.state.settings.cropDelete) d = trimToCanvas(d) // 잘린 픽셀 삭제 (끄면 비파괴 — 캔버스를 다시 키우면 돌아온다)
    editor.commit(d, '자르기')
    crop = null
    const v = editor.tab?.view
    if (v) editor.setView({ ...v, fit: true }) // 자른 문서에 바로 다시 맞춤 (store 가 크기 변화를 반영)
    c.redraw()
  },
  cancel(c) {
    crop = null
    c.redraw()
  },
  leave(c) {
    crop = null
    c.redraw()
  },
  overlay(c, g) {
    const doc = c.doc()
    if (!doc || !crop) return
    const a = c.toScreen(crop.x, crop.y)
    const b = c.toScreen(crop.x + crop.w, crop.y + crop.h)
    const full = [c.toScreen(0, 0), c.toScreen(doc.width, doc.height)]
    g.save()
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.beginPath()
    g.rect(full[0].x, full[0].y, full[1].x - full[0].x, full[1].y - full[0].y)
    g.rect(b.x, a.y, a.x - b.x, b.y - a.y) // 반대 방향 = 구멍
    g.fill('evenodd')
    g.strokeStyle = '#fff'
    g.lineWidth = 1
    g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y))
    g.strokeStyle = 'rgba(255,255,255,0.4)'
    for (let i = 1; i < 3; i++) {
      g.beginPath()
      g.moveTo(a.x + ((b.x - a.x) * i) / 3, a.y)
      g.lineTo(a.x + ((b.x - a.x) * i) / 3, b.y)
      g.moveTo(a.x, a.y + ((b.y - a.y) * i) / 3)
      g.lineTo(b.x, a.y + ((b.y - a.y) * i) / 3)
      g.stroke()
    }
    g.fillStyle = '#fff'
    for (const [x, y] of cropHandlePts(a, b)) g.fillRect(x - 4, y - 4, 8, 8)
    g.fillStyle = '#000'
    g.font = '11px Dotum, sans-serif'
    g.fillText(`${crop.w} × ${crop.h}`, a.x + 4, a.y - 6)
    g.restore()
  },
  cursor: () => 'crosshair'
}

function cropHandlePts(a: Pt, b: Pt): [number, number, string][] {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  return [
    [a.x, a.y, 'nw'],
    [mx, a.y, 'n'],
    [b.x, a.y, 'ne'],
    [b.x, my, 'e'],
    [b.x, b.y, 'se'],
    [mx, b.y, 's'],
    [a.x, b.y, 'sw'],
    [a.x, my, 'w']
  ]
}
function cropHandle(c: ToolCtx, s: Pt): string | null {
  if (!crop) return null
  const a = c.toScreen(crop.x, crop.y)
  const b = c.toScreen(crop.x + crop.w, crop.y + crop.h)
  for (const [x, y, h] of cropHandlePts(a, b)) if (Math.abs(x - s.x) <= 6 && Math.abs(y - s.y) <= 6) return h
  return null
}
export const hasCrop = (): boolean => !!crop

// ── 그라데이션 ────────────────────────────────────────────────────────────
let grad: { a: Pt; b: Pt; drag: 'new' | 'a' | 'b' | null } | null = null

function renderGradient(doc: Doc, a: Pt, b: Pt): Doc | null {
  const l = getLayer(doc, doc.activeId)
  if (!l || l.kind !== 'pixel') return null
  const s = editor.state.settings
  const fg = editor.state.fg
  const bg = editor.state.bg
  const target = editor.state.maskEditing && l.mask ? 'mask' : 'layer'
  let c0: number[] = [...fg, 255]
  let c1: number[] = s.gradientToTransparent ? [...fg, 0] : [...bg, 255]
  if (s.gradientReverse) [c0, c1] = [c1, c0]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const len = Math.sqrt(len2)
  return editPixels(doc, l.id, target, { x: 0, y: 0, w: doc.width, h: doc.height }, (data, w, h, ox, oy) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const px = x + ox + 0.5
        const py = y + oy + 0.5
        const t = s.gradientShape === 'radial' ? Math.min(1, Math.hypot(px - a.x, py - a.y) / len) : Math.min(1, Math.max(0, ((px - a.x) * dx + (py - a.y) * dy) / len2))
        const o = (y * w + x) * 4
        const col = [0, 1, 2, 3].map((k) => c0[k] + (c1[k] - c0[k]) * t)
        if (target === 'mask') {
          const v = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]
          data[o] = data[o + 1] = data[o + 2] = v
          data[o + 3] = 255
          continue
        }
        // 투명 쪽으로 가는 그라데이션은 원래 픽셀 위에 얹는다 (source-over)
        const sa = col[3] / 255
        const da = data[o + 3] / 255
        const oa = sa + da * (1 - sa)
        for (let k = 0; k < 3; k++) data[o + k] = oa > 0 ? (col[k] * sa + data[o + k] * da * (1 - sa)) / oa : 0
        data[o + 3] = oa * 255
      }
  })
}

export const gradientTool: ToolHandler = {
  down(c, p) {
    if (grad) {
      const sa = c.toScreen(grad.a.x, grad.a.y)
      const sb = c.toScreen(grad.b.x, grad.b.y)
      if (Math.hypot(sa.x - p.s.x, sa.y - p.s.y) < 8) return void (grad.drag = 'a')
      if (Math.hypot(sb.x - p.s.x, sb.y - p.s.y) < 8) return void (grad.drag = 'b')
    }
    grad = { a: p.p, b: p.p, drag: 'new' }
  },
  move(c, p, dragging) {
    if (!dragging || !grad?.drag) return
    let q = p.p
    const from = grad.drag === 'a' ? grad.b : grad.a
    if (p.shift) {
      // 45° 단위
      const ang = Math.round(Math.atan2(q.y - from.y, q.x - from.x) / (Math.PI / 4)) * (Math.PI / 4)
      const d = Math.hypot(q.x - from.x, q.y - from.y)
      q = { x: from.x + Math.cos(ang) * d, y: from.y + Math.sin(ang) * d }
    }
    if (grad.drag === 'a') grad.a = q
    else grad.b = q
    const doc = c.doc()
    if (doc && Math.hypot(grad.b.x - grad.a.x, grad.b.y - grad.a.y) > 1) editor.set({ preview: renderGradient(doc, grad.a, grad.b) })
    c.redraw()
  },
  up(c) {
    if (grad) grad.drag = null
    if (grad && Math.hypot(grad.b.x - grad.a.x, grad.b.y - grad.a.y) < 1) {
      grad = null
      editor.set({ preview: null })
    }
    c.redraw()
  },
  commit(c) {
    const doc = c.doc()
    if (doc && grad) {
      const d = renderGradient(doc, grad.a, grad.b)
      if (d) editor.commit(d, '그라데이션')
    }
    grad = null
    editor.set({ preview: null })
    c.redraw()
  },
  cancel(c) {
    grad = null
    editor.set({ preview: null })
    c.redraw()
  },
  leave(c) {
    this.commit!(c)
  },
  key(c, e) {
    if (/^[0-9]$/.test(e.key) && grad) {
      return true
    }
    void c
    return false
  },
  overlay(c, g) {
    if (!grad) return
    const a = c.toScreen(grad.a.x, grad.a.y)
    const b = c.toScreen(grad.b.x, grad.b.y)
    g.save()
    g.strokeStyle = '#fff'
    g.lineWidth = 3
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
    g.strokeStyle = '#000'
    g.lineWidth = 1
    g.stroke()
    for (const q of [a, b]) {
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(q.x, q.y, 5, 0, Math.PI * 2)
      g.fill()
      g.stroke()
    }
    g.restore()
  },
  cursor: () => 'crosshair'
}
export const hasGradient = (): boolean => !!grad

// ── 도형 ─────────────────────────────────────────────────────────────────
let shape: { a: Pt; b: Pt } | null = null

function shapeRect(a: Pt, b: Pt, shift: boolean, alt: boolean, kind: string): R {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (shift && kind !== 'line') {
    const m = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * m
    dy = Math.sign(dy || 1) * m
  }
  if (alt) return { x: a.x - dx, y: a.y - dy, w: dx * 2, h: dy * 2 }
  return { x: a.x, y: a.y, w: dx, h: dy }
}

/** 도형 → 새 레이어 (전경색 채움 + 배경색 외곽선) */
function makeShape(doc: Doc, r: R, kind: string, shift: boolean): Doc {
  const s = editor.state.settings
  const sw = s.shapeStroke || kind === 'line' ? s.shapeStrokeWidth : 0
  const pad = Math.ceil(sw / 2) + 2
  let x0 = Math.min(r.x, r.x + r.w)
  let y0 = Math.min(r.y, r.y + r.h)
  let w = Math.abs(r.w)
  let h = Math.abs(r.h)
  if (kind === 'line' && shift) {
    // 45° 단위
    const ang = Math.round(Math.atan2(r.h, r.w) / (Math.PI / 4)) * (Math.PI / 4)
    const d = Math.hypot(r.w, r.h)
    r = { x: r.x, y: r.y, w: Math.cos(ang) * d, h: Math.sin(ang) * d }
    x0 = Math.min(r.x, r.x + r.w)
    y0 = Math.min(r.y, r.y + r.h)
    w = Math.abs(r.w)
    h = Math.abs(r.h)
  }
  const cw = Math.max(1, Math.ceil(w + pad * 2))
  const ch = Math.max(1, Math.ceil(h + pad * 2))
  const cv = new OffscreenCanvas(cw, ch)
  const g = cv.getContext('2d')!
  const fg = `rgb(${editor.state.fg.join(',')})`
  const bg = `rgb(${editor.state.bg.join(',')})`
  g.lineWidth = sw
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.beginPath()
  if (kind === 'line') {
    g.moveTo(r.x - x0 + pad, r.y - y0 + pad)
    g.lineTo(r.x + r.w - x0 + pad, r.y + r.h - y0 + pad)
    g.strokeStyle = fg
    g.stroke()
  } else {
    if (kind === 'ellipse') g.ellipse(pad + w / 2, pad + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
    else if (kind === 'roundRect') g.roundRect(pad, pad, w, h, Math.min(s.shapeRadius, w / 2, h / 2))
    else g.rect(pad, pad, w, h)
    if (s.shapeFill) {
      g.fillStyle = fg
      g.fill()
    }
    if (s.shapeStroke) {
      g.strokeStyle = bg
      g.stroke()
    }
  }
  const bmp = { width: cw, height: ch, data: g.getImageData(0, 0, cw, ch).data }
  const name = { rect: '사각형', roundRect: '둥근 사각형', ellipse: '타원', line: '선' }[kind] ?? '도형'
  return insertLayer(doc, makeLayer('pixel', name, bmp, identityTransform(cw, ch, Math.round(x0 - pad), Math.round(y0 - pad))))
}

export const shapeTool: ToolHandler = {
  down(_c, p) {
    shape = { a: p.p, b: p.p }
  },
  move(c, p, dragging) {
    if (!dragging || !shape) return
    shape.b = p.p
    ;(shape as unknown as { mods: { shift: boolean; alt: boolean } }).mods = { shift: p.shift, alt: p.alt }
    c.redraw()
  },
  up(c, p) {
    const doc = c.doc()
    const sh = shape
    shape = null
    if (!doc || !sh) return
    const kind = editor.state.settings.shapeKind
    const r = shapeRect(sh.a, p.p, p.shift, p.alt, kind)
    if (Math.abs(r.w) < 2 && Math.abs(r.h) < 2) return c.redraw()
    editor.commit(makeShape(doc, r, kind, p.shift), '도형')
    c.redraw()
  },
  key(c, e) {
    if (e.key === 'Tab' || (e.key.toLowerCase() === 'u' && e.shiftKey)) {
      const kinds = ['rect', 'roundRect', 'ellipse', 'line'] as const
      const i = kinds.indexOf(editor.state.settings.shapeKind)
      editor.setSettings({ shapeKind: kinds[(i + 1) % kinds.length] })
      c.redraw()
      return true
    }
    return false
  },
  cancel(c) {
    shape = null
    c.redraw()
  },
  overlay(c, g) {
    if (!shape) return
    const mods = (shape as unknown as { mods?: { shift: boolean; alt: boolean } }).mods ?? { shift: false, alt: false }
    const kind = editor.state.settings.shapeKind
    const r = shapeRect(shape.a, shape.b, mods.shift, mods.alt, kind)
    const a = c.toScreen(r.x, r.y)
    const b = c.toScreen(r.x + r.w, r.y + r.h)
    g.save()
    g.strokeStyle = '#2a8dd4'
    g.setLineDash([4, 3])
    g.beginPath()
    if (kind === 'line') {
      g.moveTo(a.x, a.y)
      g.lineTo(b.x, b.y)
    } else if (kind === 'ellipse') g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
    else g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    g.stroke()
    g.restore()
  },
  cursor: () => 'crosshair'
}

// ── 문자 ─────────────────────────────────────────────────────────────────
/** 편집 중인 문자 (캔버스 위 textarea 가 이 값을 보여 준다) */
export interface TextDraft {
  layerId: string | null
  box: R
  data: TextData
}
let textDrag: { a: Pt } | null = null
let textBoxPreview: R | null = null

export function startTextDraft(doc: Doc, at: Pt, box?: R): TextDraft {
  const s = editor.state.settings
  const hit = [...doc.layers].reverse().find((l) => l.kind === 'text' && l.visible && hitTransform(l.transform, at.x, at.y))
  if (hit?.text) return { layerId: hit.id, box: { x: hit.transform.x, y: hit.transform.y, w: hit.transform.width, h: hit.transform.height }, data: { ...hit.text } }
  const data: TextData = {
    ...DEFAULT_TEXT,
    text: '',
    font: s.typeFont,
    size: s.typeSize,
    bold: s.typeBold,
    italic: s.typeItalic,
    align: s.typeAlign,
    color: `#${editor.state.fg.map((v) => v.toString(16).padStart(2, '0')).join('')}`,
    boxWidth: box?.w ?? Math.max(200, s.typeSize * 8),
    boxHeight: box?.h ?? s.typeSize * 1.5
  }
  return { layerId: null, box: box ?? { x: at.x, y: at.y - s.typeSize, w: data.boxWidth, h: data.boxHeight }, data }
}

/** 편집 끝 — 빈 글이면 취소, 기존 레이어면 갱신, 아니면 새 문자 레이어 */
export function commitTextDraft(draft: TextDraft): void {
  const doc = editor.doc
  if (!doc) return
  const data = { ...draft.data, boxWidth: Math.max(10, draft.box.w), boxHeight: Math.max(10, draft.box.h) }
  if (!data.text.trim()) {
    if (draft.layerId) editor.commit({ ...doc, layers: doc.layers.filter((l) => l.id !== draft.layerId), activeId: doc.layers.find((l) => l.id !== draft.layerId)?.id ?? null }, '문자 삭제')
    return
  }
  const bmp = renderText(data)
  const t = identityTransform(bmp.width, bmp.height, Math.round(draft.box.x), Math.round(draft.box.y))
  if (draft.layerId) {
    const l = getLayer(doc, draft.layerId)
    if (!l) return
    editor.commit(updateLayer(doc, draft.layerId, { text: data, bitmap: bmp, transform: { ...t, rotation: l.transform.rotation } }), '문자 편집')
  } else editor.commit(insertLayer(doc, makeLayer('text', data.text.split('\n')[0].slice(0, 24) || '문자', bmp, t, { text: data })), '문자')
}

export const typeTool: ToolHandler & { onDraft?: (d: TextDraft | null) => void } = {
  down(c, p) {
    textDrag = { a: p.p }
    textBoxPreview = null
    void c
  },
  move(c, p, dragging) {
    if (!dragging || !textDrag) return
    textBoxPreview = { x: Math.min(textDrag.a.x, p.p.x), y: Math.min(textDrag.a.y, p.p.y), w: Math.abs(p.p.x - textDrag.a.x), h: Math.abs(p.p.y - textDrag.a.y) }
    c.redraw()
  },
  up(c, p) {
    const doc = c.doc()
    const box = textBoxPreview && textBoxPreview.w > 8 && textBoxPreview.h > 8 ? textBoxPreview : undefined
    textDrag = null
    textBoxPreview = null
    if (!doc) return
    typeTool.onDraft?.(startTextDraft(doc, p.p, box))
    c.redraw()
  },
  overlay(c, g) {
    if (!textBoxPreview) return
    const a = c.toScreen(textBoxPreview.x, textBoxPreview.y)
    const b = c.toScreen(textBoxPreview.x + textBoxPreview.w, textBoxPreview.y + textBoxPreview.h)
    g.save()
    g.strokeStyle = '#2a8dd4'
    g.setLineDash([4, 3])
    g.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y)
    g.restore()
  },
  cursor: () => 'text'
}

// ── 스포이트 ─────────────────────────────────────────────────────────────
let ring: { s: Pt; color: number[] } | null = null
function sample(c: ToolCtx, p: PointerInfo): number[] | null {
  const doc = c.doc()
  if (!doc) return null
  const px = c.renderer()?.readPixel(p.p.x, p.p.y)
  if (px) return px
  const flat = flattenDoc(doc)
  const x = Math.floor(p.p.x)
  const y = Math.floor(p.p.y)
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
  return Array.from(flat.data.slice((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4))
}
export const eyedropperTool: ToolHandler = {
  down(c, p) {
    this.move!(c, p, true)
  },
  move(c, p, dragging) {
    if (!dragging) return
    const col = sample(c, p)
    if (!col || !col[3]) return
    const rgb: [number, number, number] = [col[0], col[1], col[2]]
    if (p.alt) editor.set({ bg: rgb })
    else editor.set({ fg: rgb })
    ring = { s: p.s, color: col }
    c.redraw()
  },
  up(c) {
    ring = null
    c.redraw()
  },
  overlay(_c, g) {
    if (!ring || !editor.state.settings.sampleRing) return
    const { s, color } = ring
    g.save()
    g.lineWidth = 12
    g.strokeStyle = `rgb(${color[0]},${color[1]},${color[2]})`
    g.beginPath()
    g.arc(s.x, s.y, 34, -Math.PI, 0)
    g.stroke()
    g.strokeStyle = `rgb(${editor.state.fg.join(',')})`
    g.beginPath()
    g.arc(s.x, s.y, 34, 0, Math.PI)
    g.stroke()
    g.lineWidth = 1
    g.strokeStyle = 'rgba(0,0,0,.6)'
    g.beginPath()
    g.arc(s.x, s.y, 40, 0, Math.PI * 2)
    g.stroke()
    g.restore()
  },
  cursor: () => 'crosshair'
}

// ── 손·돋보기 ────────────────────────────────────────────────────────────
let pan: { s: Pt; px: number; py: number } | null = null
export const handTool: ToolHandler = {
  down(c, p) {
    const v = c.view()
    pan = { s: p.s, px: v.panX, py: v.panY }
  },
  move(c, p, dragging) {
    if (!dragging || !pan) return
    c.setView({ ...c.view(), panX: pan.px + p.s.x - pan.s.x, panY: pan.py + p.s.y - pan.s.y })
  },
  up() {
    pan = null
  },
  cursor: () => (pan ? 'grabbing' : 'grab')
}

let zoomDrag: { s: Pt; z: number; moved: boolean } | null = null
export function zoomAt(c: ToolCtx, s: Pt, zoom: number): void {
  const v = c.view()
  const z = Math.min(64, Math.max(0.01, zoom))
  const dx = (s.x - v.panX) / v.zoom
  const dy = (s.y - v.panY) / v.zoom
  c.setView({ zoom: z, panX: s.x - dx * z, panY: s.y - dy * z })
}
export const zoomTool: ToolHandler = {
  down(c, p) {
    zoomDrag = { s: p.s, z: c.view().zoom, moved: false }
  },
  move(c, p, dragging) {
    if (!dragging || !zoomDrag) return
    const dx = p.s.x - zoomDrag.s.x
    if (Math.abs(dx) > 3) zoomDrag.moved = true
    if (zoomDrag.moved) zoomAt(c, zoomDrag.s, zoomDrag.z * Math.pow(1.01, dx))
  },
  up(c, p) {
    if (zoomDrag && !zoomDrag.moved) zoomAt(c, p.s, c.view().zoom * (p.alt ? 1 / 1.25 : 1.25))
    zoomDrag = null
  },
  cursor: (_c, h) => (h?.alt ? 'zoom-out' : 'zoom-in')
}
