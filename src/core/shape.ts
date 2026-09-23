/**
 * 도형 래스터라이저 (순수 TS) — 사각형·둥근 사각형·타원·선을 부호 거리(SDF) + 4×4 초표본으로 그린다.
 * 편집기(OffscreenCanvas)와 서버(Node)가 같은 함수를 쓴다 → 결과가 같다 (ADR-0005).
 * 좌표: 비트맵 = 도형 크기 + 사방 여백(외곽선 절반 + 2px). 채우기 위에 외곽선을 얹는다 (source-over, 캔버스와 같은 순서).
 */
import type { Bitmap, ShapeData } from './doc/types'
import { parseHex } from './adjust'

export const shapePad = (d: ShapeData): number => Math.ceil((d.stroke || d.kind === 'line' ? d.strokeWidth : 0) / 2) + 2

const SS = 4
const OFFS = Array.from({ length: SS }, (_, i) => (i + 0.5) / SS)

/** 도형 경계까지의 부호 거리 (안 = 음수). 타원은 축 비율로 정규화한 근사 */
function sdf(d: ShapeData, pad: number, x: number, y: number): number {
  const w = Math.max(0, d.w)
  const h = Math.max(0, d.h)
  const cx = pad + w / 2
  const cy = pad + h / 2
  const px = x - cx
  const py = y - cy
  if (d.kind === 'line') {
    const ax = pad
    const ay = d.dir === -1 ? pad + h : pad
    const bx = pad + w
    const by = d.dir === -1 ? pad : pad + h
    const vx = bx - ax
    const vy = by - ay
    const len2 = vx * vx + vy * vy || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / len2))
    return Math.hypot(x - ax - vx * t, y - ay - vy * t)
  }
  if (d.kind === 'ellipse') {
    const a = w / 2
    const b = h / 2
    if (a <= 0 || b <= 0) return Infinity
    const k = Math.hypot(px / a, py / b)
    // 정규화 반지름 차이를 짧은 축 기준 길이로 환산 (외곽선 두께가 대략 맞는다)
    return (k - 1) * Math.min(a, b)
  }
  const r = d.kind === 'roundRect' ? Math.min(Math.max(0, d.radius), w / 2, h / 2) : 0
  const qx = Math.abs(px) - (w / 2 - r)
  const qy = Math.abs(py) - (h / 2 - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

export function renderShape(d: ShapeData): Bitmap {
  const pad = shapePad(d)
  const w = Math.max(0, d.w)
  const h = Math.max(0, d.h)
  const cw = Math.max(1, Math.ceil(w + pad * 2))
  const ch = Math.max(1, Math.ceil(h + pad * 2))
  const data = new Uint8ClampedArray(cw * ch * 4)
  const fill = d.kind === 'line' ? null : d.fill ? parseHex(d.fill) : null
  const strokeColor = d.kind === 'line' ? (d.stroke ?? d.fill ?? '#000000') : d.stroke && d.strokeWidth > 0 ? d.stroke : null
  const stroke = strokeColor ? parseHex(strokeColor) : null
  const half = d.strokeWidth / 2
  if (!fill && !stroke) return { width: cw, height: ch, data }
  const n = SS * SS
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      let inFill = 0
      let inStroke = 0
      for (const oy of OFFS)
        for (const ox of OFFS) {
          const s = sdf(d, pad, x + ox, y + oy)
          if (fill && s <= 0) inFill++
          if (stroke && Math.abs(s) <= half) inStroke++
        }
      if (!inFill && !inStroke) continue
      // 채우기 → 외곽선 순서로 source-over
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      if (fill && inFill) {
        a = inFill / n
        r = fill[0]
        g = fill[1]
        b = fill[2]
      }
      if (stroke && inStroke) {
        const sa = inStroke / n
        const oa = sa + a * (1 - sa)
        r = (stroke[0] * sa + r * a * (1 - sa)) / oa
        g = (stroke[1] * sa + g * a * (1 - sa)) / oa
        b = (stroke[2] * sa + b * a * (1 - sa)) / oa
        a = oa
      }
      const o = (y * cw + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a * 255
    }
  return { width: cw, height: ch, data }
}
