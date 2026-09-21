/**
 * 칠하기 계열 도구 — 브러시·지우개(B·E), 흐림/문지르기/리퀴파이(R), 복제 도장(S), 스팟 복구(J).
 * 출처: Compositor `BrushStroke`·`SmudgeLiquify`·`CloneStamp`·`HealPixels.c`.
 *
 * 한 획 = 칠하기 세션:
 *  1) 누르면 레이어(또는 마스크)를 문서 정렬로 굽고(pixels.bakeLayer, 문서 전체로 넓힘) 원본 사본을 떠 둔다.
 *  2) 끄는 동안 "살아 있는" 비트맵(데이터가 바뀌는 사본)을 담은 미리보기 문서를 캔버스에 띄우고, 바뀐 사각형만 GPU 로 올린다.
 *  3) 떼면 결과 비트맵으로 문서를 한 번 기록한다 (실행취소 한 칸).
 * 선택 영역이 있으면 선택 밖에는 칠해지지 않는다(선택 덮임을 곱한다).
 * 키: [ ] 크기, Shift+[ ] 경도, 1~0 불투명도(강도), Shift+클릭 = 지난 점에서 직선.
 */
import { editor } from '../editor/store'
import { bakeLayer, selWeight } from '../editor/pixels'
import { StrokeCoverage, applyStroke, tipAlpha, getLayer, updateLayer, flattenDoc, contentFill, type Doc, type Bitmap, type BrushSettings } from '@core/index'
import type { ToolHandler, ToolCtx, PointerInfo, Pt } from './types'

interface Session {
  base: Doc
  layerId: string
  target: 'layer' | 'mask'
  orig: Uint8ClampedArray
  live: Bitmap
  stroke: StrokeCoverage
  ox: number
  oy: number
  last: Pt | null
  /** 도구별 상태 */
  extra: Record<string, unknown>
  /** 이번 획이 덮은 경계 (레이어 픽셀 좌표) — 스팟 복구가 문서 전체를 훑지 않게 */
  bbox: { x: number; y: number; w: number; h: number } | null
}

const unionRect = (a: Session['bbox'], b: { x: number; y: number; w: number; h: number } | null): Session['bbox'] => {
  if (!b) return a
  if (!a) return { ...b }
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

let session: Session | null = null
let lastPoint: { p: Pt; layerId: string } | null = null
let hover: Pt | null = null
/** 복제 도장 원점 (문서 좌표) 과 정렬 오프셋 */
let cloneSource: Pt | null = null
let cloneOffset: Pt | null = null

type Kind = 'brush' | 'blur' | 'clone' | 'heal'

const gray = (c: [number, number, number]): number => Math.round(0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])

function begin(c: ToolCtx, kind: Kind, p: PointerInfo): Session | null {
  const doc = c.doc()
  if (!doc) return null
  const l = getLayer(doc, doc.activeId)
  // 마스크 편집 중이면 폴더·조정 레이어의 마스크에도 칠한다
  const onMask = !!l && editor.state.maskEditing && !!l.mask
  if (!l || (!onMask && (l.kind === 'group' || l.kind === 'adjustment'))) {
    editor.toast('info', '픽셀 레이어를 고르세요 (폴더·조정 레이어는 마스크만 칠할 수 있습니다).')
    return null
  }
  if (l.kind === 'text' && !onMask) {
    editor.toast('info', '문자 레이어에는 칠할 수 없습니다. 레이어 → 래스터화 후 칠하세요.')
    return null
  }
  const target = editor.state.maskEditing && l.mask ? 'mask' : 'layer'
  if (target === 'mask' && kind !== 'brush' && kind !== 'blur') {
    editor.toast('info', '이 도구는 마스크가 아니라 레이어 픽셀에만 씁니다.')
    return null
  }
  const base = bakeLayer(doc, l.id, { x: 0, y: 0, w: doc.width, h: doc.height })
  const bl = getLayer(base, l.id)!
  const bmp = target === 'mask' ? bl.mask!.bitmap : bl.bitmap!
  const live: Bitmap = { width: bmp.width, height: bmp.height, data: bmp.data.slice() }
  const s = editor.state.settings.brush
  const settings: BrushSettings = kind === 'blur' ? { ...s, opacity: editor.state.settings.blurStrength / 100 } : kind === 'heal' ? { ...s, opacity: 1 } : s
  const sess: Session = {
    base,
    layerId: l.id,
    target,
    orig: bmp.data,
    live,
    stroke: new StrokeCoverage(bmp.width, bmp.height, settings),
    ox: Math.round(bl.transform.x),
    oy: Math.round(bl.transform.y),
    last: null,
    extra: {},
    bbox: null
  }
  const preview = updateLayer(base, l.id, target === 'mask' ? { mask: { ...bl.mask!, bitmap: live } } : { bitmap: live })
  editor.set({ preview })
  if (kind === 'clone') {
    // 원본: 활성 레이어 자체 또는 보이는 그대로 (획 시작 때 한 번 뜬다)
    const src = editor.state.settings.cloneSampleAll ? flattenDoc(doc).data : bmp.data
    sess.extra.src = src
    sess.extra.srcAll = editor.state.settings.cloneSampleAll
    if (!cloneOffset || !editor.state.settings.cloneAligned) cloneOffset = { x: Math.round(cloneSource!.x - p.p.x), y: Math.round(cloneSource!.y - p.p.y) }
  }
  return sess
}

