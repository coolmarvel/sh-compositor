/**
 * 픽셀 명령 — 채우기·지우기·선 그리기·내용 인식 채우기·붓질·그라데이션·리터칭(흐림·문지르기·리퀴파이)·복제 도장·스팟 복구.
 * 포인터 UI 의 획은 점 배열 한 번으로 받는다 (붓 자국마다 요청하지 않는다 — plans/0004 §3).
 */
import type { Doc, Bitmap } from '../../core/doc/types'
import { getLayer, updateLayer } from '../../core/doc/ops'
import { bakeLayer, editPixels, fillSelection, eraseSelection, selWeight } from '../../core/doc/pixels'
import { StrokeCoverage, applyStroke, DEFAULT_BRUSH, type BrushSettings } from '../../core/doc/brush'
import { blurDab, smudgeDab, pushDab } from '../../core/retouch'
import { selectionStrokeCoverage } from '../../core/doc/selection'
import { contentFill } from '../../core/contentfill'
import { flattenDoc } from '../../core/doc/render'
import { MAX_SIDE } from '../../core/limits'
import { invalid } from '../errors'
import { object, onlyKeys, int, num, bool, oneOf, id, type Obj } from '../validate'
import type { DocCommand } from './types'
import { pixelLayer, maskLayer, colorOf, points, type Pt } from './types'

const gray = (c: [number, number, number]): number => Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])

/** 붓 설정 입력 */
export function brushOf(o: Obj, key = 'brush'): BrushSettings {
  if (o[key] === undefined) return DEFAULT_BRUSH
  const b = object(o[key], key)
  onlyKeys(b, ['size', 'hardness', 'opacity', 'pressureSize', 'pressureOpacity'], key)
  return {
    size: num(b, 'size', 1, 5000, DEFAULT_BRUSH.size)!,
    hardness: num(b, 'hardness', 0, 1, DEFAULT_BRUSH.hardness)!,
    opacity: num(b, 'opacity', 0, 1, DEFAULT_BRUSH.opacity)!,
    pressureSize: bool(b, 'pressureSize', DEFAULT_BRUSH.pressureSize)!,
    pressureOpacity: bool(b, 'pressureOpacity', DEFAULT_BRUSH.pressureOpacity)!
  }
}

/** 붓질 세션: 레이어를 문서 크기로 굽고 사본을 만든다 (편집기 `tools/paint.ts begin` 과 같은 규칙) */
function session(doc: Doc, layerId: string, target: 'layer' | 'mask', brush: BrushSettings, what: string) {
  const l = target === 'mask' ? maskLayer(doc, layerId) : pixelLayer(doc, layerId, what)
  const base = bakeLayer(doc, l.id, { x: 0, y: 0, w: doc.width, h: doc.height })
  const bl = getLayer(base, l.id)!
  const bmp = target === 'mask' ? bl.mask!.bitmap : bl.bitmap!
  const live: Bitmap = { width: bmp.width, height: bmp.height, data: bmp.data.slice() }
  const ox = Math.round(bl.transform.x)
  const oy = Math.round(bl.transform.y)
  const limit = base.selection ? (i: number) => selWeight(base, (i % live.width) + ox, ((i / live.width) | 0) + oy) : undefined
  const finish = (): Doc => {
    if (target === 'layer' && bl.lock?.alpha) for (let i = 3; i < live.data.length; i += 4) live.data[i] = bmp.data[i]
    return updateLayer(base, l.id, target === 'mask' ? { mask: { ...bl.mask!, bitmap: live } } : { bitmap: live, shape: undefined })
  }
  return { l, base, bl, orig: bmp, live, ox, oy, limit, stroke: new StrokeCoverage(bmp.width, bmp.height, brush), finish }
}

const strokeArgs = (o: Obj, withPressure: boolean): { layerId: string; pts: Pt[]; brush: BrushSettings } => ({
  layerId: id(o, 'layerId'),
  pts: points(o, 'points', 1, 5000, withPressure),
  brush: brushOf(o)
})

