/**
 * 이미지 보정 (순수 TS — 캔버스 없이 RGBA 버퍼만 다룬다. 그래서 테스트된다).
 *
 * 출처: `~/Compositor` 의 `Document/ImageAdjustments.swift`(노출·그라데이션 맵),
 * `Document/Levels.swift`(레벨 수식), `Document/LevelsAutomatic.swift`(자동 레벨 0.1% 클리핑),
 * `Document/Curves.swift`(커브), `Document/HueSaturation.swift`(색조/채도).
 *
 * Compositor 와 맞춘 것
 *  - 노출은 **선형광(sRGB 디코드 → 노출·오프셋 → 감마 → sRGB 인코드)** 에서 계산한다.
 *  - 레벨: `in = clamp((v−black)/(white−black))`, `out = outBlack + in^(1/gamma)·(outWhite−outBlack)`.
 *  - 자동 레벨: 채널 히스토그램의 위아래 0.1% 를 잘라 낸 지점을 검정·흰색 끝으로.
 *
 *  - 레벨·커브는 채널별(R/G/B) 값을 먼저, RGB 합성 값을 나중에 적용 (`ranges[0].apply(ranges[c].apply(v))`).
 *  - 색조/채도: 마스터 + 6색역(빨강·노랑·초록·청록·파랑·자홍) 밴드 가중(`HueBand.weight`) + 색상화(Colorize).
 *  - 자동 레벨 3모드(대비·색상·색상+중간톤 중립) + 검정/회색/흰 점 스포이트 (`LevelsAuto`, `sampling`).
 *
 * 다른 점(의도적)
 *  - 픽셀 커널은 Swift+C 대신 TS 루프 — 미리보기는 축소본에 적용해 비용을 맞춘다.
 *  - 색역 밴드 경계는 기본값(Photoshop 기본 밴드)만 쓴다 — 밴드 핸들 편집 UI 는 에디터 쪽 기능.
 *
 * 적용 순서: 톤 LUT(노출→채널 레벨→RGB 레벨→채널 커브→RGB 커브→반전) → 색조/채도 → 그라데이션 맵 → 그레인.
 * 알파는 건드리지 않는다.
 */

export interface CurvePoint {
  /** 입력 0~255 */
  x: number
  /** 출력 0~255 */
  y: number
}

export interface GradientMap {
  /** 어두운 쪽 색 '#rrggbb' */
  shadows: string
  /** 밝은 쪽 색 '#rrggbb' */
  highlights: string
  reversed: boolean
}

/** 채널 하나의 레벨·커브 (R/G/B 개별) */
export interface ChannelTone {
  inBlack: number
  inWhite: number
  midtone: number
  outBlack: number
  outWhite: number
  curve: CurvePoint[]
}

export type ToneChannel = 'r' | 'g' | 'b'

/** Photoshop Cmd+U 의 6색역 */
export type ColorRange = 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas'

export const COLOR_RANGES: { key: ColorRange; label: string }[] = [
  { key: 'reds', label: '빨강 계열' },
  { key: 'yellows', label: '노랑 계열' },
  { key: 'greens', label: '초록 계열' },
  { key: 'cyans', label: '청록 계열' },
  { key: 'blues', label: '파랑 계열' },
  { key: 'magentas', label: '자홍 계열' }
]

/** 색역 밴드 (도): 감쇠 시작 · 범위 시작 · 범위 끝 · 감쇠 끝 — Compositor `ColorRange.defaultBand` */
export const HUE_BANDS: Record<ColorRange, [number, number, number, number]> = {
  reds: [315, 345, 15, 45],
  yellows: [15, 45, 75, 105],
  greens: [75, 105, 135, 165],
  cyans: [135, 165, 195, 225],
  blues: [195, 225, 255, 285],
  magentas: [255, 285, 315, 345]
}

export interface RangeAdjustment {
  hue: number
  saturation: number
  lightness: number
}

