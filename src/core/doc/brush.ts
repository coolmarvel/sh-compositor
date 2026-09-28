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
  /** 펜 필압 → 굵기 (기본 켬) */
  pressureSize?: boolean
  /** 펜 필압 → 진하기 (한 점의 덮임에 곱함) */
  pressureOpacity?: boolean
  /** 팁 모양 (v1.2 — 없으면 둥근 팁) */
  tip?: BrushTip
  /** 질감 (v1.2 — 없으면 없음): 덮임에 무늬를 곱한다 */
  texture?: BrushTexture
}

export interface BrushTip {
  shape: 'round' | 'square' | 'image'
  /** 도 (시계 방향) */
  angle: number
  /** 0.05~1 — 1 이면 원, 작을수록 납작 */
  roundness: number
  /** 점 간격 = 지름 × spacing (없으면 경도에 따라 1.5~2.5%) */
  spacing?: number
  /** 흩뿌리기 0~1 (지름 배수) */
  scatter?: number
  /** 크기·불투명도 지터 0~1 */
  sizeJitter?: number
  opacityJitter?: number
  /** shape=image: 알파 그림 (base64 PNG 가 아니라 원시 알파 — 저장은 base64) */
  image?: TipImage
}
export interface TipImage {
  width: number
  height: number
  /** 알파 0~255, width×height, base64 (JSON 저장용) */
  alphaBase64: string
}
export interface BrushTexture {
  width: number
  height: number
  /** 회색 0~255 (255 = 그대로, 0 = 안 칠함), base64 */
  grayBase64: string
  /** 배율 (1 = 원본 픽셀) */
  scale: number
  /** 0~1 */
  strength: number
}

export const DEFAULT_TIP: BrushTip = { shape: 'round', angle: 0, roundness: 1, scatter: 0, sizeJitter: 0, opacityJitter: 0 }

