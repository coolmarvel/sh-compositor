/** CPU retouch reference. Per-dab snapshots contain only sampled pixels. */
import { tipAlpha, type BrushSettings } from '../src/core/doc/brush'
import type { Bitmap } from '../src/core/doc/types'
type Pt = { x: number; y: number }
export interface RetouchSession {
  live: Bitmap
  stroke: { settings: BrushSettings }
  limit?: (index: number) => number
}
export interface Patch {
  data: Uint8ClampedArray
  x: number
  y: number
  width: number
  height: number
}
export function snapshot(b: Bitmap, x0: number, y0: number, x1: number, y1: number): Patch {
  x0 = Math.max(0, Math.min(b.width - 1, Math.floor(x0)))
  y0 = Math.max(0, Math.min(b.height - 1, Math.floor(y0)))
  x1 = Math.max(x0, Math.min(b.width - 1, Math.ceil(x1)))
  y1 = Math.max(y0, Math.min(b.height - 1, Math.ceil(y1)))
  const width = x1 - x0 + 1,
    height = y1 - y0 + 1
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) data.set(b.data.subarray(((y + y0) * b.width + x0) * 4, ((y + y0) * b.width + x0 + width) * 4), y * width * 4)
  return { data, x: x0, y: y0, width, height }
}
/** 흐림 모드: 덮인 곳을 주변 평균으로 (획 덮임만큼) */
export function blurDab(s: RetouchSession, cx: number, cy: number): { x: number; y: number; w: number; h: number } | null {
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
  const lim = s.limit
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
export function smudgeDab(s: RetouchSession, from: Pt, to: Pt): { x: number; y: number; w: number; h: number } | null {
  const R = Math.max(1, s.stroke.settings.size / 2)
  const W = s.live.width
  const H = s.live.height
  const d = s.live.data
  const lim = s.limit
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
export function pushDab(s: RetouchSession, from: Pt, to: Pt): { x: number; y: number; w: number; h: number } | null {
  const R = Math.max(1, s.stroke.settings.size / 2)
  const W = s.live.width
  const H = s.live.height
  const d = s.live.data
  const lim = s.limit
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
