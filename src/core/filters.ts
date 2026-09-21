/**
 * 필터 — 가우시안 블러 · 모션 블러 · 노이즈 추가 · 렌즈 보정 (순수 TS, RGBA 버퍼).
 *
 * 출처: `~/Compositor` `Document/Filters.swift` + C 커널 `Rendering/NoisePixels.c`·`LensPixels.c`.
 *  - 노이즈: 같은 해시·Box–Muller·알파 보존 수식을 그대로 옮김 (seed 가 같으면 같은 무늬).
 *  - 렌즈 보정: 대각선 절반 기준 방사 왜곡 `scale = 1 − k·r²/R²`, 양선형 샘플 (강도 = distortion/100 × 0.35).
 *  - 가우시안 블러: Compositor 는 Core Image. 여기서는 **상자 흐림 3회**(σ 근사, 비용이 반경과 무관).
 *  - 모션 블러: Core Image `CIMotionBlur` 대신 각도 방향 선분 평균 (거리 px, 각도 = 반시계 도).
 * 흐림은 프리멀티플라이드로 계산해 투명 경계가 검게 번지지 않는다.
 */

export interface Filters {
  /** 가우시안 블러 반경(px, σ) 0 = 끔 */
  blur: number
  /** 모션 블러 거리(px) 0 = 끔 */
  motionDistance: number
  /** 모션 블러 각도(도, 반시계) */
  motionAngle: number
  /** 노이즈 양 0~100 */
  noise: number
  /** 가우시안 분포 노이즈 (아니면 균일) */
  noiseGaussian: boolean
  /** 단색 노이즈 (세 채널 같은 값) */
  noiseMono: boolean
  /** 렌즈 보정 −100~100 (양수 = 술통형 왜곡 펴기) */
  lens: number
}

export const DEFAULT_FILTERS: Filters = { blur: 0, motionDistance: 0, motionAngle: 0, noise: 0, noiseGaussian: true, noiseMono: false, lens: 0 }

export function hasFilters(f: Filters | null | undefined): f is Filters {
  return !!f && (f.blur > 0 || f.motionDistance > 0 || f.noise > 0 || f.lens !== 0)
}

/** 흐림이 바깥으로 번질 여유(px) — Compositor `blurMargin` (투명 배경 이미지를 넓혀서 흐릴 때) */
export function filterMargin(f: Filters): number {
  return Math.ceil(Math.max(f.blur > 0 ? f.blur * 3 + 2 : 0, f.motionDistance > 0 ? f.motionDistance / 2 + 2 : 0))
}

/** px 단위 값을 배율 s 로 (미리보기는 축소본에서 돌리므로) */
export function scaleFilters(f: Filters, s: number): Filters {
  return { ...f, blur: f.blur * s, motionDistance: f.motionDistance * s }
}

/**
 * 필터 전부를 Compositor 메뉴 순서(렌즈 → 흐림 → 모션 → 노이즈)로 적용. 새 버퍼를 돌려준다.
 * edges: 'clamp' = 가장자리 픽셀을 늘려 흐림 (사진 — 테두리가 투명하게 번지지 않게),
 *        'transparent' = 바깥을 투명으로 보고 흐림 (누끼 — 호출측이 filterMargin 만큼 미리 넓혀 둔다).
 */
export function applyFilters(rgba: Uint8ClampedArray, width: number, height: number, f: Filters, seed = 0x9e3779b9, edges: 'clamp' | 'transparent' = 'transparent'): Uint8ClampedArray {
  let out = rgba
  if (f.lens) out = lensDistort(out, width, height, (Math.max(-100, Math.min(100, f.lens)) / 100) * 0.35)
  if (f.blur > 0 || f.motionDistance > 0) {
    const m = edges === 'clamp' ? filterMargin(f) : 0
    let work = m ? padEdges(out, width, height, m) : out
    const W = width + m * 2
    const H = height + m * 2
    if (f.blur > 0) work = gaussianBlur(work, W, H, f.blur)
    if (f.motionDistance > 0) work = motionBlur(work, W, H, f.motionDistance, f.motionAngle)
    out = m ? cropPad(work, W, width, height, m) : work
  }
  if (f.noise > 0) {
    if (out === rgba) out = rgba.slice()
    addNoise(out, width, height, f.noise, f.noiseGaussian, f.noiseMono, seed)
  }
  return out
}