export interface Adjustments {
  /** 노출(스톱) −5~5 */
  exposure: number
  /** 선형광에서 더하는 오프셋 −0.5~0.5 */
  offset: number
  /** 감마 0.1~3 (1보다 크면 중간톤이 밝아짐) */
  gamma: number
  /** 레벨 입력 검정 0~254 */
  inBlack: number
  /** 레벨 입력 흰색 1~255 */
  inWhite: number
  /** 레벨 중간톤 감마 0.1~9.99 */
  midtone: number
  /** 레벨 출력 검정/흰색 0~255 */
  outBlack: number
  outWhite: number
  /** 커브 제어점 (2개 이상, x 오름차순). 기본 [{0,0},{255,255}] = 직선 */
  curve: CurvePoint[]
  /** 색조 회전 −180~180도 */
  hue: number
  /** 채도 −100~100 */
  saturation: number
  /** 밝기(HSL L) −100~100 */
  lightness: number
  /** 필름 그레인 0~100 */
  grain: number
  /** 색 반전 */
  invert: boolean
  /** 그라데이션 맵 (null = 끔) */
  gradientMap: GradientMap | null
  /** 채널별 레벨·커브 (RGB 합성보다 먼저) */
  channels: Record<ToneChannel, ChannelTone>
  /** 색역별 색조/채도/밝기 (마스터는 hue/saturation/lightness) */
  hueRanges: Partial<Record<ColorRange, RangeAdjustment>>
  /** 색상화 — 모든 픽셀을 한 색조로 (hue 0~360, saturation 0~100 으로 해석) */
  colorize: boolean
}

const IDENTITY_CURVE: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 255, y: 255 }
]
export const DEFAULT_TONE: ChannelTone = { inBlack: 0, inWhite: 255, midtone: 1, outBlack: 0, outWhite: 255, curve: IDENTITY_CURVE }

export function isIdentityTone(t: ChannelTone): boolean {
  return t.inBlack === 0 && t.inWhite === 255 && t.midtone === 1 && t.outBlack === 0 && t.outWhite === 255 && isIdentityCurve(t.curve)
}

export const DEFAULT_ADJUST: Adjustments = {
  exposure: 0,
  offset: 0,
  gamma: 1,
  inBlack: 0,
  inWhite: 255,
  midtone: 1,
  outBlack: 0,
  outWhite: 255,
  curve: [
    { x: 0, y: 0 },
    { x: 255, y: 255 }
  ],
  hue: 0,
  saturation: 0,
  lightness: 0,
  grain: 0,
  invert: false,
  gradientMap: null,
  channels: { r: DEFAULT_TONE, g: DEFAULT_TONE, b: DEFAULT_TONE },
  hueRanges: {},
  colorize: false
}

/** 보정이 하나라도 걸려 있는가 (없으면 픽셀 루프를 아예 돌지 않는다) */
export function hasAdjust(a: Adjustments | null | undefined): a is Adjustments {
  if (!a) return false
  return (
    a.exposure !== 0 ||
    a.offset !== 0 ||
    a.gamma !== 1 ||
    a.inBlack !== 0 ||
    a.inWhite !== 255 ||
    a.midtone !== 1 ||
    a.outBlack !== 0 ||
    a.outWhite !== 255 ||
    !isIdentityCurve(a.curve) ||
    a.hue !== 0 ||
    a.saturation !== 0 ||
    a.lightness !== 0 ||
    a.grain > 0 ||
    a.invert ||
    a.gradientMap !== null ||
    a.colorize ||
    (!!a.channels && (!isIdentityTone(a.channels.r) || !isIdentityTone(a.channels.g) || !isIdentityTone(a.channels.b))) ||
    Object.values(a.hueRanges ?? {}).some((r) => !!r && (r.hue !== 0 || r.saturation !== 0 || r.lightness !== 0))
  )
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  if (points.length !== 2) return false
  return points[0].x === 0 && points[0].y === 0 && points[1].x === 255 && points[1].y === 255
}

// ── 톤 LUT ────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v)

/** sRGB(0~1) → 선형광 */
export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}
/** 선형광 → sRGB(0~1) */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