// ── pixels.fill / pixels.erase ──
export interface FillInput {
  layerId: string
  color: [number, number, number]
  target: 'layer' | 'mask'
}
export const fillCommand: DocCommand<FillInput> = {
  name: 'pixels.fill',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'color', 'target'])
    return { layerId: id(o, 'layerId'), color: colorOf(o, 'color'), target: oneOf(o, 'target', ['layer', 'mask'] as const, 'layer')! }
  },
  run(doc, i) {
    const l = i.target === 'mask' ? maskLayer(doc, i.layerId) : pixelLayer(doc, i.layerId, '채우기')
    return {
      doc: fillSelection(doc, l.id, i.color, i.target),
      label: i.target === 'mask' ? '마스크 채우기' : '채우기',
      summary: `"${l.name}" ${doc.selection ? '선택 영역' : '전체'} 채움`,
      warnings: []
    }
  }
}
export const eraseCommand: DocCommand<{ layerId: string }> = {
  name: 'pixels.erase',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId'])
    return { layerId: id(o, 'layerId') }
  },
  run(doc, i) {
    const l = pixelLayer(doc, i.layerId, '지우기')
    if (!doc.selection) throw invalid('지울 영역을 먼저 선택하세요. 레이어를 통째로 지우려면 layer.delete 를 쓰세요.')
    return { doc: eraseSelection(doc, l.id), label: '픽셀 지우기', summary: `"${l.name}" 선택 영역 지움`, warnings: [] }
  }
}

// ── pixels.strokeSelection ──
export interface StrokeSelInput {
  layerId: string
  width: number
  color: [number, number, number]
  position: 'inside' | 'center' | 'outside'
  opacity: number
}
export const strokeSelectionCommand: DocCommand<StrokeSelInput> = {
  name: 'pixels.strokeSelection',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'width', 'color', 'position', 'opacity'])
    return {
      layerId: id(o, 'layerId'),
      width: num(o, 'width', 1, 500),
      color: colorOf(o, 'color'),
      position: oneOf(o, 'position', ['inside', 'center', 'outside'] as const, 'center')!,
      opacity: num(o, 'opacity', 0, 1, 1)!
    }
  },
  run(doc, i) {
    const l = pixelLayer(doc, i.layerId, '선 그리기')
    if (!doc.selection?.bounds) throw invalid('선을 그릴 영역을 먼저 선택하세요.')
    const cov = selectionStrokeCoverage(doc.selection, i.width, i.position)
    const b = doc.selection.bounds
    const m = Math.ceil(i.width) + 2
    const out = editPixels({ ...doc, selection: null }, l.id, 'layer', { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, (px, w, h, ox, oy) => {
      for (let y = 0; y < h; y++) {
        const dy = y + oy
        if (dy < 0 || dy >= doc.height) continue
        for (let x = 0; x < w; x++) {
          const dx = x + ox
          if (dx < 0 || dx >= doc.width) continue
          const a = cov[dy * doc.width + dx] * i.opacity
          if (a <= 0) continue
          const k = (y * w + x) * 4
          const da = px[k + 3] / 255
          const oa = a + da * (1 - a)
          for (let c = 0; c < 3; c++) px[k + c] = (i.color[c] * a + px[k + c] * da * (1 - a)) / oa
          px[k + 3] = oa * 255
        }
      }
    })
    return { doc: { ...out, selection: doc.selection }, label: '선 그리기', summary: `"${l.name}" 선택 테두리 ${i.width}px`, warnings: [] }
  }
}

// ── pixels.contentFill ──
export const contentFillCommand: DocCommand<{ layerId: string }> = {
  name: 'pixels.contentFill',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId'])
    return { layerId: id(o, 'layerId') }
  },
  run(doc, i) {
    const l = pixelLayer(doc, i.layerId, '내용 인식 채우기')
    if (!doc.selection?.bounds) throw invalid('채울 영역을 먼저 선택하세요.')
    const out = editPixels(doc, l.id, 'layer', { x: 0, y: 0, w: doc.width, h: doc.height }, (px, w, h, ox, oy) => {
      const target = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) target[y * w + x] = selWeight(doc, x + ox, y + oy) > 0.5 ? 1 : 0
      if (!contentFill(px, target, w, h)) throw invalid('원본으로 쓸 불투명 픽셀이 없습니다.')
    })
    return { doc: { ...out, selection: doc.selection }, label: '내용 인식 채우기', summary: `"${l.name}" 선택 영역을 주변으로 채움`, warnings: [] }
  }
}

