/**
 * CPU 합성기 (순수 TS) — 문서를 한 장의 비트맵으로. 병합·내보내기·테스트의 기준.
 * 화면 표시는 WebGL2(`renderer/gl`)가 같은 규칙·수식으로 한다 (ADR-0002, guides/rendering.md).
 *
 * 규칙 (Compositor `ImageExporter.render` · `LiveMaskRenderer` 와 같은 순서)
 *  - 레이어는 아래 → 위. 숨긴 레이어·숨긴 폴더 안은 건너뛴다.
 *  - 레이어 한 장 = 비트맵을 변형해 문서에 앉힘(양선형, 크게 줄이면 먼저 2배씩 축소) → 마스크 → 효과.
 *  - 폴더 = 격리 합성(투명 바탕에 자식들을 합성한 결과를 폴더의 합성 모드·불투명도·마스크로 얹음).
 *  - 클리핑(clip) = 바로 아래 기준 레이어의 알파로 덮임을 곱한다.
 *  - 조정 레이어 = 지금까지 쌓인 아래 그림에 보정을 걸고, 불투명도·마스크(·클리핑)만큼 섞는다.
 */
import { compositePixel } from './blend'
import { layerMatrix, invertAffine, transformBounds } from './transform'
import type { Bitmap, Doc, Layer } from './types'
import { applyAdjustments } from '../adjust'
import { applyFilters, hasFilters } from '../filters'
import { renderEffects, hasEffects } from '../effects'

/** 문서 좌표의 사각 영역 래스터 (스트레이트 알파 RGBA) */
export interface Raster {
  x: number
  y: number
  width: number
  height: number
  data: Uint8ClampedArray
}

/** 2배씩 상자 평균으로 줄인 비트맵 (크게 줄여 그릴 때 계단·자글거림 방지 — Compositor DownsampleCache 와 같은 발상) */
function halve(b: Bitmap): Bitmap {
  const w = Math.max(1, Math.ceil(b.width / 2))
  const h = Math.max(1, Math.ceil(b.height / 2))
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let bl = 0
      let a = 0
      let n = 0
      for (let j = 0; j < 2; j++) {
        const sy = y * 2 + j
        if (sy >= b.height) continue
        for (let i = 0; i < 2; i++) {
          const sx = x * 2 + i
          if (sx >= b.width) continue
          const o = (sy * b.width + sx) * 4
          const al = b.data[o + 3]
          r += b.data[o] * al
          g += b.data[o + 1] * al
          bl += b.data[o + 2] * al
          a += al
          n++
        }
      }
      const o = (y * w + x) * 4
      out[o + 3] = a / n
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = bl / a
      }
    }
  }
  return { width: w, height: h, data: out }
}

/**
 * 레이어 비트맵을 변형해 문서 좌표 래스터로 (경계 = 변형 사각형 ∩ 문서).
 * 역매핑 양선형 샘플, 프리멀티플라이드로 섞어 투명 경계가 검게 번지지 않는다.
 */
export function rasterizeBitmap(bitmap: Bitmap, layer: Pick<Layer, 'transform'>, docW: number, docH: number): Raster | null {
  const t = layer.transform
  const bb = transformBounds(t)
  const x0 = Math.max(0, bb.x)
  const y0 = Math.max(0, bb.y)
  const x1 = Math.min(docW, bb.x + bb.w)
  const y1 = Math.min(docH, bb.y + bb.h)
  if (x1 <= x0 || y1 <= y0) return null
  // 정수 이동·원래 크기는 보간 없이 행 복사. 반환 버퍼는 호출자가 마스크를 곱할 수 있는 독립 사본이다.
  if (t.rotation === 0 && !t.flipH && !t.flipV && t.width === bitmap.width && t.height === bitmap.height && Number.isInteger(t.x) && Number.isInteger(t.y)) {
    const width = x1 - x0,
      height = y1 - y0
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      const offset = ((y0 + y - t.y) * bitmap.width + x0 - t.x) * 4
      data.set(bitmap.data.subarray(offset, offset + width * 4), y * width * 4)
    }
    // 보간 경로는 알파 0 픽셀의 숨은 RGB를 0으로 만든다.
    for (let i = 0; i < data.length; i += 4) if (!data[i + 3]) data[i] = data[i + 1] = data[i + 2] = 0
    return { x: x0, y: y0, width, height, data }
  }
  // 크게 줄일 때는 미리 2배씩 줄인 사본에서 샘플
  let src = bitmap
  const scale = Math.min(Math.abs(t.width) / bitmap.width, Math.abs(t.height) / bitmap.height)
  let s = scale
  while (s < 0.5 && src.width > 1 && src.height > 1) {
    src = halve(src)
    s *= 2
  }
  const inv = invertAffine(layerMatrix(t, src.width, src.height))
  const w = x1 - x0
  const h = y1 - y0
  const out = new Uint8ClampedArray(w * h * 4)
  const sw = src.width
  const sh = src.height
  const d = src.data
  for (let y = 0; y < h; y++) {
    const py = y0 + y + 0.5
    for (let x = 0; x < w; x++) {
      const px = x0 + x + 0.5
      const u = inv[0] * px + inv[2] * py + inv[4] - 0.5
      const v = inv[1] * px + inv[3] * py + inv[5] - 0.5
      if (u < -1 || v < -1 || u > sw || v > sh) continue
      const ux = Math.floor(u)
      const vy = Math.floor(v)
      const fx = u - ux
      const fy = v - vy
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < 2; j++) {
        const yy = vy + j
        if (yy < 0 || yy >= sh) continue
        const wy = j ? fy : 1 - fy
        for (let i = 0; i < 2; i++) {
          const xx = ux + i
          if (xx < 0 || xx >= sw) continue
          const wgt = wy * (i ? fx : 1 - fx)
          if (wgt <= 0) continue
          const o = (yy * sw + xx) * 4
          const al = d[o + 3] * wgt
          r += d[o] * al
          g += d[o + 1] * al
          b += d[o + 2] * al
          a += al
        }
      }
      if (a <= 0) continue
      const o = (y * w + x) * 4
      out[o] = r / a
      out[o + 1] = g / a
      out[o + 2] = b / a
      out[o + 3] = a
    }
  }
  return { x: x0, y: y0, width: w, height: h, data: out }
}