/** 선택 제한 (레이어 픽셀 i → 문서) */
function limitFn(s: Session): ((i: number) => number) | undefined {
  const doc = s.base
  if (!doc.selection) return undefined
  const W = s.live.width
  return (i) => selWeight(doc, (i % W) + s.ox, ((i / W) | 0) + s.oy)
}

function upload(c: ToolCtx, s: Session, r: { x: number; y: number; w: number; h: number } | null): void {
  if (!r) return
  c.renderer()?.uploadRect(s.live, r)
  c.redraw()
}

/** 브러시·지우개·마스크 칠하기 */
function strokeTo(c: ToolCtx, s: Session, p: Pt, pressure: number): void {
  s.stroke.lineTo(p.x - s.ox, p.y - s.oy, pressure)
  const r = s.stroke.takeDirty()
  if (!r) return
  const erase = editor.state.settings.brushMode === 'erase'
  const fg = editor.state.fg
  const bg = editor.state.bg
  if (s.target === 'mask') {
    const v = gray(erase ? bg : fg)
    applyStroke({ width: s.live.width, height: s.live.height, data: s.orig }, s.stroke, [v, v, v], 'paint', limitFn(s), s.live.data, r)
  } else applyStroke({ width: s.live.width, height: s.live.height, data: s.orig }, s.stroke, fg, erase ? 'erase' : 'paint', limitFn(s), s.live.data, r)
  upload(c, s, r)
}

/** 흐림 모드: 덮인 곳을 주변 평균으로 (획 덮임만큼) */
function blurDab(s: Session, cx: number, cy: number): { x: number; y: number; w: number; h: number } | null {
  const R = s.stroke.settings.size / 2
  const x0 = Math.max(0, Math.floor(cx - R))
  const y0 = Math.max(0, Math.floor(cy - R))
  const x1 = Math.min(s.live.width - 1, Math.ceil(cx + R))
  const y1 = Math.min(s.live.height - 1, Math.ceil(cy + R))
  if (x1 < x0 || y1 < y0) return null
  const W = s.live.width
  const d = s.live.data
  const src = d.slice()
  const k = Math.max(1, Math.round(R / 6)) // 흐림 반경 = 팁 크기에 비례
  const lim = limitFn(s)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const a = tipAlpha(Math.hypot(x + 0.5 - cx, y + 0.5 - cy), R, s.stroke.settings.hardness) * s.stroke.settings.opacity * (lim ? lim(y * W + x) : 1)
      if (a <= 0) continue
      let r = 0
      let g = 0
      let b = 0
      let al = 0
      let n = 0
      for (let j = -k; j <= k; j += Math.max(1, k >> 1))
        for (let i = -k; i <= k; i += Math.max(1, k >> 1)) {
          const xx = Math.min(W - 1, Math.max(0, x + i))
          const yy = Math.min(s.live.height - 1, Math.max(0, y + j))
          const o = (yy * W + xx) * 4
          const w = src[o + 3]
          r += src[o] * w
          g += src[o + 1] * w
          b += src[o + 2] * w
          al += w
          n++
        }
      const o = (y * W + x) * 4
      const na = al / n
      const t = a * 0.35
      if (al > 0) {
        d[o] += (r / al - d[o]) * t
        d[o + 1] += (g / al - d[o + 1]) * t
        d[o + 2] += (b / al - d[o + 2]) * t
      }
      d[o + 3] += (na - d[o + 3]) * t
    }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** 문지르기: 붓이 머금은 색을 옮기며 섞는다 (Compositor smudge — 머금은 사각형을 다음 점에 떨어뜨림) */