/** base64 ↔ 바이트 (브라우저·Node 공용) */
export function bytesToBase64(b: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64')
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export function base64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'))
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const decoded = new WeakMap<object, Uint8Array>()
const bytesOf = (o: { alphaBase64?: string; grayBase64?: string }): Uint8Array => {
  let b = decoded.get(o)
  if (!b) {
    b = base64ToBytes(o.alphaBase64 ?? o.grayBase64 ?? '')
    decoded.set(o, b)
  }
  return b
}
/** 결정적 난수 (흩뿌리기·지터) — 같은 seed 면 같은 획 */
function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** 사각 팁의 덮임 — 체비쇼프 거리로 (모서리 1px 완화) */
function squareAlpha(dx: number, dy: number, R: number, hardness: number): number {
  return tipAlpha(Math.max(Math.abs(dx), Math.abs(dy)), R, hardness)
}

export const DEFAULT_BRUSH: BrushSettings = { size: 30, hardness: 0.8, opacity: 1, pressureSize: true, pressureOpacity: false }

/** 브러시 사전 설정 (도구 옵션 줄의 목록) */
export const BRUSH_PRESETS: { name: string; brush: Partial<BrushSettings> }[] = [
  { name: '기본 둥근 브러시', brush: { size: 30, hardness: 0.8, opacity: 1 } },
  { name: '부드러운 에어브러시', brush: { size: 120, hardness: 0, opacity: 0.35 } },
  { name: '딱딱한 연필', brush: { size: 3, hardness: 1, opacity: 1 } },
  { name: '마스크 다듬기', brush: { size: 60, hardness: 0.3, opacity: 1 } },
  { name: '잉크 펜 (필압 굵기)', brush: { size: 12, hardness: 0.95, opacity: 1, pressureSize: true, pressureOpacity: false } },
  { name: '수채 (필압 진하기)', brush: { size: 50, hardness: 0.2, opacity: 0.8, pressureSize: false, pressureOpacity: true } },
  { name: '납작 마커 (사각 팁)', brush: { size: 24, hardness: 1, opacity: 1, tip: { shape: 'square', angle: 45, roundness: 0.35, spacing: 0.05 } } },
  { name: '캘리그래피 펜', brush: { size: 20, hardness: 0.95, opacity: 1, pressureSize: true, tip: { shape: 'round', angle: 40, roundness: 0.2, spacing: 0.03 } } },
  { name: '흩뿌리기 (스프레이)', brush: { size: 40, hardness: 0.5, opacity: 0.6, tip: { shape: 'round', angle: 0, roundness: 1, spacing: 0.15, scatter: 0.8, sizeJitter: 0.7, opacityJitter: 0.5 } } }
]

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

export const spacingFor = (s: BrushSettings): number => Math.max(0.5, s.size * (s.tip?.spacing ?? (s.hardness >= 0.98 ? 0.015 : 0.025)))

/** 한 획의 덮임 버퍼 (레이어 픽셀 크기) + 바뀐 영역 */
export class StrokeCoverage {
  readonly cov: Float32Array
  dirty: { x0: number; y0: number; x1: number; y1: number } | null = null
  private last: { x: number; y: number; p: number } | null = null
  private carry = 0

  private rand: () => number
  constructor(
    readonly width: number,
    readonly height: number,
    readonly settings: BrushSettings,
    seed = 7
  ) {
    this.cov = new Float32Array(width * height)
    this.rand = mulberry(seed)
  }

  /** 점 하나 찍기 */
  dab(cx: number, cy: number, pressure = 1): void {
    const ps = this.settings.pressureSize !== false ? pressure : 1
    let po = this.settings.pressureOpacity ? pressure : 1
    const tip = this.settings.tip
    let size = this.settings.size * ps
    if (tip) {
      if (tip.scatter) {
        cx += (this.rand() * 2 - 1) * tip.scatter * this.settings.size
        cy += (this.rand() * 2 - 1) * tip.scatter * this.settings.size
      }
      if (tip.sizeJitter) size *= 1 - this.rand() * tip.sizeJitter
      if (tip.opacityJitter) po *= 1 - this.rand() * tip.opacityJitter
    }
    const R = Math.max(0.5, size / 2)
    // 회전·납작한 팁은 원보다 클 수 없다 → 경계는 R 로 충분
    const x0 = Math.max(0, Math.floor(cx - R - 1))
    const y0 = Math.max(0, Math.floor(cy - R - 1))
    const x1 = Math.min(this.width - 1, Math.ceil(cx + R + 1))
    const y1 = Math.min(this.height - 1, Math.ceil(cy + R + 1))
    if (x1 < x0 || y1 < y0) return
    const h = this.settings.hardness
    const shaped = !!tip && (tip.shape !== 'round' || tip.angle !== 0 || tip.roundness < 1)
    const cos = shaped ? Math.cos((-tip!.angle * Math.PI) / 180) : 1
    const sin = shaped ? Math.sin((-tip!.angle * Math.PI) / 180) : 0
    const ry = shaped ? 1 / Math.max(0.05, tip!.roundness) : 1
    const img = tip?.shape === 'image' && tip.image ? tip.image : null
    const imgA = img ? bytesOf(img) : null
    const tex = this.settings.texture
    const texG = tex ? bytesOf(tex) : null
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy
      const row = y * this.width
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx
        let a: number
        if (!shaped) a = tipAlpha(Math.sqrt(dx * dx + dy * dy), R, h)
        else {
          // 팁 좌표로 (회전 되돌리고 납작함 펴기)
          const lx = dx * cos - dy * sin
          const ly = (dx * sin + dy * cos) * ry
          if (img && imgA) {
            const u = ((lx / R + 1) / 2) * img.width
            const v = ((ly / R + 1) / 2) * img.height
            if (u < 0 || v < 0 || u >= img.width || v >= img.height) continue
            a = imgA[(v | 0) * img.width + (u | 0)] / 255
          } else if (tip!.shape === 'square') a = squareAlpha(lx, ly, R, h)
          else a = tipAlpha(Math.sqrt(lx * lx + ly * ly), R, h)
        }
        a *= po
        if (a <= 0) continue
        if (tex && texG) {
          const tx = Math.floor(x / tex.scale) % tex.width
          const ty = Math.floor(y / tex.scale) % tex.height
          const t = texG[((ty + tex.height) % tex.height) * tex.width + ((tx + tex.width) % tex.width)] / 255
          a *= 1 - tex.strength * (1 - t)
        }
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
      this.last = { x, y, p: pressure }
      return
    }
    const step = spacingFor(this.settings)
    const dx = x - this.last.x
    const dy = y - this.last.y
    const len = Math.hypot(dx, dy)
    let t = step - this.carry
    const p0 = this.last.p
    while (t <= len) {
      // 필압은 두 점 사이에서 부드럽게 (펜을 누르는 힘이 한 구간 안에서 계단지지 않게)
      this.dab(this.last.x + (dx * t) / len, this.last.y + (dy * t) / len, p0 + ((pressure - p0) * t) / len)
      t += step
    }
    this.carry = len - (t - step)
    this.last = { x, y, p: pressure }
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