// ── brush.stroke ──
export interface BrushStrokeInput {
  layerId: string
  pts: Pt[]
  brush: BrushSettings
  mode: 'paint' | 'erase'
  color: [number, number, number]
  target: 'layer' | 'mask'
}
export const brushStrokeCommand: DocCommand<BrushStrokeInput> = {
  name: 'brush.stroke',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'points', 'brush', 'mode', 'color', 'target'])
    return {
      ...strokeArgs(o, true),
      mode: oneOf(o, 'mode', ['paint', 'erase'] as const, 'paint')!,
      color: colorOf(o, 'color', '#000000'),
      target: oneOf(o, 'target', ['layer', 'mask'] as const, 'layer')!
    }
  },
  run(doc, i) {
    const s = session(doc, i.layerId, i.target, i.brush, '칠하기')
    for (const p of i.pts) s.stroke.lineTo(p.x - s.ox, p.y - s.oy, p.pressure ?? 1)
    const r = s.stroke.takeDirty()
    if (r) {
      if (i.target === 'mask') {
        // 마스크: 지우기 = 검정(가림), 칠하기 = 색의 밝기 (편집기와 같은 규칙)
        const v = i.mode === 'erase' ? 0 : gray(i.color)
        applyStroke({ width: s.live.width, height: s.live.height, data: s.orig.data }, s.stroke, [v, v, v], 'paint', s.limit, s.live.data, r)
      } else applyStroke({ width: s.live.width, height: s.live.height, data: s.orig.data }, s.stroke, i.color, i.mode, s.limit, s.live.data, r)
    }
    return { doc: s.finish(), label: i.mode === 'erase' ? '지우개' : '브러시', summary: `"${s.l.name}" 점 ${i.pts.length}개 획 (${i.brush.size}px)`, warnings: [] }
  }
}

// ── gradient.apply ──
export interface GradientInput {
  layerId: string
  from: Pt
  to: Pt
  shape: 'linear' | 'radial'
  color: [number, number, number]
  /** 없으면 투명으로 */
  endColor: [number, number, number] | null
  reverse: boolean
  target: 'layer' | 'mask'
}
export const gradientCommand: DocCommand<GradientInput> = {
  name: 'gradient.apply',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'from', 'to', 'shape', 'color', 'endColor', 'reverse', 'target'])
    const [from] = points({ p: [o.from] }, 'p', 1, 1)
    const [to] = points({ p: [o.to] }, 'p', 1, 1)
    return {
      layerId: id(o, 'layerId'),
      from,
      to,
      shape: oneOf(o, 'shape', ['linear', 'radial'] as const, 'linear')!,
      color: colorOf(o, 'color'),
      endColor: o.endColor === null || o.endColor === undefined ? null : colorOf(o, 'endColor'),
      reverse: bool(o, 'reverse', false)!,
      target: oneOf(o, 'target', ['layer', 'mask'] as const, 'layer')!
    }
  },
  run(doc, i) {
    const l = i.target === 'mask' ? maskLayer(doc, i.layerId) : pixelLayer(doc, i.layerId, '그라데이션')
    if (Math.hypot(i.to.x - i.from.x, i.to.y - i.from.y) < 1) throw invalid('from 과 to 가 너무 가깝습니다.')
    let c0: number[] = [...i.color, 255]
    let c1: number[] = i.endColor ? [...i.endColor, 255] : [...i.color, 0]
    if (i.reverse) [c0, c1] = [c1, c0]
    const dx = i.to.x - i.from.x
    const dy = i.to.y - i.from.y
    const len2 = dx * dx + dy * dy
    const len = Math.sqrt(len2)
    const out = editPixels(doc, l.id, i.target, { x: 0, y: 0, w: doc.width, h: doc.height }, (data, w, h, ox, oy) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const px = x + ox + 0.5
          const py = y + oy + 0.5
          const t = i.shape === 'radial' ? Math.min(1, Math.hypot(px - i.from.x, py - i.from.y) / len) : Math.min(1, Math.max(0, ((px - i.from.x) * dx + (py - i.from.y) * dy) / len2))
          const o = (y * w + x) * 4
          const col = [0, 1, 2, 3].map((k) => c0[k] + (c1[k] - c0[k]) * t)
          if (i.target === 'mask') {
            const v = 0.299 * col[0] + 0.587 * col[1] + 0.114 * col[2]
            data[o] = data[o + 1] = data[o + 2] = v
            data[o + 3] = 255
            continue
          }
          const sa = col[3] / 255
          const da = data[o + 3] / 255
          const oa = sa + da * (1 - sa)
          for (let k = 0; k < 3; k++) data[o + k] = oa > 0 ? (col[k] * sa + data[o + k] * da * (1 - sa)) / oa : 0
          data[o + 3] = oa * 255
        }
    })
    return { doc: out, label: '그라데이션', summary: `"${l.name}" ${i.shape} 그라데이션`, warnings: [] }
  }
}