// ── 흐림 ──────────────────────────────────────────────────────────────────

/** 가장자리 픽셀을 m 만큼 복제해 넓힌 사본 */
export function padEdges(src: Uint8ClampedArray, w: number, h: number, m: number): Uint8ClampedArray {
  const W = w + m * 2
  const H = h + m * 2
  const out = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - m))
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - m))
      out.set(src.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * W + x) * 4)
    }
  }
  return out
}

function cropPad(src: Uint8ClampedArray, W: number, w: number, h: number, m: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) out.set(src.subarray(((y + m) * W + m) * 4, ((y + m) * W + m + w) * 4), y * w * 4)
  return out
}

/** 프리멀티플라이드 float 사본 */
function premultiply(src: Uint8ClampedArray): Float32Array {
  const p = new Float32Array(src.length)
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255
    p[i] = src[i] * a
    p[i + 1] = src[i + 1] * a
    p[i + 2] = src[i + 2] * a
    p[i + 3] = src[i + 3]
  }
  return p
}

function unpremultiply(p: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(p.length)
  for (let i = 0; i < p.length; i += 4) {
    const a = p[i + 3]
    out[i + 3] = a
    if (a > 0) {
      const k = 255 / a
      out[i] = p[i] * k
      out[i + 1] = p[i + 1] * k
      out[i + 2] = p[i + 2] * k
    }
  }
  return out
}

/** 한 방향 상자 흐림 (가장자리 바깥 = 투명 — 흐림이 테두리에서 번지듯 옅어진다) */
function boxPass(src: Float32Array, dst: Float32Array, width: number, height: number, r: number, horizontal: boolean): void {
  const span = r * 2 + 1
  const lines = horizontal ? height : width
  const count = horizontal ? width : height
  const step = horizontal ? 4 : width * 4
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * width * 4 : line * 4
    for (let c = 0; c < 4; c++) {
      let sum = 0
      for (let k = 0; k <= Math.min(r, count - 1); k++) sum += src[base + k * step + c]
      for (let i = 0; i < count; i++) {
        dst[base + i * step + c] = sum / span
        const add = i + r + 1
        const sub = i - r
        if (add < count) sum += src[base + add * step + c]
        if (sub >= 0) sum -= src[base + sub * step + c]
      }
    }
  }
}

/** 가우시안 근사 — 상자 3회 (σ 에 맞는 상자 폭은 √(12σ²/3+1)) */
export function gaussianBlur(rgba: Uint8ClampedArray, width: number, height: number, sigma: number): Uint8ClampedArray {
  if (sigma <= 0) return rgba
  const r = Math.max(1, Math.round((Math.sqrt((12 * sigma * sigma) / 3 + 1) - 1) / 2))
  let a: Float32Array = premultiply(rgba)
  let b: Float32Array = new Float32Array(a.length)
  for (let k = 0; k < 3; k++) {
    boxPass(a, b, width, height, r, true)
    ;[a, b] = [b, a]
    boxPass(a, b, width, height, r, false)
    ;[a, b] = [b, a]
  }
  return unpremultiply(a)
}

