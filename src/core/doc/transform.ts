/**
 * 레이어 변형 수학 (순수 TS) — Compositor `LayerTransform`.
 * 비트맵 픽셀 (u,v) ∈ [0,bw]×[0,bh] → 문서 좌표:
 *   크기 맞춤(width/bw, height/bh) → 반전(중심 기준) → 회전(중심 기준, 시계방향) → 이동(x,y).
 * 2×3 아핀 행렬 [a, b, c, d, e, f] :  X = a·u + c·v + e,  Y = b·u + d·v + f
 */
import type { LayerTransform } from './types'

export type Affine = [number, number, number, number, number, number]

export function identityTransform(width: number, height: number, x = 0, y = 0): LayerTransform {
  return { x, y, width, height, rotation: 0, flipH: false, flipV: false }
}

export function isIdentityPlacement(t: LayerTransform, bw: number, bh: number): boolean {
  return t.rotation % 360 === 0 && !t.flipH && !t.flipV && t.width === bw && t.height === bh && Number.isInteger(t.x) && Number.isInteger(t.y)
}

/** 비트맵 → 문서 행렬 */
export function layerMatrix(t: LayerTransform, bw: number, bh: number): Affine {
  const sx = (t.width / bw) * (t.flipH ? -1 : 1)
  const sy = (t.height / bh) * (t.flipV ? -1 : 1)
  const r = (t.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  // 픽셀 중심 기준: u' = (u - bw/2)·sx, v' = (v - bh/2)·sy → 회전 → + (cx, cy)
  const a = cos * sx
  const b = sin * sx
  const c = -sin * sy
  const d = cos * sy
  const e = cx - a * (bw / 2) - c * (bh / 2)
  const f = cy - b * (bw / 2) - d * (bh / 2)
  return [a, b, c, d, e, f]
}

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m
  const det = a * d - b * c || 1e-12
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

export function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

export function multiplyAffine(p: Affine, q: Affine): Affine {
  // p ∘ q  (q 먼저)
  return [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]]
}

/** 변형된 사각형의 네 모서리 (문서 좌표) — 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래 (반전 전 기준) */
export function transformCorners(t: LayerTransform): { x: number; y: number }[] {
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  const r = (t.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [
    [-t.width / 2, -t.height / 2],
    [t.width / 2, -t.height / 2],
    [t.width / 2, t.height / 2],
    [-t.width / 2, t.height / 2]
  ].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }))
}

/** 변형된 사각형을 감싸는 정수 경계 */
export function transformBounds(t: LayerTransform): { x: number; y: number; w: number; h: number } {
  const c = transformCorners(t)
  const x0 = Math.floor(Math.min(...c.map((p) => p.x)))
  const y0 = Math.floor(Math.min(...c.map((p) => p.y)))
  const x1 = Math.ceil(Math.max(...c.map((p) => p.x)))
  const y1 = Math.ceil(Math.max(...c.map((p) => p.y)))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/** 문서 점이 변형된 사각형 안에 있는가 */
export function hitTransform(t: LayerTransform, x: number, y: number): boolean {
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  const r = (-t.rotation * Math.PI) / 180
  const dx = x - cx
  const dy = y - cy
  const lx = dx * Math.cos(r) - dy * Math.sin(r)
  const ly = dx * Math.sin(r) + dy * Math.cos(r)
  return Math.abs(lx) <= t.width / 2 && Math.abs(ly) <= t.height / 2
}
