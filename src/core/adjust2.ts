/**
 * 추가 조정 (순수 TS) — 포토샵 Image ▸ Adjustments 의 흑백·색상 균형·활기·포스터화·한계값.
 * 모두 RGBA 버퍼를 제자리에서 바꾼다 (알파는 그대로). 선택 영역 한정·미리보기는 호출측(editPixels)이 맡는다.
 */
import { rgbToHsl, hslToRgb } from './adjust'

export type MoreAdjustKind = 'blackWhite' | 'colorBalance' | 'vibrance' | 'posterize' | 'threshold'

export interface BlackWhite {
  /** 색역별 밝기 기여 % (포토샵 기본: 빨강 40 · 노랑 60 · 초록 40 · 청록 60 · 파랑 20 · 마젠타 80) */
  reds: number
  yellows: number
  greens: number
  cyans: number
  blues: number
  magentas: number
}
export const DEFAULT_BW: BlackWhite = { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 }

export interface ColorBalance {
  /** [청록↔빨강, 마젠타↔초록, 노랑↔파랑] −100~100 */
  shadows: [number, number, number]
  midtones: [number, number, number]
  highlights: [number, number, number]
  preserveLuminosity: boolean
}
export const DEFAULT_CB: ColorBalance = { shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLuminosity: true }

export interface MoreAdjust {
  kind: MoreAdjustKind
  bw: BlackWhite
  cb: ColorBalance
  /** 활기 −100~100 · 채도 −100~100 */
  vibrance: number
  saturation: number
  /** 포스터화 단계 2~255 */
  levels: number
  /** 한계값 1~255 */
  threshold: number
}
export const DEFAULT_MORE: MoreAdjust = { kind: 'blackWhite', bw: DEFAULT_BW, cb: DEFAULT_CB, vibrance: 0, saturation: 0, levels: 4, threshold: 128 }

/**
 * 흑백 — 포토샵 공식: 회색 = 최소 + (중간−최소)·(두 강한 채널이 이루는 2차색 가중) + (최대−중간)·(가장 강한 1차색 가중).
 * 예: R>G>B 면 1차 = 빨강, 2차 = 노랑.
 */
export function blackWhite(px: Uint8ClampedArray | Uint8Array, w: BlackWhite): void {
  const W = { r: w.reds / 100, y: w.yellows / 100, g: w.greens / 100, c: w.cyans / 100, b: w.blues / 100, m: w.magentas / 100 }
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]
    const g = px[i + 1]
    const b = px[i + 2]
    let mx: number, md: number, mn: number, prim: number, sec: number
    if (r >= g && r >= b) {
      mx = r
      if (g >= b) ((md = g), (mn = b), (sec = W.y))
      else ((md = b), (mn = g), (sec = W.m))
      prim = W.r
    } else if (g >= r && g >= b) {
      mx = g
      if (r >= b) ((md = r), (mn = b), (sec = W.y))
      else ((md = b), (mn = r), (sec = W.c))
      prim = W.g
    } else {
      mx = b
      if (r >= g) ((md = r), (mn = g), (sec = W.m))
      else ((md = g), (mn = r), (sec = W.c))
      prim = W.b
    }
    const v = mn + (md - mn) * sec + (mx - md) * prim
    px[i] = px[i + 1] = px[i + 2] = v
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 색상 균형 — 어두운 곳·중간·밝은 곳에 따로 색을 민다 (GIMP·포토샵과 같은 가중 곡선), 밝기 유지 선택 */
export function colorBalance(px: Uint8ClampedArray | Uint8Array, cb: ColorBalance): void {
  const a = 0.25
  const bb = 0.333
  const scale = 0.7
  const lut: Float32Array[] = [0, 1, 2].map((ch) => {
    const t = new Float32Array(256)
    for (let v = 0; v < 256; v++) {
      const l = v / 255
      const sh = clamp01((l - bb) / -a + 0.5) * scale
      const mid = clamp01((l - bb) / a + 0.5) * clamp01((l + bb - 1) / -a + 0.5) * scale
      const hi = clamp01((l + bb - 1) / a + 0.5) * scale
      t[v] = clamp01(l + (cb.shadows[ch] / 100) * sh + (cb.midtones[ch] / 100) * mid + (cb.highlights[ch] / 100) * hi) * 255
    }
    return t
  })
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]
    const g = px[i + 1]
    const b = px[i + 2]
    let nr = lut[0][r]
    let ng = lut[1][g]
    let nb = lut[2][b]
    if (cb.preserveLuminosity) {
      const [h, s] = rgbToHsl(nr, ng, nb)
      const [, , l] = rgbToHsl(r, g, b)
      ;[nr, ng, nb] = hslToRgb(h, s, l)
    }
    px[i] = nr
    px[i + 1] = ng
    px[i + 2] = nb
  }
}

/** 활기(덜 선명한 색을 더 많이) + 채도(고르게) */
export function vibrance(px: Uint8ClampedArray | Uint8Array, vib: number, sat: number): void {
  const v = vib / 100
  const s = sat / 100
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i]
    const g = px[i + 1]
    const b = px[i + 2]
    const mx = Math.max(r, g, b)
    const mn = Math.min(r, g, b)
    const cur = mx ? (mx - mn) / mx : 0
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    // 채도가 낮을수록 활기가 세게 (이미 선명한 색은 거의 그대로)
    const k = 1 + s + v * (1 - cur)
    px[i] = gray + (r - gray) * k
    px[i + 1] = gray + (g - gray) * k
    px[i + 2] = gray + (b - gray) * k
  }
}

export function posterize(px: Uint8ClampedArray | Uint8Array, levels: number): void {
  const n = Math.max(2, Math.min(255, Math.round(levels)))
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round((Math.round((v / 255) * (n - 1)) / (n - 1)) * 255)
  for (let i = 0; i < px.length; i += 4) {
    px[i] = lut[px[i]]
    px[i + 1] = lut[px[i + 1]]
    px[i + 2] = lut[px[i + 2]]
  }
}

export function threshold(px: Uint8ClampedArray | Uint8Array, level: number): void {
  for (let i = 0; i < px.length; i += 4) {
    const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] >= level ? 255 : 0
    px[i] = px[i + 1] = px[i + 2] = v
  }
}

/** 한 번에 (대화상자에서 고른 종류만) */
export function applyMoreAdjust(px: Uint8ClampedArray | Uint8Array, a: MoreAdjust): void {
  switch (a.kind) {
    case 'blackWhite':
      return blackWhite(px, a.bw)
    case 'colorBalance':
      return colorBalance(px, a.cb)
    case 'vibrance':
      return vibrance(px, a.vibrance, a.saturation)
    case 'posterize':
      return posterize(px, a.levels)
    case 'threshold':
      return threshold(px, a.threshold)
  }
}
