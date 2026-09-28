/**
 * 레이어 효과 — 외곽선 · 그림자 · 색 덮기 · 안쪽 그림자 (순수 TS, RGBA 버퍼).
 *
 * 출처: `~/Compositor` `Document/LayerEffects.swift` (CPU 경로 `render`).
 *  - 결과는 효과가 들어갈 여백(`effectsMargin`)만큼 사방으로 넓힌 새 이미지 — 그림자·바깥 외곽선이 잘리지 않는다.
 *  - 그리는 순서: 그림자 → 바깥 외곽선 → 원래 픽셀 → 색 덮기 → 안쪽 그림자 → 안쪽 외곽선.
 *  - 외곽선 = 모양을 size 만큼 넓힌(또는 좁힌) 것 − 모양 (사각 반경 — 직사각형 모서리가 물결치지 않게).
 *    넓히기/좁히기는 슬라이딩 윈도 최대/최소(덱) 두 번 — 비용이 두께와 무관.
 *  - 그림자 각도 = 빛이 오는 방향(도, 반시계, 90 = 위에서) → 그림자는 반대쪽으로 떨어진다. 흐림 σ = blur/2.
 * 변환기에서의 쓰임: AI 배경 제거 뒤 **스티커**(흰 외곽선 + 그림자), 로고 윤곽선.
 */
import { parseHex } from './adjust'

export interface StrokeEffect {
  enabled: boolean
  size: number
  color: string
  opacity: number
  inside: boolean
}
export interface ShadowEffect {
  enabled: boolean
  angle: number
  distance: number
  blur: number
  color: string
  opacity: number
}
export interface OverlayEffect {
  enabled: boolean
  color: string
  opacity: number
}

export interface GlowEffect {
  enabled: boolean
  /** 번지는 크기 px */
  size: number
  /** 퍼짐 % — 번지기 전에 모양을 얼마나 넓힐지 (100 이면 딱딱한 테두리) */
  spread: number
  color: string
  opacity: number
}

export interface LayerEffects {
  stroke: StrokeEffect
  shadow: ShadowEffect
  overlay: OverlayEffect
  innerShadow: ShadowEffect
  /** 외부 광선 (v1.1 — 없으면 끔) */
  outerGlow?: GlowEffect
  /** 그라데이션 덮기 (v1.2 — 없으면 끔). 색 덮기 아래에 깔린다 (포토샵 순서) */
  gradientOverlay?: GradientOverlayEffect
  /** 경사와 엠보스 (v1.2 — 없으면 끔). 맨 위에 얹힌다 */
  bevel?: BevelEffect
}

export interface GradientOverlayEffect {
  enabled: boolean
  style: 'linear' | 'radial'
  /** 도, 0 = 왼쪽→오른쪽, 90 = 아래→위 (포토샵과 같음) */
  angle: number
  colors: [string, string]
  opacity: number
  /** 모양 크기 대비 % (10~150) */
  scale: number
  reverse: boolean
}
export const DEFAULT_GRADIENT_OVERLAY: GradientOverlayEffect = { enabled: false, style: 'linear', angle: 90, colors: ['#000000', '#ffffff'], opacity: 1, scale: 100, reverse: false }

export interface BevelEffect {
  enabled: boolean
  /** inner = 모양 안쪽 경사, outer = 바깥쪽, emboss = 둘 다 */
  style: 'inner' | 'outer' | 'emboss'
  /** 경사 폭 px */
  size: number
  /** 깊이 % (1~500) */
  depth: number
  /** 부드럽게 px */
  soften: number
  /** 빛 각도 도 (반시계, 90 = 위) · 고도 (0~90) */
  angle: number
  altitude: number
  direction: 'up' | 'down'
  highlightColor: string
  highlightOpacity: number
  shadowColor: string
  shadowOpacity: number
}
export const DEFAULT_BEVEL: BevelEffect = {
  enabled: false,
  style: 'inner',
  size: 5,
  depth: 100,
  soften: 0,
  angle: 120,
  altitude: 30,
  direction: 'up',
  highlightColor: '#ffffff',
  highlightOpacity: 0.75,
  shadowColor: '#000000',
  shadowOpacity: 0.75
}