// ── retouch.stroke ──
export interface RetouchInput {
  layerId: string
  pts: Pt[]
  brush: BrushSettings
  mode: 'blur' | 'smudge' | 'liquify'
  strength: number
  target: 'layer' | 'mask'
}
export const retouchCommand: DocCommand<RetouchInput> = {
  name: 'retouch.stroke',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'points', 'brush', 'mode', 'strength', 'target'])
    return {
      ...strokeArgs(o, false),
      mode: oneOf(o, 'mode', ['blur', 'smudge', 'liquify'] as const),
      strength: num(o, 'strength', 1, 100, 50)!,
      target: oneOf(o, 'target', ['layer', 'mask'] as const, 'layer')!
    }
  },
  run(doc, i) {
    const brush = { ...i.brush, opacity: i.strength / 100 }
    const s = session(doc, i.layerId, i.target, brush, '리터칭')
    const rs = { live: s.live, stroke: s.stroke, limit: s.limit }
    let prev = { x: i.pts[0].x - s.ox, y: i.pts[0].y - s.oy }
    const step = Math.max(1, brush.size * (i.mode === 'smudge' ? 0.08 : 0.025))
    // 편집기 `tools/paint.ts` 의 흐림 획과 같은 간격·순서 (TS 기준 커널 — WASM 과 최대 1바이트 차이)
    for (const p of i.pts) {
      const cur = { x: p.x - s.ox, y: p.y - s.oy }
      const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y)
      const n = Math.max(1, Math.ceil(dist / step))
      let a = prev
      for (let k = 1; k <= n; k++) {
        const b = { x: prev.x + ((cur.x - prev.x) * k) / n, y: prev.y + ((cur.y - prev.y) * k) / n }
        if (i.mode === 'blur') blurDab(rs, b.x, b.y)
        else if (i.mode === 'smudge') smudgeDab(rs, a, b)
        else pushDab(rs, a, b)
        a = b
      }
      prev = cur
    }
    const label = { blur: '흐림', smudge: '문지르기', liquify: '리퀴파이' }[i.mode]
    return { doc: s.finish(), label, summary: `"${s.l.name}" ${label} 점 ${i.pts.length}개`, warnings: [] }
  }
}

// ── clone.stroke ──
export interface CloneInput {
  layerId: string
  pts: Pt[]
  brush: BrushSettings
  source: Pt
  sampleAll: boolean
}
export const cloneCommand: DocCommand<CloneInput> = {
  name: 'clone.stroke',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'points', 'brush', 'source', 'sampleAll'])
    const [source] = points({ p: [o.source] }, 'p', 1, 1)
    return { ...strokeArgs(o, true), source, sampleAll: bool(o, 'sampleAll', false)! }
  },
  run(doc, i) {
    const s = session(doc, i.layerId, 'layer', i.brush, '복제 도장')
    const all = i.sampleAll
    const src = all ? flattenDoc(doc).data : s.orig.data
    const off = { x: Math.round(i.source.x - i.pts[0].x), y: Math.round(i.source.y - i.pts[0].y) }
    for (const p of i.pts) s.stroke.lineTo(p.x - s.ox, p.y - s.oy, p.pressure ?? 1)
    const r = s.stroke.takeDirty()
    if (r) {
      const W = s.live.width
      const d = s.live.data
      const sw = all ? doc.width : W
      const sh = all ? doc.height : s.live.height
      for (let y = r.y; y < r.y + r.h; y++)
        for (let x = r.x; x < r.x + r.w; x++) {
          const k = y * W + x
          let a = s.stroke.cov[k] * i.brush.opacity
          if (s.limit) a *= s.limit(k)
          if (a <= 0) continue
          const dxDoc = x + s.ox + off.x
          const dyDoc = y + s.oy + off.y
          const sx = all ? dxDoc : dxDoc - s.ox
          const sy = all ? dyDoc : dyDoc - s.oy
          if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue
          const so = (sy * sw + sx) * 4
          const o = k * 4
          const sa = (src[so + 3] / 255) * a
          const da = s.orig.data[o + 3] / 255
          const oa = sa + da * (1 - sa)
          if (oa <= 0) continue
          for (let c = 0; c < 3; c++) d[o + c] = (src[so + c] * sa + s.orig.data[o + c] * da * (1 - sa)) / oa
          d[o + 3] = oa * 255
        }
    }
    return { doc: s.finish(), label: '복제 도장', summary: `"${s.l.name}" 원본 (${i.source.x}, ${i.source.y}) 에서 점 ${i.pts.length}개`, warnings: [] }
  }
}