/** 마스크(회색 비트맵, 레이어 변형을 따라감)를 래스터 알파에 곱한다 (in place) */
function applyMask(r: Raster, layer: Layer, docW: number, docH: number): void {
  const m = layer.mask
  if (!m || !m.enabled) return
  const mr = rasterizeBitmap(m.bitmap, layer, docW, docH)
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const o = (y * r.width + x) * 4 + 3
      if (!r.data[o]) continue
      const dx = r.x + x - (mr?.x ?? 0)
      const dy = r.y + y - (mr?.y ?? 0)
      const inside = mr && dx >= 0 && dy >= 0 && dx < mr.width && dy < mr.height
      const mv = inside ? mr!.data[(dy * mr!.width + dx) * 4] : 0
      r.data[o] = (r.data[o] * mv) / 255
    }
  }
}

/** 레이어 한 장의 최종 래스터 (변형 → 마스크 → 효과) */
export function rasterizeLayer(layer: Layer, docW: number, docH: number): Raster | null {
  if (!layer.bitmap) return null
  let r = rasterizeBitmap(layer.bitmap, layer, docW, docH)
  if (!r) return null
  applyMask(r, layer, docW, docH)
  if (layer.effects && hasEffects(layer.effects)) {
    const e = renderEffects(r.data, r.width, r.height, layer.effects)
    r = { x: r.x - e.inset, y: r.y - e.inset, width: e.width, height: e.height, data: e.data }
  }
  return r
}

/** src 래스터를 dst(문서 크기) 에 합성 (in place). coverage = 픽셀별 추가 알파 배수 (클리핑용, 문서 크기) */
function compositeRaster(dst: Uint8ClampedArray, docW: number, docH: number, src: Raster, layer: Pick<Layer, 'blend' | 'opacity'>, coverage: Float32Array | null): void {
  const cb: [number, number, number] = [0, 0, 0]
  const cs: [number, number, number] = [0, 0, 0]
  const result: [number, number, number, number] = [0, 0, 0, 0]
  for (let y = 0; y < src.height; y++) {
    const ty = src.y + y
    if (ty < 0 || ty >= docH) continue
    for (let x = 0; x < src.width; x++) {
      const tx = src.x + x
      if (tx < 0 || tx >= docW) continue
      const s = (y * src.width + x) * 4
      let as = (src.data[s + 3] / 255) * layer.opacity
      if (coverage) as *= coverage[ty * docW + tx]
      if (as <= 0) continue
      const d = (ty * docW + tx) * 4
      const ab = dst[d + 3] / 255
      cb[0] = dst[d] / 255
      cb[1] = dst[d + 1] / 255
      cb[2] = dst[d + 2] / 255
      cs[0] = src.data[s] / 255
      cs[1] = src.data[s + 1] / 255
      cs[2] = src.data[s + 2] / 255
      const o = compositePixel(layer.blend, cb, ab, cs, as, result)
      dst[d] = o[0] * 255
      dst[d + 1] = o[1] * 255
      dst[d + 2] = o[2] * 255
      dst[d + 3] = o[3] * 255
    }
  }
}