export const DEFAULT_GLOW: GlowEffect = { enabled: false, size: 20, spread: 0, color: '#ffffbe', opacity: 0.75 }

/** Compositor 각 효과의 기본값 (외곽선 4px 검정 · 그림자 90°/20/20/50% · 안쪽 그림자 90°/10/10/50%) */
export const DEFAULT_EFFECTS: LayerEffects = {
  stroke: { enabled: false, size: 4, color: '#000000', opacity: 1, inside: false },
  shadow: { enabled: false, angle: 90, distance: 20, blur: 20, color: '#000000', opacity: 0.5 },
  overlay: { enabled: false, color: '#000000', opacity: 1 },
  innerShadow: { enabled: false, angle: 90, distance: 10, blur: 10, color: '#000000', opacity: 0.5 }
}

export function hasEffects(e: LayerEffects | null | undefined): e is LayerEffects {
  return !!e && (e.stroke.enabled || e.shadow.enabled || e.overlay.enabled || e.innerShadow.enabled || !!e.outerGlow?.enabled || !!e.gradientOverlay?.enabled || !!e.bevel?.enabled)
}

/** 그림자가 떨어지는 방향 (px, y 아래로) */
export function shadowOffset(s: { angle: number; distance: number }): { dx: number; dy: number } {
  const r = (s.angle * Math.PI) / 180
  return { dx: -Math.cos(r) * s.distance, dy: Math.sin(r) * s.distance }
}

/** 효과가 차지할 여백 (px) — Compositor `margin(for:)` */
export function effectsMargin(e: LayerEffects): number {
  let m = 0
  if (e.stroke.enabled && !e.stroke.inside) m = Math.max(m, e.stroke.size)
  if (e.shadow.enabled) m = Math.max(m, e.shadow.distance + e.shadow.blur * 3)
  if (e.outerGlow?.enabled) m = Math.max(m, e.outerGlow.size * 1.6)
  if (e.bevel?.enabled && e.bevel.style !== 'inner') m = Math.max(m, e.bevel.size + e.bevel.soften * 2)
  return hasEffects(e) ? Math.ceil(m) + 2 : 0
}

/** px 값을 배율 s 로 (미리보기 축소본용) */
export function scaleEffects(e: LayerEffects, s: number): LayerEffects {
  return {
    stroke: { ...e.stroke, size: e.stroke.size * s },
    shadow: { ...e.shadow, distance: e.shadow.distance * s, blur: e.shadow.blur * s },
    overlay: e.overlay,
    innerShadow: { ...e.innerShadow, distance: e.innerShadow.distance * s, blur: e.innerShadow.blur * s },
    outerGlow: e.outerGlow ? { ...e.outerGlow, size: e.outerGlow.size * s } : undefined,
    gradientOverlay: e.gradientOverlay,
    bevel: e.bevel ? { ...e.bevel, size: e.bevel.size * s, soften: e.bevel.soften * s } : undefined
  }
}

/** 슬라이딩 윈도 최대(또는 최소) — 가로·세로 두 번. 가장자리 바깥은 최소일 때 0 (Compositor `extreme`) */
export function extreme(src: Float32Array, width: number, height: number, reach: number, smallest: boolean): Float32Array {
  const radius = Math.max(0, Math.round(reach))
  const pass = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const queue = new Int32Array(Math.max(width, height))
  const sweep = (input: Float32Array, output: Float32Array, lines: number, count: number, lineStep: number, elementStep: number): void => {
    for (let line = 0; line < lines; line++) {
      const base = line * lineStep
      let head = 0
      let tail = 0
      let next = 0
      for (let center = 0; center < count; center++) {
        while (next <= Math.min(count - 1, center + radius)) {
          const value = input[base + next * elementStep]
          while (tail > head) {
            const prev = input[base + queue[tail - 1] * elementStep]
            if (smallest ? prev < value : prev > value) break
            tail--
          }
          queue[tail++] = next++
        }
        while (head < tail && queue[head] < center - radius) head++
        const outside = center < radius || center + radius >= count
        output[base + center * elementStep] = smallest && outside ? 0 : input[base + queue[head] * elementStep]
      }
    }
  }
  sweep(src, pass, height, width, width, 1)
  sweep(pass, out, width, height, 1, width)
  return out
}