// ── heal.stroke (내용 인식 모드 — 결정적) ──
export interface HealInput {
  layerId: string
  pts: Pt[]
  brush: BrushSettings
}
export const healCommand: DocCommand<HealInput> = {
  name: 'heal.stroke',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'points', 'brush'])
    return strokeArgs(o, true)
  },
  run(doc, i) {
    const s = session(doc, i.layerId, 'layer', { ...i.brush, opacity: 1 }, '스팟 복구')
    for (const p of i.pts) s.stroke.lineTo(p.x - s.ox, p.y - s.oy, p.pressure ?? 1)
    const bb = s.stroke.takeDirty()
    if (!bb) throw invalid('칠한 곳이 레이어 밖입니다.')
    const W = s.live.width
    const H = s.live.height
    const cov = s.stroke.cov
    let x0 = W
    let y0 = H
    let x1 = -1
    let y1 = -1
    for (let y = bb.y; y < Math.min(H, bb.y + bb.h); y++)
      for (let x = bb.x; x < Math.min(W, bb.x + bb.w); x++)
        if (cov[y * W + x] > 0.02) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) throw invalid('칠한 곳이 레이어 밖입니다.')
    const pad = Math.max(4, Math.round(i.brush.size / 3))
    const wx0 = Math.max(0, x0 - pad)
    const wy0 = Math.max(0, y0 - pad)
    const ww = Math.min(W, x1 + pad + 1) - wx0
    const wh = Math.min(H, y1 + pad + 1) - wy0
    const m = Math.max(ww, wh)
    const ax0 = Math.max(0, wx0 - m)
    const ay0 = Math.max(0, wy0 - m)
    const aw = Math.min(W, wx0 + ww + m) - ax0
    const ah = Math.min(H, wy0 + wh + m) - ay0
    const src = s.orig.data
    const px = new Uint8ClampedArray(aw * ah * 4)
    const target = new Uint8Array(aw * ah)
    for (let y = 0; y < ah; y++)
      for (let x = 0; x < aw; x++) {
        const o = ((ay0 + y) * W + ax0 + x) * 4
        px.set(src.subarray(o, o + 4), (y * aw + x) * 4)
        if (cov[(ay0 + y) * W + ax0 + x] > 0.02) {
          target[y * aw + x] = 1
          px[(y * aw + x) * 4 + 3] = 0
        }
      }
    contentFill(px, target, aw, ah)
    const out = s.live.data
    for (let y = 0; y < ah; y++)
      for (let x = 0; x < aw; x++) {
        let a = cov[(ay0 + y) * W + ax0 + x]
        if (a <= 0) continue
        if (s.limit) a *= s.limit((ay0 + y) * W + ax0 + x)
        const o = ((ay0 + y) * W + ax0 + x) * 4
        const so = (y * aw + x) * 4
        for (let c = 0; c < 4; c++) out[o + c] = src[o + c] + (px[so + c] - src[o + c]) * Math.min(1, a * 1.2)
      }
    return { doc: s.finish(), label: '스팟 복구', summary: `"${s.l.name}" 점 ${i.pts.length}개 복구`, warnings: [] }
  }
}

export { MAX_SIDE, int }