function smudgeDab(s: Session, from: Pt, to: Pt): { x: number; y: number; w: number; h: number } | null {
  const R = Math.max(1, s.stroke.settings.size / 2)
  const W = s.live.width
  const H = s.live.height
  const d = s.live.data
  const lim = limitFn(s)
  const x0 = Math.max(0, Math.floor(to.x - R))
  const y0 = Math.max(0, Math.floor(to.y - R))
  const x1 = Math.min(W - 1, Math.ceil(to.x + R))
  const y1 = Math.min(H - 1, Math.ceil(to.y + R))
  if (x1 < x0 || y1 < y0) return null
  const src = d.slice()
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const a = tipAlpha(Math.hypot(x + 0.5 - to.x, y + 0.5 - to.y), R, s.stroke.settings.hardness) * s.stroke.settings.opacity * (lim ? lim(y * W + x) : 1)
      if (a <= 0) continue
      const sx = Math.min(W - 1, Math.max(0, Math.round(x - dx)))
      const sy = Math.min(H - 1, Math.max(0, Math.round(y - dy)))
      const so = (sy * W + sx) * 4
      const o = (y * W + x) * 4
      for (let c = 0; c < 4; c++) d[o + c] += (src[so + c] - d[o + c]) * a
    }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** 리퀴파이(밀기): 붓 안 픽셀을 움직인 방향으로 민다 — 원본에서 거꾸로 표본 (Compositor push) */
function pushDab(s: Session, from: Pt, to: Pt): { x: number; y: number; w: number; h: number } | null {
  const R = Math.max(1, s.stroke.settings.size / 2)
  const W = s.live.width
  const H = s.live.height
  const d = s.live.data
  const lim = limitFn(s)
  const x0 = Math.max(0, Math.floor(to.x - R))
  const y0 = Math.max(0, Math.floor(to.y - R))
  const x1 = Math.min(W - 1, Math.ceil(to.x + R))
  const y1 = Math.min(H - 1, Math.ceil(to.y + R))
  if (x1 < x0 || y1 < y0) return null
  const src = d.slice()
  const dx = to.x - from.x
  const dy = to.y - from.y
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const a = tipAlpha(Math.hypot(x + 0.5 - to.x, y + 0.5 - to.y), R, 0) * s.stroke.settings.opacity * (lim ? lim(y * W + x) : 1)
      if (a <= 0) continue
      const sxf = x - dx * a
      const syf = y - dy * a
      const sx0 = Math.floor(sxf)
      const sy0 = Math.floor(syf)
      const fx = sxf - sx0
      const fy = syf - sy0
      const o = (y * W + x) * 4
      for (let c = 0; c < 4; c++) {
        let v = 0
        for (let j = 0; j < 2; j++)
          for (let i = 0; i < 2; i++) {
            const xx = Math.min(W - 1, Math.max(0, sx0 + i))
            const yy = Math.min(H - 1, Math.max(0, sy0 + j))
            v += src[(yy * W + xx) * 4 + c] * (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
          }
        d[o + c] = v
      }
    }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** 복제 도장: 덮임만큼 원본(오프셋 위치)을 칠한다 */
function cloneTo(c: ToolCtx, s: Session, p: Pt, pressure: number): void {
  s.stroke.lineTo(p.x - s.ox, p.y - s.oy, pressure)
  const r = s.stroke.takeDirty()
  if (!r || !cloneOffset) return
  const src = s.extra.src as Uint8ClampedArray
  const all = s.extra.srcAll as boolean
  const doc = s.base
  const W = s.live.width
  const lim = limitFn(s)
  const d = s.live.data
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x
      let a = s.stroke.cov[i] * s.stroke.settings.opacity
      if (lim) a *= lim(i)
      if (a <= 0) continue
      // 원본 좌표 (문서 → 원본 버퍼)
      const dxDoc = x + s.ox + cloneOffset.x
      const dyDoc = y + s.oy + cloneOffset.y
      const sx = all ? dxDoc : dxDoc - s.ox
      const sy = all ? dyDoc : dyDoc - s.oy
      const sw = all ? doc.width : W
      const sh = all ? doc.height : s.live.height
      if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue
      const so = (sy * sw + sx) * 4
      const o = i * 4
      const sa = (src[so + 3] / 255) * a
      const da = s.orig[o + 3] / 255
      const oa = sa + da * (1 - sa)
      if (oa <= 0) continue
      for (let k = 0; k < 3; k++) d[o + k] = (src[so + k] * sa + s.orig[o + k] * da * (1 - sa)) / oa
      d[o + 3] = oa * 255
    }
  upload(c, s, r)
}