/** 상자 3회 흐림 (0~1 단일 채널) — σ ≈ blur/2 */
function blurMask(m: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return m
  const r = Math.max(1, Math.round((Math.sqrt((12 * sigma * sigma) / 3 + 1) - 1) / 2))
  let a = m
  for (let k = 0; k < 3; k++) {
    a = boxLine(a, width, height, r, true)
    a = boxLine(a, width, height, r, false)
  }
  return a
}

function boxLine(src: Float32Array, width: number, height: number, r: number, horizontal: boolean): Float32Array {
  const dst = new Float32Array(src.length)
  const span = r * 2 + 1
  const lines = horizontal ? height : width
  const count = horizontal ? width : height
  const step = horizontal ? 1 : width
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width : line
    let sum = 0
    for (let k = 0; k <= Math.min(r, count - 1); k++) sum += src[base + k * step]
    for (let i = 0; i < count; i++) {
      dst[base + i * step] = sum / span
      if (i + r + 1 < count) sum += src[base + (i + r + 1) * step]
      if (i - r >= 0) sum -= src[base + (i - r) * step]
    }
  }
  return dst
}

/** 알파(0~1)를 (dx,dy) 만큼 옮긴 새 마스크 (정수 이동 — 반올림) */
function shift(m: Float32Array, width: number, height: number, dx: number, dy: number): Float32Array {
  const ox = Math.round(dx)
  const oy = Math.round(dy)
  const out = new Float32Array(m.length)
  for (let y = 0; y < height; y++) {
    const sy = y - oy
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < width; x++) {
      const sx = x - ox
      if (sx < 0 || sx >= width) continue
      out[y * width + x] = m[sy * width + sx]
    }
  }
  return out
}

/** color·opacity 를 coverage 비율로 dst(프리멀티플라이드 float) 위에 source-over */
function fillOver(dst: Float32Array, coverage: Float32Array, hex: string, opacity: number): void {
  const [r, g, b] = parseHex(hex)
  for (let i = 0; i < coverage.length; i++) {
    const a = coverage[i] * opacity
    if (a <= 0) continue
    const o = i * 4
    const inv = 1 - a
    dst[o] = r * a + dst[o] * inv
    dst[o + 1] = g * a + dst[o + 1] * inv
    dst[o + 2] = b * a + dst[o + 2] * inv
    dst[o + 3] = 255 * a + dst[o + 3] * inv
  }
}

/**
 * 효과를 입힌 새 이미지 — 사방 inset 만큼 넓어진다.
 * 입력·출력 모두 스트레이트 알파 RGBA.
 */
