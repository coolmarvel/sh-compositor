/**
 * 레이어 픽셀 편집 공용 — 칠하기·채우기·지우기·보정·필터·잘라내기가 전부 여기를 거친다.
 *
 * 규약: 픽셀을 바꾸기 전에 레이어를 **문서에 1:1 로 정렬된 비트맵**(회전·크기·반전 없음, 정수 위치)으로 굽는다
 * (`bakeLayer`). 그러면 레이어 픽셀 (x, y) = 문서 (x + tx, y + ty) 라서 선택 마스크·브러시 좌표를 바로 쓸 수 있다.
 * 이동·변형은 비파괴로 남고, 칠하는 순간 한 번 래스터화된다 — Photoshop 이 스마트 오브젝트에 칠할 때 래스터화하는 것과 같다.
 * (Compositor 는 변형된 레이어에도 역변환으로 칠한다. 우리는 단순함·정확도를 택했다 — guides/pixels.md)
 */
// 모듈을 직접 import 한다 — core/index 는 psd(ag-psd·캔버스)까지 끌어와 서버 번들에 들어간다
import { getLayer, updateLayer, insertLayer, makeLayer } from './ops'
import { isIdentityPlacement, identityTransform } from './transform'
import { rasterizeBitmap } from './render'
import { cropBitmap } from './bitmap'
import { applyAdjustments, hasAdjust, type Adjustments } from '../adjust'
import { applyFilters, hasFilters, type Filters } from '../filters'
import type { Doc, Bitmap, Layer } from './types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const clipToDoc = (r: Rect, doc: Doc): Rect => {
  const x = Math.max(0, Math.floor(r.x))
  const y = Math.max(0, Math.floor(r.y))
  return { x, y, w: Math.max(0, Math.min(doc.width, Math.ceil(r.x + r.w)) - x), h: Math.max(0, Math.min(doc.height, Math.ceil(r.y + r.h)) - y) }
}

/**
 * 레이어를 문서 정렬 비트맵으로 (+ cover 사각형까지 넓힘). 이미 정렬돼 있고 cover 안이면 그대로.
 * 마스크는 레이어와 같은 모양으로 함께 굽는다.
 */
export function bakeLayer(doc: Doc, id: string, cover?: Rect): Doc {
  const l = getLayer(doc, id)
  if (!l || l.kind === 'group' || l.kind === 'adjustment') return doc
  const bmp = l.bitmap ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) }
  const t = l.transform
  const aligned = !!l.bitmap && isIdentityPlacement(t, bmp.width, bmp.height)
  const cur: Rect = aligned ? { x: t.x, y: t.y, w: bmp.width, h: bmp.height } : clipToDoc({ x: 0, y: 0, w: doc.width, h: doc.height }, doc)
  const want = cover ? (aligned ? union(cur, clipToDoc(cover, doc)) : clipToDoc(union(cur, cover), doc)) : cur
  if (aligned && want.x === cur.x && want.y === cur.y && want.w === cur.w && want.h === cur.h) return doc
  const place = (b: Bitmap | null): Bitmap => {
    const out = new Uint8ClampedArray(want.w * want.h * 4)
    if (!b) return { width: want.w, height: want.h, data: out }
    if (aligned) {
      for (let y = 0; y < b.height; y++) {
        const ty = cur.y - want.y + y
        if (ty < 0 || ty >= want.h) continue
        out.set(b.data.subarray(y * b.width * 4, (y + 1) * b.width * 4), (ty * want.w + (cur.x - want.x)) * 4)
      }
      return { width: want.w, height: want.h, data: out }
    }
    const r = rasterizeBitmap(b, l, doc.width, doc.height)
    if (r)
      for (let y = 0; y < r.height; y++) {
        const ty = r.y - want.y + y
        if (ty < 0 || ty >= want.h) continue
        const tx = r.x - want.x
        for (let x = 0; x < r.width; x++) {
          if (tx + x < 0 || tx + x >= want.w) continue
          const s = (y * r.width + x) * 4
          out.set(r.data.subarray(s, s + 4), (ty * want.w + tx + x) * 4)
        }
      }
    return { width: want.w, height: want.h, data: out }
  }
  // 마스크: 굽혀지는 동안 비어 있던 곳은 "보임"(흰색)
  const mask = l.mask
    ? (() => {
        const m = place(l.mask.bitmap)
        if (aligned) {
          for (let y = 0; y < want.h; y++)
            for (let x = 0; x < want.w; x++) {
              const inside = x + want.x >= cur.x && x + want.x < cur.x + cur.w && y + want.y >= cur.y && y + want.y < cur.y + cur.h
              if (!inside) m.data.set([255, 255, 255, 255], (y * want.w + x) * 4)
            }
        }
        return { ...l.mask, bitmap: m }
      })()
    : null
  return updateLayer(doc, id, { bitmap: place(l.bitmap), mask, transform: identityTransform(want.w, want.h, want.x, want.y) })
}

