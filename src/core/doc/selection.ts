/**
 * 선택 영역 (순수 TS) — 문서 크기의 덮임 마스크(0~255).
 *
 * 출처: `~/Compositor` `Document/Selection.swift`·`SelectionEdits.swift`·`MagicWand.swift` + C 커널 `WandPixels.c`.
 * Compositor 는 선택을 경로(CGPath)로 들고 다니지만, 여기서는 픽셀 마스크로 둔다 — 칠하기·필터·합성에서
 * 바로 곱할 수 있고 페더·확장이 픽셀 연산 한 번이다. 테두리(개미 행진)는 마스크에서 선분을 추적해 그린다.
 */
import type { Selection } from './types'
import { extreme } from '../effects'

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect'

export function makeSelection(width: number, height: number, mask: Uint8Array): Selection | null {
  const b = maskBounds(mask, width, height)
  return b ? { width, height, mask, bounds: b } : null
}

export function maskBounds(mask: Uint8Array, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function selectAll(width: number, height: number): Selection {
  return makeSelection(width, height, new Uint8Array(width * height).fill(255))!
}

/** 사각형 (문서 px, 소수 좌표는 가장자리 덮임으로) */
export function rectMask(width: number, height: number, r: { x: number; y: number; w: number; h: number }): Uint8Array {
  const m = new Uint8Array(width * height)
  const x0 = Math.min(r.x, r.x + r.w)
  const x1 = Math.max(r.x, r.x + r.w)
  const y0 = Math.min(r.y, r.y + r.h)
  const y1 = Math.max(r.y, r.y + r.h)
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y++) {
    const cy = Math.min(y + 1, y1) - Math.max(y, y0)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x++) {
      const cx = Math.min(x + 1, x1) - Math.max(x, x0)
      m[y * width + x] = Math.round(Math.max(0, cx) * Math.max(0, cy) * 255)
    }
  }
  return m
}

/** 폴리곤(문서 좌표 점들) — 짝홀 규칙, 픽셀당 4×4 표본으로 계단 완화 (올가미·타원 공용) */
export function polygonMask(width: number, height: number, pts: { x: number; y: number }[], antialias = true): Uint8Array {
  const m = new Uint8Array(width * height)
  if (pts.length < 3) return m
  const S = antialias ? 4 : 1
  let low = Infinity,
    high = -Infinity
  for (const p of pts) {
    low = Math.min(low, p.y)
    high = Math.max(high, p.y)
  }
  const minY = Math.max(0, Math.floor(low))
  const maxY = Math.min(height, Math.ceil(high))
  const acc = new Uint16Array(width)
  const xs: number[] = []
  for (let y = minY; y < maxY; y++) {
    acc.fill(0)
    let touched = false
    for (let sy = 0; sy < S; sy++) {
      const py = y + (sy + 0.5) / S
      xs.length = 0
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]
        const b = pts[j]
        if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py)) xs.push(a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k]
        const xb = xs[k + 1]
        const first = Math.max(0, Math.ceil(xa * S - 0.5))
        const end = Math.min(S * width, Math.ceil(xb * S - 0.5))
        // Scan only intersecting pixels, counting subpixel samples without visiting the left margin.
        for (let x = Math.floor(first / S); x < Math.ceil(end / S); x++) {
          acc[x] += Math.min(end, (x + 1) * S) - Math.max(first, x * S)
          touched = true
        }
      }
    }
    if (!touched) continue
    const row = y * width
    for (let x = 0; x < width; x++) if (acc[x]) m[row + x] = Math.round((acc[x] / (S * S)) * 255)
  }
  return m
}

/** 타원 — 사각형에 내접 */
export function ellipseMask(width: number, height: number, r: { x: number; y: number; w: number; h: number }): Uint8Array {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const rx = Math.abs(r.w / 2)
  const ry = Math.abs(r.h / 2)
  const n = Math.max(32, Math.ceil((rx + ry) * 1.5))
  const pts = Array.from({ length: n }, (_, i) => ({ x: cx + rx * Math.cos((i / n) * 2 * Math.PI), y: cy + ry * Math.sin((i / n) * 2 * Math.PI) }))
  return polygonMask(width, height, pts)
}