/** 조정 레이어: 아래 그림(dst)에 보정을 걸어 불투명도·마스크·클리핑만큼 섞는다 (in place) */
function applyAdjustmentLayer(dst: Uint8ClampedArray, docW: number, docH: number, layer: Layer, coverage: Float32Array | null): void {
  const adj = layer.adjustment
  if (!adj) return
  let adjusted: Uint8ClampedArray = dst.slice()
  applyAdjustments(adjusted, adj.settings, 7)
  if (adj.filters && hasFilters(adj.filters)) adjusted = applyFilters(adjusted, docW, docH, adj.filters, 7, 'clamp')
  // 마스크: 조정 레이어의 마스크는 문서 크기 회색 비트맵 (변형 = 문서 전체)
  const mask = layer.mask?.enabled ? rasterizeBitmap(layer.mask.bitmap, layer, docW, docH) : null
  for (let i = 0, p = 0; i < dst.length; i += 4, p++) {
    let k = layer.opacity
    if (coverage) k *= coverage[p]
    if (mask) {
      const x = p % docW
      const y = (p / docW) | 0
      const dx = x - mask.x
      const dy = y - mask.y
      k *= dx >= 0 && dy >= 0 && dx < mask.width && dy < mask.height ? mask.data[(dy * mask.width + dx) * 4] / 255 : 0
    }
    if (k <= 0) continue
    for (let c = 0; c < 3; c++) dst[i + c] = dst[i + c] + (adjusted[i + c] - dst[i + c]) * k
  }
}

/** 래스터 알파 → 문서 크기 덮임 배열 (클리핑 기준) */
function alphaCoverage(r: Raster | null, docW: number, docH: number): Float32Array {
  const cov = new Float32Array(docW * docH)
  if (!r) return cov
  for (let y = 0; y < r.height; y++) {
    const ty = r.y + y
    if (ty < 0 || ty >= docH) continue
    for (let x = 0; x < r.width; x++) {
      const tx = r.x + x
      if (tx < 0 || tx >= docW) continue
      cov[ty * docW + tx] = r.data[(y * r.width + x) * 4 + 3] / 255
    }
  }
  return cov
}

/** 한 부모 아래의 레이어들을 dst 에 합성 */
function compositeChildren(doc: Doc, parentId: string | null, dst: Uint8ClampedArray, skip?: Set<string>): void {
  const { width: W, height: H } = doc
  const children = doc.layers.filter((l) => l.parentId === parentId && !skip?.has(l.id))
  let base: Float32Array | null = null // 현재 클리핑 기준 레이어의 알파
  for (let index = 0; index < children.length; index++) {
    const layer = children[index]
    const needsBase = !layer.clip && !!children[index + 1]?.clip
    const clipCov = layer.clip ? base : null
    if (!layer.clip) base = null
    if (!layer.visible) {
      if (needsBase) base = new Float32Array(W * H) // 숨긴 기준 위의 클리핑 레이어는 보이지 않는다
      continue
    }
    if (layer.clip && !clipCov) continue
    if (layer.kind === 'group') {
      const inner = new Uint8ClampedArray(W * H * 4)
      compositeChildren(doc, layer.id, inner, skip)
      const r: Raster = { x: 0, y: 0, width: W, height: H, data: inner }
      if (layer.mask?.enabled) applyMask(r, { ...layer, transform: { x: 0, y: 0, width: W, height: H, rotation: 0, flipH: false, flipV: false } }, W, H)
      compositeRaster(dst, W, H, r, layer, clipCov)
      if (needsBase) base = alphaCoverage(r, W, H)
      continue
    }
    if (layer.kind === 'adjustment') {
      applyAdjustmentLayer(dst, W, H, layer, clipCov)
      continue
    }
    const r = rasterizeLayer(layer, W, H)
    if (needsBase) base = alphaCoverage(r, W, H)
    if (r) compositeRaster(dst, W, H, r, layer, clipCov)
  }
}

/** 문서 전체를 한 장으로 (투명 바탕). skip = 제외할 레이어 id (병합·미리보기용) */
export function flattenDoc(doc: Doc, skip?: Set<string>): Bitmap {
  const data = new Uint8ClampedArray(doc.width * doc.height * 4)
  compositeChildren(doc, null, data, skip)
  return { width: doc.width, height: doc.height, data }
}

/** 지정한 레이어들만 (보이는 것만) 합성 — "병합"의 재료 */
export function flattenLayers(doc: Doc, ids: Set<string>): Bitmap {
  const keep = new Set<string>()
  const addWithAncestors = (id: string | null): void => {
    while (id) {
      keep.add(id)
      id = doc.layers.find((l) => l.id === id)?.parentId ?? null
    }
  }
  const addDescendants = (id: string): void => {
    for (const l of doc.layers)
      if (l.parentId === id) {
        keep.add(l.id)
        addDescendants(l.id)
      }
  }
  for (const id of ids) {
    addWithAncestors(id)
    addDescendants(id)
  }
  const skip = new Set(doc.layers.filter((l) => !keep.has(l.id)).map((l) => l.id))
  return flattenDoc(doc, skip)
}