/** 잠금 안내 — 막혔으면 true (알림을 띄운다) */
export function pixelsLocked(l: Layer | null | undefined, notify: (m: string) => void): boolean {
  if (l?.lock?.pixels) {
    notify(`"${l.name}" 레이어는 픽셀이 잠겨 있습니다. 레이어 패널의 자물쇠를 풀고 다시 하세요.`)
    return true
  }
  return false
}
export function positionLocked(l: Layer | null | undefined, notify: (m: string) => void): boolean {
  if (l?.lock?.position) {
    notify(`"${l.name}" 레이어는 위치가 잠겨 있습니다. 레이어 패널의 자물쇠를 풀고 다시 하세요.`)
    return true
  }
  return false
}

/** 문서 (x,y) 의 선택 덮임 0~1 (선택이 없으면 1) */
export function selWeight(doc: Doc, x: number, y: number): number {
  const s = doc.selection
  if (!s) return 1
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return 0
  return s.mask[y * s.width + x] / 255
}

/**
 * 레이어(또는 그 마스크) 픽셀을 편집한다. fn 은 복사본 데이터를 제자리에서 바꾼다.
 * 선택이 있으면 결과를 선택 덮임만큼만 섞는다.
 */
export function editPixels(doc: Doc, id: string, target: 'layer' | 'mask', cover: Rect | undefined, fn: (data: Uint8ClampedArray, w: number, h: number, ox: number, oy: number) => void): Doc {
  let d = bakeLayer(doc, id, cover)
  const l = getLayer(d, id)
  if (!l) return doc
  const bmp = target === 'mask' ? l.mask?.bitmap : l.bitmap
  if (!bmp) return doc
  const ox = Math.round(l.transform.x)
  const oy = Math.round(l.transform.y)
  const orig = bmp.data
  const data = orig.slice()
  fn(data, bmp.width, bmp.height, ox, oy)
  // 투명 픽셀 잠금: 알파는 원래대로 (색만 바뀐다 — 포토샵 Lock transparent pixels)
  if (target === 'layer' && l.lock?.alpha) for (let i = 3; i < data.length; i += 4) data[i] = orig[i]
  if (d.selection) {
    for (let y = 0; y < bmp.height; y++)
      for (let x = 0; x < bmp.width; x++) {
        const w = selWeight(d, x + ox, y + oy)
        if (w >= 1) continue
        const o = (y * bmp.width + x) * 4
        for (let c = 0; c < 4; c++) data[o + c] = orig[o + c] + (data[o + c] - orig[o + c]) * w
      }
  }
  const next: Bitmap = { width: bmp.width, height: bmp.height, data }
  // 픽셀을 고치면 도형 레이어는 일반 픽셀 레이어가 된다 (모양 데이터와 픽셀이 달라지므로)
  d = updateLayer(d, id, target === 'mask' ? { mask: { ...l.mask!, bitmap: next } } : { bitmap: next, shape: undefined })
  return d
}

const selRect = (doc: Doc): Rect => doc.selection?.bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height }