/** 레벨 한 벌 (0~1 → 0~1) — Compositor `LevelRange.apply` */
function levelsFn(t: { inBlack: number; inWhite: number; midtone: number; outBlack: number; outWhite: number }): (v: number) => number {
  const inBlack = clamp(num(t.inBlack, 0), 0, 254)
  const inWhite = clamp(num(t.inWhite, 255), inBlack + 1, 255)
  const midtone = clamp(num(t.midtone, 1), 0.1, 9.99)
  const outBlack = clamp(num(t.outBlack, 0), 0, 255)
  const outWhite = clamp(num(t.outWhite, 255), 0, 255)
  return (v) => {
    const input = clamp((v * 255 - inBlack) / (inWhite - inBlack), 0, 1)
    return (outBlack + Math.pow(input, 1 / midtone) * (outWhite - outBlack)) / 255
  }
}

/**
 * 채널별 256칸 표 [R, G, B]. 노출 → 채널 레벨 → RGB 레벨 → 채널 커브 → RGB 커브 → 반전.
 * (채널 값을 먼저, RGB 합성 값을 나중에 — Compositor Levels/Curves 와 같은 순서)
 */
export function toneLuts(a: Adjustments): [Uint8Array, Uint8Array, Uint8Array] {
  const exposure = clamp(num(a.exposure, 0), -20, 20)
  const offset = clamp(num(a.offset, 0), -0.5, 0.5)
  const gamma = clamp(num(a.gamma, 1), 0.01, 9.99)
  const scale = Math.pow(2, exposure)
  const rgbLevels = levelsFn(a)
  const rgbCurve = curveLut(a.curve)
  const channels = a.channels ?? DEFAULT_ADJUST.channels
  return (['r', 'g', 'b'] as ToneChannel[]).map((c) => {
    const tone = channels[c] ?? DEFAULT_TONE
    const chLevels = levelsFn(tone)
    const chCurve = curveLut(tone.curve)
    const lut = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      // 1) 노출 — 선형광에서
      let v = i / 255
      if (exposure !== 0 || offset !== 0 || gamma !== 1) {
        let linear = srgbToLinear(v)
        linear = Math.pow(Math.max(0, linear * scale + offset), 1 / gamma)
        v = clamp(linearToSrgb(linear), 0, 1)
      }
      // 2) 레벨 (채널 → RGB)
      v = rgbLevels(chLevels(v))
      // 3) 커브 (채널 → RGB)
      let byte = rgbCurve[chCurve[Math.round(clamp255(v * 255))]]
      // 4) 반전
      if (a.invert) byte = 255 - byte
      lut[i] = byte
    }
    return lut
  }) as [Uint8Array, Uint8Array, Uint8Array]
}

/** RGB 합성 표 (채널별 값이 없을 때 세 채널 공통) — 테스트·히스토그램 표시용 */
export function toneLut(a: Adjustments): Uint8Array {
  return toneLuts({ ...a, channels: DEFAULT_ADJUST.channels })[0]
}

/**
 * 커브 제어점 → 256칸 표. 조각별 단조 3차 보간(Fritsch–Carlson) —
 * 점 사이가 출렁여서 밝기가 거꾸로 가는 일이 없다.
 */
export function curveLut(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256)
  const pts = (points ?? [])
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp255(p.x), y: clamp255(p.y) }))
    .sort((p, q) => p.x - q.x)
  if (pts.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i
    return lut
  }
  const n = pts.length
  // 구간 기울기
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = Math.max(1e-6, pts[i + 1].x - pts[i].x)
    dx.push(h)
    slope.push((pts[i + 1].y - pts[i].y) / h)
  }
  // 접선 (단조성 보정)
  const m: number[] = new Array(n)
  m[0] = slope[0]
  m[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a1 = m[i] / slope[i]
    const b1 = m[i + 1] / slope[i]
    const s = a1 * a1 + b1 * b1
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a1 * slope[i]
      m[i + 1] = t * b1 * slope[i]
    }
  }
  let seg = 0
  for (let x = 0; x < 256; x++) {
    if (x <= pts[0].x) {
      lut[x] = Math.round(pts[0].y)
      continue
    }
    if (x >= pts[n - 1].x) {
      lut[x] = Math.round(pts[n - 1].y)
      continue
    }
    while (seg < n - 2 && x > pts[seg + 1].x) seg++
    const h = dx[seg]
    const t = (x - pts[seg].x) / h
    const t2 = t * t
    const t3 = t2 * t
    const h00 = 2 * t3 - 3 * t2 + 1
    const h10 = t3 - 2 * t2 + t
    const h01 = -2 * t3 + 3 * t2
    const h11 = t3 - t2
    const y = h00 * pts[seg].y + h10 * h * m[seg] + h01 * pts[seg + 1].y + h11 * h * m[seg + 1]
    lut[x] = Math.round(clamp255(y))
  }
  return lut
}

