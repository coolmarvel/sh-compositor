/**
 * 브러시 엔진 (순수 TS) — Compositor `Document/BrushStroke.swift` 의 규칙을 CPU 로.
 *
 *  - 팁: 둥근 팁. 경도(hardness) 안쪽은 1, 바깥은 부드럽게 0 까지(smoothstep). 딱딱한 팁도 가장자리 1px 는 계단 완화.
 *  - 간격: 부드러운 팁 지름의 2.5%, 딱딱한 팁 1.5% (Compositor 소프트웨어 경로와 같음).
 *  - 누적: 획 하나 동안 덮임을 source-over 로 쌓는다 `c ← c + (1 − c)·dab` — 스스로 겹치는 곳이 매끄럽다.
 *  - 불투명도: **획 전체의 상한**(덮임 × 불투명도). 같은 획 안에서 여러 번 지나가도 불투명도를 넘지 않는다.
 *  - 좌표는 레이어 비트맵 픽셀 공간. 변형된 레이어에 칠할 때 호출측이 문서 → 레이어로 바꿔 넘긴다.
 */
import type { Bitmap } from './types'

export interface BrushSettings {
  /** 지름 (px, 레이어 픽셀 기준) */
  size: number
  /** 0~1 */
  hardness: number
  /** 0~1 — 획 전체 상한 */
  opacity: number
}

export const DEFAULT_BRUSH: BrushSettings = { size: 30, hardness: 0.8, opacity: 1 }

/** 팁 한 점의 덮임 (d = 중심까지 거리, R = 반지름) */
export function tipAlpha(d: number, R: number, hardness: number): number {
  if (R <= 0.5) return d <= 0.5 ? 1 : 0
  const h = Math.min(0.999, Math.max(0, hardness))
  const inner = h * R
  if (h >= 0.98) return Math.min(1, Math.max(0, R - d + 0.5)) // 딱딱한 팁: 1px 계단 완화
  if (d <= inner) return 1
  if (d >= R) return 0
  const t = (d - inner) / (R - inner)
  return 1 - t * t * (3 - 2 * t)
}

export const spacingFor = (s: BrushSettings): number => Math.max(0.5, s.size * (s.hardness >= 0.98 ? 0.015 : 0.025))

/** 한 획의 덮임 버퍼 (레이어 픽셀 크기) + 바뀐 영역 */
export class StrokeCoverage {
  readonly cov: Float32Array
  dirty: { x0: number; y0: number; x1: number; y1: number } | null = null
  private last: { x: number; y: number } | null = null
  private carry = 0

  constructor(
    readonly width: number,
    readonly height: number,
    readonly settings: BrushSettings
  ) {
    this.cov = new Float32Array(width * height)
  }

  /** 점 하나 찍기 */
  dab(cx: number, cy: number, pressure = 1): void {
    const R = Math.max(0.5, (this.settings.size * pressure) / 2)
    const x0 = Math.max(0, Math.floor(cx - R - 1))
    const y0 = Math.max(0, Math.floor(cy - R - 1))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + R + 1))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + R + 1))
    if (x1 < x0 || y1 < y0) return
    const h = this.settings.hardness
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy
      const row = y * this.width
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        const a = tipAlpha(Math.sqrt(dx * dx + dy * dy), R, h)
        if (a <= 0) continue
        const i = row + x
        this.cov[i] = this.cov[i] + (1 - this.cov[i]) * a
      }
    }
    const d = this.dirty
    this.dirty = d ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) } : { x0, y0, x1, y1 }
  }

  /** 지난 점에서 (x,y) 까지 간격마다 찍는다. 첫 점은 한 번 찍고 시작 */
  lineTo(x: number, y: number, pressure = 1): void {
    if (!this.last) {
      this.dab(x, y, pressure)
      this.last = { x, y }
      return
    }
    const step = spacingFor(this.settings)
    const dx = x - this.last.x
    const dy = y - this.last.y
    const len = Math.hypot(dx, dy)
    let t = step - this.carry
    while (t <= len) {
      this.dab(this.last.x + (dx * t) / len, this.last.y + (dy * t) / len, pressure)
      t += step
    }
    this.carry = len - (t - step)
    this.last = { x, y }
  }

  takeDirty(): { x: number; y: number; w: number; h: number } | null {
    const d = this.dirty
    this.dirty = null
    return d ? { x: d.x0, y: d.y0, w: d.x1 - d.x0 + 1, h: d.y1 - d.y0 + 1 } : null
  }
}

/**
 * 획을 원본 비트맵에 입힌 새 비트맵.
 *  paint: 색을 source-over (덮임 × 불투명도 × 제한)
 *  erase: 알파를 깎는다
 * limit(i) = 픽셀별 추가 제한 0~1 (선택 영역) — 없으면 1.
 * region 을 주면 그 사각형만 계산하고 나머지는 원본을 복사(획 도중 미리보기용 — 비용을 줄임).
 */
export function applyStroke(
  original: Bitmap,
  stroke: StrokeCoverage,
  color: [number, number, number],
  mode: 'paint' | 'erase',
  limit?: (i: number) => number,
  target?: Uint8ClampedArray,
  region?: { x: number; y: number; w: number; h: number }
): Bitmap {
  const out = target ?? original.data.slice()
  const W = original.width
  const op = stroke.settings.opacity
  const x0 = region ? region.x : 0
  const y0 = region ? region.y : 0
  const x1 = region ? region.x + region.w : W
  const y1 = region ? region.y + region.h : original.height
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * W + x
      const o = i * 4
      let a = stroke.cov[i] * op
      if (a > 0 && limit) a *= limit(i)
      if (a <= 0) {
        if (target) {
          out[o] = original.data[o]
          out[o + 1] = original.data[o + 1]
          out[o + 2] = original.data[o + 2]
          out[o + 3] = original.data[o + 3]
        }
        continue
      }
      const da = original.data[o + 3] / 255
      if (mode === 'erase') {
        out[o] = original.data[o]
        out[o + 1] = original.data[o + 1]
        out[o + 2] = original.data[o + 2]
        out[o + 3] = original.data[o + 3] * (1 - a)
        continue
      }
      const oa = a + da * (1 - a)
      out[o] = (color[0] * a + original.data[o] * da * (1 - a)) / oa
      out[o + 1] = (color[1] * a + original.data[o + 1] * da * (1 - a)) / oa
      out[o + 2] = (color[2] * a + original.data[o + 2] * da * (1 - a)) / oa
      out[o + 3] = oa * 255
    }
  }
  return { width: W, height: original.height, data: out }
}
