/**
 * 패스 (순수 TS) — 펜 도구로 그린 베지어 곡선. 문서 좌표(px). 포토샵 패스·벡터 마스크의 단순판.
 *  - 앵커: 점 + 들어오는 핸들(in)·나가는 핸들(out) (없으면 직선 꼭짓점)
 *  - 서브패스: 앵커 목록 + 닫힘 여부. 패스 = 서브패스 여러 개 (합집합으로 채운다)
 *  - 래스터: 곡선을 평탄화한 다각형 → polygonMask (4× 초표본 안티앨리어싱)
 *  - 벡터 마스크: 레이어에 붙은 서브패스들 — 합성 때 문서 좌표 마스크를 레이어 좌표로 바꿔 픽셀 마스크와 곱한다
 */
import type { Bitmap, Layer, LayerMask } from './types'
import { polygonMask } from './selection'
import { layerMatrix } from './transform'

export interface PathPt {
  x: number
  y: number
}
type Pt = PathPt
export interface PathAnchor extends PathPt {
  /** 이 앵커로 들어오는 곡선의 제어점 (절대 좌표). 없으면 직선 */
  in?: Pt | null
  /** 이 앵커에서 나가는 제어점 */
  out?: Pt | null
}
export interface SubPath {
  closed: boolean
  anchors: PathAnchor[]
}
export interface DocPath {
  id: string
  name: string
  subpaths: SubPath[]
}
export interface VectorMask {
  subpaths: SubPath[]
  enabled: boolean
  /** 안팎 뒤집기 (패스 밖이 보임) */
  inverted?: boolean
}

let pathSeq = 0
export const newPathId = (): string => `p${Date.now().toString(36)}${(++pathSeq).toString(36)}`

/** 서브패스 → 다각형 점 (닫힘과 무관하게 곡선을 평탄화). tolerance = 최대 허용 오차 px */
export function flattenSubPath(sp: SubPath, tolerance = 0.25): Pt[] {
  const a = sp.anchors
  if (a.length === 0) return []
  const out: Pt[] = [{ x: a[0].x, y: a[0].y }]
  const n = sp.closed ? a.length : a.length - 1
  for (let i = 0; i < n; i++) {
    const p0 = a[i]
    const p3 = a[(i + 1) % a.length]
    const c1 = p0.out ?? p0
    const c2 = p3.in ?? p3
    if (c1 === p0 && c2 === p3) {
      out.push({ x: p3.x, y: p3.y })
      continue
    }
    // 세그먼트 수 = 제어 다각형 길이에 비례 (오차 tolerance 이내)
    const len = Math.hypot(c1.x - p0.x, c1.y - p0.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p3.x - c2.x, p3.y - c2.y)
    const steps = Math.max(2, Math.min(200, Math.ceil(Math.sqrt(len / tolerance))))
    for (let k = 1; k <= steps; k++) {
      const t = k / steps
      const u = 1 - t
      out.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y
      })
    }
  }
  return out
}

/** 패스 전체를 문서 크기 마스크로 (서브패스 합집합 = 최대). 열린 서브패스는 닫아서 채운다 */
export function pathMask(width: number, height: number, subpaths: SubPath[]): Uint8Array {
  const m = new Uint8Array(width * height)
  for (const sp of subpaths) {
    const pts = flattenSubPath(sp)
    if (pts.length < 3) continue
    const one = polygonMask(width, height, pts, true)
    for (let i = 0; i < m.length; i++) if (one[i] > m[i]) m[i] = one[i]
  }
  return m
}

/** 서브패스 위를 일정 간격으로 지나는 점 (붓으로 선 그리기용) */
export function samplePath(subpaths: SubPath[], spacing: number): Pt[][] {
  const out: Pt[][] = []
  for (const sp of subpaths) {
    const poly = flattenSubPath(sp, 0.25)
    if (poly.length < 2) continue
    const pts: Pt[] = [poly[0]]
    let carry = 0
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i - 1]
      const b = poly[i]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      let t = spacing - carry
      while (t <= len) {
        pts.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len })
        t += spacing
      }
      carry = len - (t - spacing)
    }
    const last = poly[poly.length - 1]
    if (pts[pts.length - 1] !== last) pts.push(last)
    out.push(pts)
  }
  return out
}