// ── 히스토그램 · 자동 레벨 ────────────────────────────────────────────────

export interface Histogram {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  /** 휘도 (Rec.601) */
  lum: Uint32Array
}

/** RGBA 버퍼의 히스토그램 (알파 0 픽셀은 세지 않는다 — 투명 배경이 검정으로 잡히지 않게) */
export function histogram(rgba: ArrayLike<number>): Histogram {
  const r = new Uint32Array(256)
  const g = new Uint32Array(256)
  const b = new Uint32Array(256)
  const lum = new Uint32Array(256)
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue
    const R = rgba[i]
    const G = rgba[i + 1]
    const B = rgba[i + 2]
    r[R]++
    g[G]++
    b[B]++
    lum[Math.round(0.299 * R + 0.587 * G + 0.114 * B)]++
  }
  return { r, g, b, lum }
}

/**
 * 자동 레벨 — 위아래 `clip`(기본 0.1%) 을 잘라 낸 지점을 입력 검정·흰색으로.
 * Compositor `LevelsAuto.contrast` 와 같이 세 채널이 **같은 구간**을 쓴다(색 관계 유지).
 */
export function autoLevels(hist: Histogram, clip = 0.001): { inBlack: number; inWhite: number } | null {
  const ends = ([hist.r, hist.g, hist.b] as Uint32Array[]).map((bins) => endpoints(bins, clip)).filter((e): e is [number, number] => e !== null)
  if (ends.length === 0) return null
  const low = Math.min(...ends.map((e) => e[0]))
  const high = Math.max(...ends.map((e) => e[1]))
  if (low >= high) return null
  return { inBlack: low, inWhite: high }
}

export type AutoLevelsMode = 'contrast' | 'color' | 'neutral'

export const AUTO_LEVELS_MODES: { key: AutoLevelsMode; label: string }[] = [
  { key: 'contrast', label: '대비 (색 관계 유지)' },
  { key: 'color', label: '색상 (채널별 — 색 틀어짐 보정)' },
  { key: 'neutral', label: '색상 + 중간톤 중립' }
]

/**
 * 자동 레벨 3모드 — Compositor `LevelsAuto.settings`.
 *  - contrast: 세 채널 공통 구간 → RGB 레벨
 *  - color: 채널마다 제 끝점 → 채널 레벨 (색 틀어짐까지 바로잡힘)
 *  - neutral: color + 채널 평균이 0.5 가 되도록 중간톤 감마
 * 반환: 보정 값 일부 (RGB 레벨과 채널 레벨을 새로 쓴다)
 */
export function autoLevelsFor(hist: Histogram, mode: AutoLevelsMode, clip = 0.001): Pick<Adjustments, 'inBlack' | 'inWhite' | 'midtone' | 'outBlack' | 'outWhite' | 'channels'> | null {
  const identity = { inBlack: 0, inWhite: 255, midtone: 1, outBlack: 0, outWhite: 255 }
  if (mode === 'contrast') {
    const a = autoLevels(hist, clip)
    return a ? { ...identity, ...a, channels: DEFAULT_ADJUST.channels } : null
  }
  const bins: Record<ToneChannel, Uint32Array> = { r: hist.r, g: hist.g, b: hist.b }
  const channels = { ...DEFAULT_ADJUST.channels }
  let any = false
  for (const c of ['r', 'g', 'b'] as ToneChannel[]) {
    const e = endpoints(bins[c], clip)
    if (!e) continue
    any = true
    let midtone = 1
    if (mode === 'neutral') {
      const f = levelsFn({ inBlack: e[0], inWhite: e[1], midtone: 1, outBlack: 0, outWhite: 255 })
      let total = 0
      let sum = 0
      for (let i = 0; i < 256; i++) {
        total += bins[c][i]
        sum += f(i / 255) * bins[c][i]
      }
      const mean = total ? sum / total : 0.5
      if (mean > 0 && mean < 1) midtone = clamp(Math.log(mean) / Math.log(0.5), 0.1, 9.99)
    }
    channels[c] = { ...DEFAULT_TONE, inBlack: e[0], inWhite: e[1], midtone }
  }
  return any ? { ...identity, channels } : null
}