export function renderEffects(rgba: Uint8ClampedArray, width: number, height: number, e: LayerEffects): { data: Uint8ClampedArray; width: number; height: number; inset: number } {
  const inset = effectsMargin(e)
  const W = width + inset * 2
  const H = height + inset * 2
  // 넓힌 캔버스의 모양(알파)과 원래 픽셀(프리멀티플라이드)
  const shape = new Float32Array(W * H)
  const pixels = new Float32Array(W * H * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4
      const d = (y + inset) * W + (x + inset)
      const a = rgba[s + 3] / 255
      shape[d] = a
      pixels[d * 4] = rgba[s] * a
      pixels[d * 4 + 1] = rgba[s + 1] * a
      pixels[d * 4 + 2] = rgba[s + 2] * a
      pixels[d * 4 + 3] = rgba[s + 3]
    }
  }
  const out = new Float32Array(W * H * 4)
  const strokeRing = (): Float32Array => {
    const moved = extreme(shape, W, H, Math.max(1, e.stroke.size), e.stroke.inside)
    const ring = new Float32Array(shape.length)
    for (let i = 0; i < ring.length; i++) ring[i] = e.stroke.inside ? Math.max(0, shape[i] - moved[i]) : Math.max(0, moved[i] - shape[i])
    return ring
  }
  if (e.shadow.enabled && e.shadow.opacity > 0) {
    const { dx, dy } = shadowOffset(e.shadow)
    fillOver(out, blurMask(shift(shape, W, H, dx, dy), W, H, e.shadow.blur / 2), e.shadow.color, e.shadow.opacity)
  }
  // 외부 광선: 그림자 위·원래 픽셀 아래 (포토샵 순서) — 퍼짐만큼 넓힌 뒤 나머지 크기로 흐림
  const g = e.outerGlow
  if (g?.enabled && g.opacity > 0 && g.size > 0) {
    const spreadPx = (g.size * Math.max(0, Math.min(100, g.spread))) / 100
    const grown = spreadPx >= 1 ? extreme(shape, W, H, spreadPx, false) : shape
    fillOver(out, blurMask(grown, W, H, Math.max(0.5, (g.size - spreadPx) / 2)), g.color, g.opacity)
  }
  const stroke = e.stroke.enabled && e.stroke.size > 0 && e.stroke.opacity > 0
  if (stroke && !e.stroke.inside) fillOver(out, strokeRing(), e.stroke.color, e.stroke.opacity)
  // 원래 픽셀 source-over
  for (let i = 0; i < shape.length; i++) {
    const a = pixels[i * 4 + 3] / 255
    if (a <= 0) continue
    const o = i * 4
    const inv = 1 - a
    out[o] = pixels[o] + out[o] * inv
    out[o + 1] = pixels[o + 1] + out[o + 1] * inv
    out[o + 2] = pixels[o + 2] + out[o + 2] * inv
    out[o + 3] = pixels[o + 3] + out[o + 3] * inv
  }
  const go = e.gradientOverlay
  if (go?.enabled && go.opacity > 0) gradientOver(out, shape, W, H, inset, width, height, go)
  if (e.overlay.enabled && e.overlay.opacity > 0) fillOver(out, shape, e.overlay.color, e.overlay.opacity)
  if (e.innerShadow.enabled && e.innerShadow.opacity > 0) {
    const { dx, dy } = shadowOffset(e.innerShadow)
    const moved = blurMask(shift(shape, W, H, dx, dy), W, H, e.innerShadow.blur / 2)
    const inside = new Float32Array(shape.length)
    for (let i = 0; i < inside.length; i++) inside[i] = Math.max(0, Math.min(1, shape[i] * (1 - moved[i])))
    fillOver(out, inside, e.innerShadow.color, e.innerShadow.opacity)
  }
  const bv = e.bevel
  if (bv?.enabled && bv.size > 0) bevelOver(out, shape, W, H, bv)
  if (stroke && e.stroke.inside) fillOver(out, strokeRing(), e.stroke.color, e.stroke.opacity)
  // 스트레이트 알파로
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]
    data[i + 3] = a
    if (a > 0) {
      const k = 255 / a
      data[i] = out[i] * k
      data[i + 1] = out[i + 1] * k
      data[i + 2] = out[i + 2] * k
    }
  }
  return { data, width: W, height: H, inset }
}