export function pathBounds(subpaths: SubPath[]): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const sp of subpaths)
    for (const p of flattenSubPath(sp, 1)) {
      if (p.x < x0) x0 = p.x
      if (p.y < y0) y0 = p.y
      if (p.x > x1) x1 = p.x
      if (p.y > y1) y1 = p.y
    }
  return Number.isFinite(x0) ? { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1) - Math.floor(x0), h: Math.ceil(y1) - Math.floor(y0) } : null
}

/** 서브패스를 통째로 옮기기 */
export function translateSubPaths(subpaths: SubPath[], dx: number, dy: number): SubPath[] {
  const mv = (p: Pt | null | undefined): Pt | null | undefined => (p ? { x: p.x + dx, y: p.y + dy } : p)
  return subpaths.map((sp) => ({ ...sp, anchors: sp.anchors.map((a) => ({ x: a.x + dx, y: a.y + dy, in: mv(a.in), out: mv(a.out) })) }))
}

// ── 벡터 마스크 → 레이어 좌표 비트맵 (캐시) ──
const vmCache = new WeakMap<VectorMask, { key: string; pm: Bitmap | null; bitmap: Bitmap }>()
const docMaskCache = new WeakMap<VectorMask, { key: string; mask: Uint8Array }>()

/** 문서 크기의 벡터 마스크 (캐시) */
export function vectorMaskDoc(vm: VectorMask, docW: number, docH: number): Uint8Array {
  const key = `${docW}x${docH}`
  const c = docMaskCache.get(vm)
  if (c && c.key === key) return c.mask
  const mask = pathMask(docW, docH, vm.subpaths)
  if (vm.inverted) for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i]
  docMaskCache.set(vm, { key, mask })
  return mask
}

/**
 * 레이어의 실제 마스크 = 픽셀 마스크 × 벡터 마스크. 벡터 마스크는 문서 좌표라 레이어 픽셀마다 문서 위치를 구해 읽는다
 * (변형이 있으면 가장 가까운 픽셀). 둘 다 없으면 null. 결과는 레이어 변형을 따라가는 LayerMask (캐시: 벡터 마스크·변형·픽셀 마스크가 같으면 재사용).
 */
export function effectiveMask(layer: Layer, docW: number, docH: number): LayerMask | null {
  const vm = layer.vectorMask
  if (!vm?.enabled) return layer.mask?.enabled ? layer.mask : null
  const pm = layer.mask?.enabled ? layer.mask.bitmap : null
  const bw = layer.bitmap?.width ?? docW
  const bh = layer.bitmap?.height ?? docH
  const t = layer.transform
  const key = `${docW}x${docH}|${bw}x${bh}|${t.x},${t.y},${t.width},${t.height},${t.rotation},${t.flipH},${t.flipV}`
  const c = vmCache.get(vm)
  if (c && c.key === key && c.pm === pm) return { bitmap: c.bitmap, enabled: true, linked: true }
  const doc = vectorMaskDoc(vm, docW, docH)
  const data = new Uint8ClampedArray(bw * bh * 4)
  // layerMatrix = 비트맵 픽셀 → 문서 좌표
  const fwd = layer.bitmap ? layerMatrix(t, bw, bh) : null
  for (let v = 0; v < bh; v++)
    for (let u = 0; u < bw; u++) {
      let x = u
      let y = v
      if (fwd) {
        x = fwd[0] * (u + 0.5) + fwd[2] * (v + 0.5) + fwd[4]
        y = fwd[1] * (u + 0.5) + fwd[3] * (v + 0.5) + fwd[5]
      }
      const xi = Math.floor(x)
      const yi = Math.floor(y)
      let mv = xi >= 0 && yi >= 0 && xi < docW && yi < docH ? doc[yi * docW + xi] : vm.inverted ? 255 : 0
      const o = (v * bw + u) * 4
      if (pm) mv = (mv * pm.data[o]) / 255
      data[o] = data[o + 1] = data[o + 2] = mv
      data[o + 3] = 255
    }
  const bitmap: Bitmap = { width: bw, height: bh, data }
  vmCache.set(vm, { key, pm, bitmap })
  return { bitmap, enabled: true, linked: true }
}