export type LevelsSample = 'black' | 'gray' | 'white'

/**
 * 스포이트: 이미지에서 찍은 색(0~255)을 검정·회색·흰 점으로 — Compositor `LevelsSettings.sampling`.
 * 세 채널을 함께 보정하고 RGB 합성 레벨은 초기화한다.
 */
export function sampleLevels(a: Adjustments, rgb: [number, number, number], mode: LevelsSample): Adjustments {
  const channels = { ...(a.channels ?? DEFAULT_ADJUST.channels) }
  ;(['r', 'g', 'b'] as ToneChannel[]).forEach((c, i) => {
    const t = { ...channels[c] }
    const v = rgb[i]
    if (mode === 'black') t.inBlack = Math.min(t.inWhite - 1, Math.max(0, v))
    else if (mode === 'white') t.inWhite = Math.max(t.inBlack + 1, Math.min(255, v))
    else {
      const fraction = (v - t.inBlack) / (t.inWhite - t.inBlack)
      if (!(fraction > 0 && fraction < 1)) return
      t.midtone = clamp(Math.log(fraction) / Math.log(0.5), 0.1, 9.99)
    }
    t.outBlack = 0
    t.outWhite = 255
    channels[c] = t
  })
  return { ...a, inBlack: 0, inWhite: 255, midtone: 1, outBlack: 0, outWhite: 255, channels }
}

function endpoints(bins: Uint32Array, clip: number): [number, number] | null {
  let total = 0
  for (let i = 0; i < 256; i++) total += bins[i]
  if (total === 0) return null
  let sum = 0
  let low = 0
  for (let i = 0; i < 256; i++) {
    sum += bins[i]
    if (sum > total * clip) {
      low = i
      break
    }
  }
  sum = 0
  let high = 255
  for (let i = 255; i >= 0; i--) {
    sum += bins[i]
    if (sum > total * clip) {
      high = i
      break
    }
  }
  return low < high ? [low, high] : null
}

// ── 색역 밴드 ─────────────────────────────────────────────────────────────

/** from 에서 to 까지 앞으로 잰 각도 (0~360) */
function forward(from: number, to: number): number {
  const d = (to - from) % 360
  return d < 0 ? d + 360 : d
}

/** 밴드가 한 색조(도)를 얼마나 차지하는가 — 범위 안 1, 감쇠 어깨는 선형, 밖 0 (Compositor `HueBand.weight`) */
export function bandWeight(band: [number, number, number, number], hue: number): number {
  const [fs, rs, re, fe] = band
  const span = forward(fs, fe)
  if (span <= 0) return 1
  const pos = forward(fs, hue)
  if (pos > span) return 0
  const rampIn = forward(fs, rs)
  const plateauEnd = forward(fs, re)
  if (pos < rampIn) return rampIn > 0 ? pos / rampIn : 1
  if (pos <= plateauEnd) return 1
  const rampOut = span - plateauEnd
  return rampOut > 0 ? (span - pos) / rampOut : 1
}

/** 0~360 도마다 (색조 이동, 채도 %, 밝기 %) 합 — 마스터 + 색역별 가중 (Compositor `hueResponse`) */
export function hueResponse(a: Adjustments): Float32Array {
  const out = new Float32Array(361 * 3)
  const master = { hue: num(a.hue, 0), saturation: num(a.saturation, 0), lightness: num(a.lightness, 0) }
  for (let d = 0; d <= 360; d++) {
    let h = master.hue
    let s = master.saturation
    let l = master.lightness
    for (const [k, adj] of Object.entries(a.hueRanges ?? {}) as [ColorRange, RangeAdjustment][]) {
      if (!adj || (adj.hue === 0 && adj.saturation === 0 && adj.lightness === 0)) continue
      const w = bandWeight(HUE_BANDS[k], d)
      if (w <= 0) continue
      h += adj.hue * w
      s += adj.saturation * w
      l += adj.lightness * w
    }
    out[d * 3] = h
    out[d * 3 + 1] = s
    out[d * 3 + 2] = l
  }
  return out
}