/** 새 마스크를 기존 선택과 합친다 (Shift = 더하기, Alt = 빼기, Shift+Alt = 교집합) */
export function combine(prev: Selection | null, width: number, height: number, next: Uint8Array, mode: SelectMode): Selection | null {
  if (mode === 'replace' || !prev) return mode === 'subtract' || mode === 'intersect' ? (mode === 'intersect' ? null : prev) : makeSelection(width, height, next)
  const out = new Uint8Array(width * height)
  const a = prev.mask
  for (let i = 0; i < out.length; i++) {
    if (mode === 'add') out[i] = Math.max(a[i], next[i])
    else if (mode === 'subtract') out[i] = Math.max(0, a[i] - next[i])
    else out[i] = Math.min(a[i], next[i])
  }
  return makeSelection(width, height, out)
}

export function invertSelection(sel: Selection | null, width: number, height: number): Selection | null {
  const out = new Uint8Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = 255 - (sel ? sel.mask[i] : 0)
  return makeSelection(width, height, out)
}

/** 확장(+)/축소(−) px — 슬라이딩 최대/최소 (Compositor Expand/Contract) */
export function growSelection(sel: Selection, px: number): Selection | null {
  if (!px) return sel
  const f = Float32Array.from(sel.mask, (v) => v / 255)
  const g = extreme(f, sel.width, sel.height, Math.abs(px), px < 0)
  return makeSelection(
    sel.width,
    sel.height,
    Uint8Array.from(g, (v) => Math.round(v * 255))
  )
}

/** 페더 — 가우시안 근사(상자 3회, σ = radius/2) */
export function featherSelection(sel: Selection, radius: number): Selection | null {
  if (radius <= 0) return sel
  const sigma = radius / 2
  const r = Math.max(1, Math.round((Math.sqrt((12 * sigma * sigma) / 3 + 1) - 1) / 2))
  let a: Float32Array = Float32Array.from(sel.mask)
  const W = sel.width
  const H = sel.height
  const pass = (src: Float32Array, horizontal: boolean): Float32Array => {
    const dst = new Float32Array(src.length)
    const span = r * 2 + 1
    const lines = horizontal ? H : W
    const count = horizontal ? W : H
    const step = horizontal ? 1 : W
    for (let line = 0; line < lines; line++) {
      const base = horizontal ? line * W : line
      let sum = 0
      for (let k = -r; k <= r; k++) sum += src[base + Math.min(count - 1, Math.max(0, k)) * step]
      for (let i = 0; i < count; i++) {
        dst[base + i * step] = sum / span
        sum += src[base + Math.min(count - 1, i + r + 1) * step] - src[base + Math.max(0, i - r) * step]
      }
    }
    return dst
  }
  for (let k = 0; k < 3; k++) a = pass(pass(a, true), false)
  return makeSelection(
    W,
    H,
    Uint8Array.from(a, (v) => Math.round(v))
  )
}

/** 선택을 (dx,dy) 만큼 옮긴다 (정수) */
export function moveSelection(sel: Selection, dx: number, dy: number): Selection | null {
  const W = sel.width
  const H = sel.height
  const out = new Uint8Array(W * H)
  const ox = Math.round(dx)
  const oy = Math.round(dy)
  for (let y = 0; y < H; y++) {
    const sy = y - oy
    if (sy < 0 || sy >= H) continue
    for (let x = 0; x < W; x++) {
      const sx = x - ox
      if (sx >= 0 && sx < W) out[y * W + x] = sel.mask[sy * W + sx]
    }
  }
  return makeSelection(W, H, out)
}

/** RGBA(문서 크기)의 알파로 선택 — "레이어 픽셀 선택" */
export function selectionFromAlpha(rgba: Uint8ClampedArray, width: number, height: number): Selection | null {
  const m = new Uint8Array(width * height)
  for (let i = 0; i < m.length; i++) m[i] = rgba[i * 4 + 3]
  return makeSelection(width, height, m)
}

/**
 * 마법봉 — Compositor `wand_mask` 그대로: 클릭 주변 (2r+1)² 평균 색을 기준으로 RGBA 네 채널이 모두 ±tolerance 안이면 선택.
 * contiguous 면 스캔라인 채우기, 아니면 이미지 전체에서 같은 색.
 */