/**
 * 스팟 복구 — Compositor `HealPixels.c`: 칠한 자리(구멍)의 테두리와 가장 비슷한 테두리를 가진 조각을 찾아 붙이고,
 * 테두리 차이를 구멍 안으로 매끈하게 퍼뜨린다(라플라스 방정식 반복 풀이). 내용 인식 모드는 패치 합성(contentFill).
 */
function heal(s: Session): { x: number; y: number; w: number; h: number } | null {
  const W = s.live.width
  const H = s.live.height
  const cov = s.stroke.cov
  const bb = s.bbox
  if (!bb) return null
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
  if (x1 < 0) return null
  const pad = Math.max(4, Math.round(s.stroke.settings.size / 3))
  const wx0 = Math.max(0, x0 - pad)
  const wy0 = Math.max(0, y0 - pad)
  const ww = Math.min(W, x1 + pad + 1) - wx0
  const wh = Math.min(H, y1 + pad + 1) - wy0
  const src = s.orig
  const out = s.live.data
  const hole = (x: number, y: number): boolean => cov[(wy0 + y) * W + wx0 + x] > 0.02
  if (editor.state.settings.healMode === 'contentAware') {
    // 주변 넓게(구멍 크기의 3배) 떼어 내용 인식 채우기
    const m = Math.max(ww, wh)
    const ax0 = Math.max(0, wx0 - m)
    const ay0 = Math.max(0, wy0 - m)
    const aw = Math.min(W, wx0 + ww + m) - ax0
    const ah = Math.min(H, wy0 + wh + m) - ay0
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
    for (let y = 0; y < ah; y++)
      for (let x = 0; x < aw; x++) {
        const a = cov[(ay0 + y) * W + ax0 + x]
        if (a <= 0) continue
        const o = ((ay0 + y) * W + ax0 + x) * 4
        const so = (y * aw + x) * 4
        for (let c = 0; c < 4; c++) out[o + c] = src[o + c] + (px[so + c] - src[o + c]) * Math.min(1, a * 1.2)
      }
    return { x: ax0, y: ay0, w: aw, h: ah }
  }
  // 근접 일치: 테두리(구멍 바깥 pad 이내)가 가장 비슷한 오프셋 찾기
  let best = { dx: ww, dy: 0 }
  let bestScore = Infinity
  const score = (dx: number, dy: number): number => {
    if (Math.abs(dx) < ww && Math.abs(dy) < wh) return Infinity
    if (wx0 + dx < 0 || wy0 + dy < 0 || wx0 + ww + dx > W || wy0 + wh + dy > H) return Infinity
    let sum = 0
    let n = 0
    for (let y = 0; y < wh; y += 2)
      for (let x = 0; x < ww; x += 2) {
        if (hole(x, y)) continue
        const t = ((wy0 + y) * W + wx0 + x) * 4
        const q = ((wy0 + y + dy) * W + wx0 + x + dx) * 4
        for (let c = 0; c < 3; c++) {
          const d = src[t + c] - src[q + c]
          sum += d * d
        }
        n++
      }
    return n ? sum / n : Infinity
  }
  for (let k = 0; k < 400; k++) {
    const ang = Math.random() * Math.PI * 2
    const dist = Math.max(ww, wh) * (1 + Math.random() * 2)
    const dx = Math.round(Math.cos(ang) * dist)
    const dy = Math.round(Math.sin(ang) * dist)
    const sc = score(dx, dy)
    if (sc < bestScore) {
      bestScore = sc
      best = { dx, dy }
    }
  }
  if (!Number.isFinite(bestScore)) return null
  // 조각 + 테두리 차이의 매끈한 보간 (Jacobi)
  const diff = new Float32Array(ww * wh * 3)
  const fixed = new Uint8Array(ww * wh)
  for (let y = 0; y < wh; y++)
    for (let x = 0; x < ww; x++) {
      const i = y * ww + x
      const t = ((wy0 + y) * W + wx0 + x) * 4
      const q = ((wy0 + y + best.dy) * W + wx0 + x + best.dx) * 4
      if (!hole(x, y)) {
        fixed[i] = 1
        for (let c = 0; c < 3; c++) diff[i * 3 + c] = src[t + c] - src[q + c]
      }
    }
  for (let it = 0; it < 300; it++)
    for (let y = 1; y < wh - 1; y++)
      for (let x = 1; x < ww - 1; x++) {
        const i = y * ww + x
        if (fixed[i]) continue
        for (let c = 0; c < 3; c++) diff[i * 3 + c] = (diff[(i - 1) * 3 + c] + diff[(i + 1) * 3 + c] + diff[(i - ww) * 3 + c] + diff[(i + ww) * 3 + c]) / 4
      }
  for (let y = 0; y < wh; y++)
    for (let x = 0; x < ww; x++) {
      const i = y * ww + x
      const a = cov[(wy0 + y) * W + wx0 + x]
      if (a <= 0) continue
      const o = ((wy0 + y) * W + wx0 + x) * 4
      const q = ((wy0 + y + best.dy) * W + wx0 + x + best.dx) * 4
      for (let c = 0; c < 3; c++) out[o + c] = src[o + c] + (src[q + c] + diff[i * 3 + c] - src[o + c]) * a
    }
  return { x: wx0, y: wy0, w: ww, h: wh }
}