/** 선택(없으면 전체)을 색으로 채움 — Compositor Fill with Foreground/Background */
export function fillSelection(doc: Doc, id: string, rgb: [number, number, number], target: 'layer' | 'mask' = 'layer'): Doc {
  const gray = Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])
  return editPixels(doc, id, target, selRect(doc), (d) => {
    for (let i = 0; i < d.length; i += 4) {
      if (target === 'mask') d[i] = d[i + 1] = d[i + 2] = gray
      else {
        d[i] = rgb[0]
        d[i + 1] = rgb[1]
        d[i + 2] = rgb[2]
      }
      d[i + 3] = 255
    }
  })
}

/** 선택 안 픽셀 지우기 — Compositor Clear Selection Pixels / Delete */
export function eraseSelection(doc: Doc, id: string): Doc {
  const l = getLayer(doc, id)
  if (!l?.bitmap) return doc
  return editPixels(doc, id, 'layer', undefined, (d) => {
    for (let i = 3; i < d.length; i += 4) d[i] = 0
  })
}

/** 보정·필터를 레이어에 직접 (선택 영역 한정) — Compositor 의 Image 메뉴 보정·Filter 메뉴 */
export function adjustLayer(doc: Doc, id: string, a: Adjustments | null, f: Filters | null, seed = 7): Doc {
  return editPixels(doc, id, 'layer', undefined, (d, w, h) => {
    if (a && hasAdjust(a)) applyAdjustments(d, a, seed)
    if (f && hasFilters(f)) d.set(applyFilters(d, w, h, f, seed, 'clamp'))
  })
}

/** 선택 영역으로 새 레이어 (잘라내기면 원본에서 지움) — Compositor Layer via Copy (⌘J) / Cut */
export function layerViaCopy(doc: Doc, cut: boolean): Doc {
  const l = getLayer(doc, doc.activeId)
  if (!l?.bitmap) return doc
  let d = bakeLayer(doc, l.id)
  const src = getLayer(d, l.id)!
  const b = d.selection?.bounds
  if (!b) return doc
  const ox = Math.round(src.transform.x)
  const oy = Math.round(src.transform.y)
  const piece = cropBitmap(src.bitmap!, b.x - ox, b.y - oy, b.w, b.h)
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) piece.data[(y * b.w + x) * 4 + 3] = piece.data[(y * b.w + x) * 4 + 3] * selWeight(d, b.x + x, b.y + y)
  if (cut) d = eraseSelection(d, l.id)
  const layer: Layer = makeLayer('pixel', `${l.name} ${cut ? '잘라냄' : '복사'}`, piece, identityTransform(b.w, b.h, b.x, b.y))
  return insertLayer({ ...d, activeId: l.id }, layer, l.id)
}

/** 캔버스 밖 픽셀을 버린다 — 자르기의 "잘린 픽셀 삭제" (픽셀·문자 레이어를 문서 크기로 굽고 자른다) */
export function trimToCanvas(doc: Doc): Doc {
  let d = doc
  for (const l of doc.layers) {
    if (!l.bitmap || l.kind === 'group' || l.kind === 'adjustment') continue
    d = bakeLayer(d, l.id)
    const b = getLayer(d, l.id)!
    const ox = Math.round(b.transform.x)
    const oy = Math.round(b.transform.y)
    const x0 = Math.max(0, ox)
    const y0 = Math.max(0, oy)
    const x1 = Math.min(d.width, ox + b.bitmap!.width)
    const y1 = Math.min(d.height, oy + b.bitmap!.height)
    if (x1 <= x0 || y1 <= y0) continue
    const cut = (bm: Bitmap): Bitmap => cropBitmap(bm, x0 - ox, y0 - oy, x1 - x0, y1 - y0)
    d = updateLayer(d, l.id, {
      bitmap: cut(b.bitmap!),
      mask: b.mask ? { ...b.mask, bitmap: cut(b.mask.bitmap) } : null,
      transform: identityTransform(x1 - x0, y1 - y0, x0, y0),
      kind: b.kind === 'text' ? 'pixel' : b.kind,
      text: null
    })
  }
  return d
}