/** 모션 블러 — 각도 방향으로 distance 길이 선분의 평균 (양선형 샘플, 바깥 = 투명) */
export function motionBlur(rgba: Uint8ClampedArray, width: number, height: number, distance: number, angleDeg: number): Uint8ClampedArray {
  if (distance <= 0) return rgba
  const p = premultiply(rgba)
  const out = new Float32Array(p.length)
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = -Math.sin(rad) // 화면 y 는 아래로 — 반시계 각도
  const samples = Math.max(2, Math.ceil(distance))
  const acc = [0, 0, 0, 0]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      acc[0] = acc[1] = acc[2] = acc[3] = 0
      for (let s = 0; s < samples; s++) {
        const t = (s / (samples - 1) - 0.5) * distance
        sampleBilinear(p, width, height, x + dx * t, y + dy * t, acc)
      }
      const o = (y * width + x) * 4
      out[o] = acc[0] / samples
      out[o + 1] = acc[1] / samples
      out[o + 2] = acc[2] / samples
      out[o + 3] = acc[3] / samples
    }
  }
  return unpremultiply(out)
}

/** (sx,sy) 양선형 샘플을 acc 에 더한다 (바깥은 0) */
function sampleBilinear(p: Float32Array, width: number, height: number, sx: number, sy: number, acc: number[]): void {
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const fx = sx - x0
  const fy = sy - y0
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j
    if (yy < 0 || yy >= height) continue
    const wy = j ? fy : 1 - fy
    if (!wy) continue
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i
      if (xx < 0 || xx >= width) continue
      const w = wy * (i ? fx : 1 - fx)
      if (!w) continue
      const o = (yy * width + xx) * 4
      acc[0] += p[o] * w
      acc[1] += p[o + 1] * w
      acc[2] += p[o + 2] * w
      acc[3] += p[o + 3] * w
    }
  }
}

// ── 렌즈 보정 (LensPixels.c) ──────────────────────────────────────────────

export function lensDistort(rgba: Uint8ClampedArray, width: number, height: number, k: number): Uint8ClampedArray {
  if (!k) return rgba
  const out = new Uint8ClampedArray(rgba.length)
  const cx = width * 0.5
  const cy = height * 0.5
  const halfDiag2 = cx * cx + cy * cy
  const acc = [0, 0, 0, 0]
  const src = new Float32Array(rgba) // 양선형 합산용 (알파 포함 그대로 — C 원본과 같음)
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - cy
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx
      const scale = 1 - (k * (dx * dx + dy * dy)) / halfDiag2
      acc[0] = acc[1] = acc[2] = acc[3] = 0
      sampleBilinear(src, width, height, cx + dx * scale - 0.5, cy + dy * scale - 0.5, acc)
      const o = (y * width + x) * 4
      out[o] = Math.round(acc[0])
      out[o + 1] = Math.round(acc[1])
      out[o + 2] = Math.round(acc[2])
      out[o + 3] = Math.round(acc[3])
    }
  }
  return out
}

// ── 노이즈 (NoisePixels.c) ────────────────────────────────────────────────

function noiseHash(v: number): number {
  let x = v >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d) >>> 0
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b) >>> 0
  x ^= x >>> 16
  return x >>> 0
}
const unit = (key: number): number => (noiseHash(key) >>> 8) * (1 / 16777216)

/** 노이즈 추가 (in place) — 투명 픽셀은 건너뛰고 알파 비율을 지킨다 */
export function addNoise(rgba: Uint8ClampedArray, width: number, height: number, amount: number, gaussian: boolean, mono: boolean, seed: number): void {
  const spread = (amount / 100) * 127.5
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const alpha = rgba[o + 3]
      if (!alpha) continue
      const base = noiseHash((seed ^ noiseHash(y * width + x)) >>> 0)
      for (let c = 0; c < 3; c++) {
        const key = mono ? base : (base + Math.imul(c, 0x9e3779b9)) >>> 0
        let n: number
        if (gaussian) {
          const u1 = unit(key)
          const u2 = unit((key ^ 0x68e31da4) >>> 0)
          n = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(6.2831853 * u2) * spread * (2 / 3)
        } else {
          n = (unit(key) * 2 - 1) * spread
        }
        const value = Math.min(255, Math.max(0, (rgba[o + c] * 255) / alpha + n))
        rgba[o + c] = Math.round((value * alpha) / 255)
      }
    }
  }
}