function finish(label: string): void {
  const s = session
  session = null
  if (!s) return
  const l = getLayer(s.base, s.layerId)!
  const bitmap: Bitmap = { width: s.live.width, height: s.live.height, data: s.live.data.slice() }
  const doc = updateLayer(s.base, s.layerId, s.target === 'mask' ? { mask: { ...l.mask!, bitmap } } : { bitmap })
  editor.set({ preview: null })
  editor.commit(doc, label)
  lastPoint = { p: s.last ?? { x: 0, y: 0 }, layerId: s.layerId }
}

const sizeKeys = (c: ToolCtx, e: KeyboardEvent, kind: Kind): boolean => {
  const st = editor.state.settings
  const b = st.brush
  if (e.key === '[' || e.key === ']') {
    const up = e.key === ']'
    if (e.shiftKey) editor.setSettings({ brush: { ...b, hardness: Math.min(1, Math.max(0, b.hardness + (up ? 0.25 : -0.25))) } })
    else editor.setSettings({ brush: { ...b, size: Math.max(1, Math.min(5000, Math.round(b.size * (up ? 1.2 : 1 / 1.2)) + (up ? 1 : -1))) } })
    c.redraw()
    return true
  }
  if (/^[0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey) {
    const v = e.key === '0' ? 1 : Number(e.key) / 10
    if (kind === 'blur') editor.setSettings({ blurStrength: Math.round(v * 100) })
    else editor.setSettings({ brush: { ...b, opacity: v } })
    return true
  }
  if (kind === 'brush' && (e.key === 'x' || e.key === 'X') && !e.ctrlKey) {
    editor.set({ fg: editor.state.bg, bg: editor.state.fg })
    return true
  }
  return false
}

function brushLike(kind: Kind): ToolHandler {
  return {
    down(c, p) {
      if (kind === 'clone' && p.alt) {
        cloneSource = { x: Math.round(p.p.x), y: Math.round(p.p.y) }
        cloneOffset = null
        editor.toast('info', '복제 원점을 정했습니다. 이제 칠하세요.')
        c.redraw()
        return
      }
      if (kind === 'clone' && !cloneSource) {
        editor.toast('info', 'Alt+클릭으로 복제할 원점을 먼저 정하세요.')
        return
      }
      session = begin(c, kind, p)
      if (!session) return
      const s = session
      // Shift+클릭 = 지난 점에서 직선 (같은 레이어일 때)
      if (p.shift && lastPoint && lastPoint.layerId === s.layerId && kind !== 'heal') {
        s.stroke.lineTo(lastPoint.p.x - s.ox, lastPoint.p.y - s.oy)
        s.stroke.takeDirty()
        s.stroke.cov.fill(0)
      }
      this.move!(c, p, true)
    },
    move(c, p, dragging) {
      hover = p.p
      if (!dragging || !session) {
        c.redraw()
        return
      }
      const s = session
      const pr = p.e.pointerType === 'pen' ? Math.max(0.1, p.pressure) : 1
      if (kind === 'brush') strokeTo(c, s, p.p, pr)
      else if (kind === 'clone') cloneTo(c, s, p.p, pr)
      else if (kind === 'heal') {
        s.stroke.lineTo(p.p.x - s.ox, p.p.y - s.oy, pr)
        s.bbox = unionRect(s.bbox, s.stroke.takeDirty())
        c.redraw()
      } else {
        const mode = editor.state.settings.blurMode
        const cur = { x: p.p.x - s.ox, y: p.p.y - s.oy }
        const prev = s.last ? { x: s.last.x - s.ox, y: s.last.y - s.oy } : cur
        const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y)
        const step = Math.max(1, s.stroke.settings.size * (mode === 'smudge' ? 0.08 : 0.025))
        const n = Math.max(1, Math.ceil(dist / step))
        let r: { x: number; y: number; w: number; h: number } | null = null
        let a = prev
        for (let i = 1; i <= n; i++) {
          const b = { x: prev.x + ((cur.x - prev.x) * i) / n, y: prev.y + ((cur.y - prev.y) * i) / n }
          const rr = mode === 'blur' ? blurDab(s, b.x, b.y) : mode === 'smudge' ? smudgeDab(s, a, b) : pushDab(s, a, b)
          if (rr) r = r ? { x: Math.min(r.x, rr.x), y: Math.min(r.y, rr.y), w: Math.max(r.x + r.w, rr.x + rr.w) - Math.min(r.x, rr.x), h: Math.max(r.y + r.h, rr.y + rr.h) - Math.min(r.y, rr.y) } : rr
          a = b
        }
        upload(c, s, r)
      }
      s.last = p.p
    },
    up(c) {
      if (!session) return
      if (kind === 'heal') {
        const r = heal(session)
        if (r) c.renderer()?.uploadRect(session.live, r)
      }
      const erase = editor.state.settings.brushMode === 'erase'
      finish(
        kind === 'brush'
          ? session.target === 'mask'
            ? '마스크 칠하기'
            : erase
              ? '지우개'
              : '브러시'
          : kind === 'clone'
            ? '복제 도장'
            : kind === 'heal'
              ? '스팟 복구'
              : { blur: '흐림', smudge: '문지르기', liquify: '리퀴파이' }[editor.state.settings.blurMode]
      )
      c.redraw()
    },
    cancel(c) {
      if (session) {
        session = null
        editor.set({ preview: null })
        c.redraw()
      }
    },
    key(c, e) {
      return sizeKeys(c, e, kind)
    },
    overlay(c, g) {
      if (!hover) return
      const v = c.view()
      const s = c.toScreen(hover.x, hover.y)
      const R = (editor.state.settings.brush.size / 2) * v.zoom
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
      if (kind === 'clone' && cloneSource) {
        const src = cloneOffset ? c.toScreen(hover.x + cloneOffset.x, hover.y + cloneOffset.y) : c.toScreen(cloneSource.x, cloneSource.y)
        g.strokeStyle = '#ff2fd1'
        g.beginPath()
        g.moveTo(src.x - 8, src.y)
        g.lineTo(src.x + 8, src.y)
        g.moveTo(src.x, src.y - 8)
        g.lineTo(src.x, src.y + 8)
        g.stroke()
      }
      if (kind === 'heal' && session) {
        // 칠한 구멍을 반투명 빨강으로
        const sw = session.live.width
        const bb = session.bbox
        g.fillStyle = 'rgba(255,40,40,0.35)'
        const step = Math.max(1, Math.round(2 / v.zoom))
        if (bb)
          for (let y = bb.y; y < Math.min(session.live.height, bb.y + bb.h); y += step)
            for (let x = bb.x; x < Math.min(sw, bb.x + bb.w); x += step)
              if (session.stroke.cov[y * sw + x] > 0.1) {
                const q = c.toScreen(x + session.ox, y + session.oy)
                g.fillRect(q.x, q.y, Math.max(1, v.zoom * step), Math.max(1, v.zoom * step))
              }
      }
      g.restore()
    },
    cursor: () => 'none'
  }
}

export const brushTool = brushLike('brush')
export const blurTool = brushLike('blur')
export const cloneTool = brushLike('clone')
export const healTool = brushLike('heal')

export function isPainting(): boolean {
  return !!session
}
export function clearHover(): void {
  hover = null
}