/** 그라데이션 덮기 — 모양(원래 픽셀 경계 상자) 기준 각도·크기로 두 색 사이를 source-over */
function gradientOver(dst: Float32Array, shape: Float32Array, W: number, H: number, inset: number, width: number, height: number, g: GradientOverlayEffect): void {
  const c0 = parseHex(g.reverse ? g.colors[1] : g.colors[0])
  const c1 = parseHex(g.reverse ? g.colors[0] : g.colors[1])
  const cx = inset + width / 2
  const cy = inset + height / 2
  const sc = Math.max(0.1, g.scale / 100)
  const r = (g.angle * Math.PI) / 180
  const dx = Math.cos(r)
  const dy = -Math.sin(r)
  // 선형: 모양을 각도 방향으로 관통하는 길이의 절반 (포토샵처럼 모양에 맞춘다)
  const half = ((Math.abs(dx) * width + Math.abs(dy) * height) / 2) * sc
  const rad = (Math.max(width, height) / 2) * sc
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      const a = shape[i] * g.opacity
      if (a <= 0) continue
      const px = x + 0.5 - cx
      const py = y + 0.5 - cy
      const t = g.style === 'radial' ? Math.min(1, Math.hypot(px, py) / rad) : Math.min(1, Math.max(0, (px * dx + py * dy) / (half * 2) + 0.5))
      const o = i * 4
      const inv = 1 - a
      dst[o] = (c0[0] + (c1[0] - c0[0]) * t) * a + dst[o] * inv
      dst[o + 1] = (c0[1] + (c1[1] - c0[1]) * t) * a + dst[o + 1] * inv
      dst[o + 2] = (c0[2] + (c1[2] - c0[2]) * t) * a + dst[o + 2] * inv
      dst[o + 3] = 255 * a + dst[o + 3] * inv
    }
}

/**
 * 경사와 엠보스 — 높이 = 모양(안쪽) 또는 넓힌 모양(바깥)을 size 만큼 흐린 것. 높이의 기울기와 빛 방향의 내적으로
 * 밝은 면(하이라이트)·어두운 면(그림자)을 나눠 얹는다. 포토샵의 정확한 수식은 아니지만 각도·고도·깊이·크기의 뜻은 같다.
 */
function bevelOver(dst: Float32Array, shape: Float32Array, W: number, H: number, b: BevelEffect): void {
  const size = Math.max(1, b.size)
  const outer = b.style !== 'inner' ? extreme(shape, W, H, size, false) : null
  const base = b.style === 'outer' ? outer! : b.style === 'emboss' ? outer! : shape
  const height = blurMask(base, W, H, size / 2)
  const r = (b.angle * Math.PI) / 180
  const alt = (Math.max(0, Math.min(90, b.altitude)) * Math.PI) / 180
  const lx = Math.cos(r) * Math.cos(alt)
  const ly = -Math.sin(r) * Math.cos(alt)
  const depth = (b.depth / 100) * (b.direction === 'down' ? -1 : 1)
  const hi = new Float32Array(W * H)
  const sh = new Float32Array(W * H)
  // 어디에 칠하나: inner = 모양 안, outer = 넓힌 띠(바깥), emboss = 둘 다
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      const region = b.style === 'inner' ? shape[i] : b.style === 'outer' ? Math.max(0, outer![i] - shape[i]) : outer![i]
      if (region <= 0) continue
      const gx = (height[i + 1] - height[i - 1]) * size
      const gy = (height[i + W] - height[i - W]) * size
      // 법선 = (−∂h/∂x, −∂h/∂y, 1) — 빛을 향한 면이 밝다
      const s = -(gx * lx + gy * ly) * depth * 1.5
      if (s > 0) hi[i] = Math.min(1, s) * region
      else if (s < 0) sh[i] = Math.min(1, -s) * region
    }
  const soft = b.soften > 0 ? (m: Float32Array): Float32Array => blurMask(m, W, H, b.soften / 2) : (m: Float32Array): Float32Array => m
  fillOver(dst, soft(sh), b.shadowColor, b.shadowOpacity)
  fillOver(dst, soft(hi), b.highlightColor, b.highlightOpacity)
}