// ── 픽셀 적용 ─────────────────────────────────────────────────────────────

/** '#rrggbb' → [r,g,b] (못 읽으면 검정) */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '')
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 결정적 난수 (그레인) — 같은 입력이면 미리보기와 결과물이 같은 무늬가 된다 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * RGBA 버퍼에 보정을 적용한다 (in place). 알파는 그대로.
 * `seed` 는 그레인 무늬 고정용 — 미리보기와 변환이 같은 값을 넘겨야 같은 그림이 나온다.
 */
export function applyAdjustments(rgba: Uint8ClampedArray | Uint8Array, a: Adjustments, seed = 1): void {
  if (!hasAdjust(a)) return
  const [lr, lg, lb] = toneLuts(a)
  const colorize = !!a.colorize
  const response = hueResponse(a)
  let doHsl = colorize
  for (let i = 0; i < response.length && !doHsl; i++) if (response[i] !== 0) doHsl = true
  // 색상화: 마스터 값을 절대 색조(0~360)·채도(0~100)로 해석
  const cHue = ((num(a.hue, 0) % 360) + 360) % 360
  const cSat = clamp(num(a.saturation, 0), 0, 100) / 100
  const cLight = clamp(num(a.lightness, 0), -100, 100) / 100
  const gm = a.gradientMap
  let gmLut: Uint8Array | null = null
  if (gm) {
    const lo = parseHex(gm.reversed ? gm.highlights : gm.shadows)
    const hi = parseHex(gm.reversed ? gm.shadows : gm.highlights)
    gmLut = new Uint8Array(256 * 3)
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      gmLut[i * 3] = Math.round(lo[0] + (hi[0] - lo[0]) * t)
      gmLut[i * 3 + 1] = Math.round(lo[1] + (hi[1] - lo[1]) * t)
      gmLut[i * 3 + 2] = Math.round(lo[2] + (hi[2] - lo[2]) * t)
    }
  }
  const grain = clamp(num(a.grain, 0), 0, 100)
  const rand = grain > 0 ? mulberry32(seed) : null

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    let r = lr[rgba[i]]
    let g = lg[rgba[i + 1]]
    let b = lb[rgba[i + 2]]

    if (doHsl) {
      // Compositor toHSL/toRGB (색조는 도) 를 인라인으로 — 픽셀마다 배열을 만들지 않는다 (큰 사진에서 GC 부담)
      const R = r / 255
      const G = g / 255
      const B = b / 255
      const hi = R > G ? (R > B ? R : B) : G > B ? G : B
      const lo = R < G ? (R < B ? R : B) : G < B ? G : B
      let l = (hi + lo) / 2
      const delta = hi - lo
      let h = 0
      let s = 0
      if (delta > 0) {
        s = Math.min(1, delta / (1 - Math.abs(2 * l - 1)))
        h = hi === R ? (G - B) / delta : hi === G ? (B - R) / delta + 2 : (R - G) / delta + 4
        h *= 60
        if (h < 0) h += 360
      }
      let amount: number
      if (colorize) {
        h = cHue
        s = cSat
        amount = cLight
      } else {
        const k = Math.min(360, Math.max(0, Math.round(h))) * 3
        h = (h + response[k]) % 360
        if (h < 0) h += 360
        s = clamp(s * (1 + response[k + 1] / 100), 0, 1) // 곱셈 — 무채색은 무채색으로 남는다
        amount = clamp(response[k + 2] / 100, -1, 1)
      }
      l = clamp(amount >= 0 ? l + (1 - l) * amount : l * (1 + amount), 0, 1)
      if (s <= 0) {
        r = g = b = Math.round(l * 255)
      } else {
        const chroma = (1 - Math.abs(2 * l - 1)) * s
        const sector = h / 60
        const second = chroma * (1 - Math.abs((sector % 2) - 1))
        const base = l - chroma / 2
        let R2: number, G2: number, B2: number
        switch (Math.floor(sector)) {
          case 0:
            ;[R2, G2, B2] = [chroma, second, 0]
            break
          case 1:
            ;[R2, G2, B2] = [second, chroma, 0]
            break
          case 2:
            ;[R2, G2, B2] = [0, chroma, second]
            break
          case 3:
            ;[R2, G2, B2] = [0, second, chroma]
            break
          case 4:
            ;[R2, G2, B2] = [second, 0, chroma]
            break
          default:
            ;[R2, G2, B2] = [chroma, 0, second]
        }
        r = Math.round(clamp(R2 + base, 0, 1) * 255)
        g = Math.round(clamp(G2 + base, 0, 1) * 255)
        b = Math.round(clamp(B2 + base, 0, 1) * 255)
      }
    }

    if (gmLut) {
      const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
      r = gmLut[y * 3]
      g = gmLut[y * 3 + 1]
      b = gmLut[y * 3 + 2]
    }

    if (rand) {
      // 단색 그레인: 세 채널에 같은 양 (필름 입자 느낌)
      const n = (rand() - 0.5) * grain * 1.6
      r = clamp255(r + n)
      g = clamp255(g + n)
      b = clamp255(b + n)
    }

    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
  }
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6
  else if (max === G) h = ((B - R) / d + 2) / 6
  else h = ((R - G) / d + 4) / 6
  return [h, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)]
}