export function magicWand(rgba: Uint8ClampedArray, width: number, height: number, seedX: number, seedY: number, tolerance: number, contiguous: boolean, radius = 0): Uint8Array {
  const mask = new Uint8Array(width * height)
  const sx = Math.floor(seedX)
  const sy = Math.floor(seedY)
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return mask
  const x0 = Math.max(0, sx - radius)
  const x1 = Math.min(width - 1, sx + radius)
  const y0 = Math.max(0, sy - radius)
  const y1 = Math.min(height - 1, sy + radius)
  const sums = [0, 0, 0, 0]
  let n = 0
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++, n++) for (let c = 0; c < 4; c++) sums[c] += rgba[(y * width + x) * 4 + c]
  const ref = sums.map((s) => Math.floor((s + n / 2) / n))
  const tol = Math.max(0, Math.round(tolerance))
  const matches = (p: number): boolean => {
    const o = p * 4
    for (let c = 0; c < 4; c++) {
      const d = rgba[o + c] - ref[c]
      if (d < -tol || d > tol) return false
    }
    return true
  }
  if (!contiguous) {
    for (let p = 0; p < width * height; p++) if (matches(p)) mask[p] = 255
    return mask
  }
  const stack: number[] = [sx, sy]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const row = y * width
    if (mask[row + x] || !matches(row + x)) continue
    let left = x
    let right = x
    while (left > 0 && !mask[row + left - 1] && matches(row + left - 1)) left--
    while (right + 1 < width && !mask[row + right + 1] && matches(row + right + 1)) right++
    mask.fill(255, row + left, row + right + 1)
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue
      const nrow = ny * width
      let inRun = false
      for (let nx = left; nx <= right; nx++) {
        const cand = !mask[nrow + nx] && matches(nrow + nx)
        if (cand && !inRun) stack.push(nx, ny)
        inRun = cand
      }
    }
  }
  return mask
}

/**
 * 테두리 선분 (개미 행진용) — 선택(≥128)과 비선택 사이의 픽셀 변. 정수 격자 좌표 [x1,y1,x2,y2]…
 * 가로·세로로 이어지는 변은 합쳐서 선분 수를 줄인다.
 */
export function selectionOutline(sel: Selection): Float32Array {
  const { width: W, height: H, mask } = sel
  const on = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] >= 128
  const segs: number[] = []
  const b = sel.bounds!
  // 가로 변 (y 경계마다 x 방향으로 이어 붙임)
  for (let y = b.y; y <= b.y + b.h; y++) {
    let start = -1
    for (let x = b.x; x <= b.x + b.w; x++) {
      const edge = x < b.x + b.w && on(x, y - 1) !== on(x, y)
      if (edge && start < 0) start = x
      if (!edge && start >= 0) {
        segs.push(start, y, x, y)
        start = -1
      }
    }
  }
  for (let x = b.x; x <= b.x + b.w; x++) {
    let start = -1
    for (let y = b.y; y <= b.y + b.h; y++) {
      const edge = y < b.y + b.h && on(x - 1, y) !== on(x, y)
      if (edge && start < 0) start = y
      if (!edge && start >= 0) {
        segs.push(x, start, x, y)
        start = -1
      }
    }
  }
  return Float32Array.from(segs)
}

/**
 * 선택 테두리의 선(Stroke) 덮임 0~1 — 편집 ▸ 선 그리기 (포토샵 Edit ▸ Stroke).
 * position: outside = 선택 바깥으로, inside = 안쪽으로, center = 경계 가운데로 width 만큼.
 */
export function selectionStrokeCoverage(sel: Selection, width: number, position: 'inside' | 'center' | 'outside'): Float32Array {
  const W = sel.width
  const H = sel.height
  const f = Float32Array.from(sel.mask, (v) => v / 255)
  const grow = position === 'outside' ? width : position === 'center' ? width / 2 : 0
  const shrink = position === 'inside' ? width : position === 'center' ? width / 2 : 0
  const outer = grow > 0 ? extreme(f, W, H, grow, false) : f
  const inner = shrink > 0 ? extreme(f, W, H, shrink, true) : f
  const out = new Float32Array(f.length)
  for (let i = 0; i < f.length; i++) out[i] = Math.max(0, Math.min(1, outer[i] - inner[i]))
  return out
}

/** 선택 매끄럽게 — 뾰족한 모서리·계단을 둥글게 (흐린 뒤 경계에서 다시 자름, 포토샵 Select ▸ Modify ▸ Smooth) */
export function smoothSelection(sel: Selection, radius: number): Selection | null {
  if (radius <= 0) return sel
  const blurred = featherSelection(sel, radius)
  if (!blurred) return null
  const m = new Uint8Array(blurred.mask.length)
  for (let i = 0; i < m.length; i++) m[i] = Math.max(0, Math.min(255, Math.round((blurred.mask[i] - 127.5) * 4 + 127.5)))
  return makeSelection(sel.width, sel.height, m)
}