function hue2rgb(p: number, q: number, t: number): number {
  let x = t
  if (x < 0) x += 1
  if (x > 1) x -= 1
  if (x < 1 / 6) return p + (q - p) * 6 * x
  if (x < 1 / 2) return q
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
  return p
}

function num(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback
}

/**
 * GPU(조정 레이어 셰이더)에 올릴 표 — CPU applyAdjustments 와 같은 값을 쓰도록 한 곳에서 만든다.
 */
export function adjustmentTables(a: Adjustments): {
  tone: Uint8Array
  hue: Float32Array
  doHsl: boolean
  colorize: boolean
  colorizeHSL: [number, number, number]
  grad: Uint8Array | null
  grain: number
} {
  const [lr, lg, lb] = toneLuts(a)
  const tone = new Uint8Array(256 * 4)
  for (let i = 0; i < 256; i++) {
    tone[i * 4] = lr[i]
    tone[i * 4 + 1] = lg[i]
    tone[i * 4 + 2] = lb[i]
    tone[i * 4 + 3] = 255
  }
  const r = hueResponse(a)
  const hue = new Float32Array(361 * 4)
  let any = false
  for (let d = 0; d <= 360; d++) {
    hue[d * 4] = r[d * 3]
    hue[d * 4 + 1] = r[d * 3 + 1]
    hue[d * 4 + 2] = r[d * 3 + 2]
    if (r[d * 3] || r[d * 3 + 1] || r[d * 3 + 2]) any = true
  }
  let grad: Uint8Array | null = null
  if (a.gradientMap) {
    const gm = a.gradientMap
    const lo = parseHex(gm.reversed ? gm.highlights : gm.shadows)
    const hi = parseHex(gm.reversed ? gm.shadows : gm.highlights)
    grad = new Uint8Array(256 * 4)
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      grad[i * 4] = Math.round(lo[0] + (hi[0] - lo[0]) * t)
      grad[i * 4 + 1] = Math.round(lo[1] + (hi[1] - lo[1]) * t)
      grad[i * 4 + 2] = Math.round(lo[2] + (hi[2] - lo[2]) * t)
      grad[i * 4 + 3] = 255
    }
  }
  return {
    tone,
    hue,
    doHsl: !!a.colorize || any,
    colorize: !!a.colorize,
    colorizeHSL: [((a.hue % 360) + 360) % 360, Math.min(100, Math.max(0, a.saturation)) / 100, Math.min(100, Math.max(-100, a.lightness)) / 100],
    grad,
    grain: Math.min(100, Math.max(0, a.grain))
  }
}
