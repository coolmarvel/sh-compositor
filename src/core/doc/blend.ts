/**
 * 합성 모드 수식 (순수 TS) — W3C Compositing and Blending Level 1 과 같은 식(= Photoshop 합성 모드).
 * Compositor 는 Core Graphics 블렌드를 쓰되 틀리는 두 모드를 `SeparableBlend.swift` 로 따로 계산한다 —
 * 여기서는 16종 전부를 명세 수식 그대로 계산하고, WebGL2 셰이더(`renderer/gl/shaders.ts`)가 같은 식을 쓴다.
 * 값은 전부 0~1.
 */
import type { BlendMode } from './types'

const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b

function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b)
  const n = Math.min(r, g, b)
  const x = Math.max(r, g, b)
  if (n < 0) {
    r = l + ((r - l) * l) / (l - n)
    g = l + ((g - l) * l) / (l - n)
    b = l + ((b - l) * l) / (l - n)
  }
  if (x > 1) {
    r = l + ((r - l) * (1 - l)) / (x - l)
    g = l + ((g - l) * (1 - l)) / (x - l)
    b = l + ((b - l) * (1 - l)) / (x - l)
  }
  return [r, g, b]
}

function setLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - lum(r, g, b)
  return clipColor(r + d, g + d, b + d)
}

const sat = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b)

function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const c = [r, g, b]
  const idx = [0, 1, 2].sort((i, j) => c[i] - c[j])
  const [mn, md, mx] = idx
  const out = [0, 0, 0]
  if (c[mx] > c[mn]) {
    out[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn])
    out[mx] = s
  }
  out[mn] = 0
  return [out[0], out[1], out[2]]
}

function separable(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply':
      return cb * cs
    case 'screen':
      return cb + cs - cb * cs
    case 'overlay':
      return separable('hardLight', cs, cb)
    case 'darken':
      return Math.min(cb, cs)
    case 'lighten':
      return Math.max(cb, cs)
    case 'colorDodge':
      if (cb === 0) return 0
      if (cs >= 1) return 1
      return Math.min(1, cb / (1 - cs))
    case 'colorBurn':
      if (cb >= 1) return 1
      if (cs <= 0) return 0
      return 1 - Math.min(1, (1 - cb) / cs)
    case 'hardLight':
      return cs <= 0.5 ? cb * 2 * cs : separable('screen', cb, 2 * cs - 1)
    case 'softLight': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb)
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb)
      return cb + (2 * cs - 1) * (d - cb)
    }
    case 'difference':
      return Math.abs(cb - cs)
    case 'exclusion':
      return cb + cs - 2 * cb * cs
    default:
      return cs
  }
}

/** B(Cb, Cs) — 합성 모드 함수 (알파 무관 색만) */
export function blendColor(mode: BlendMode, cb: [number, number, number], cs: [number, number, number]): [number, number, number] {
  switch (mode) {
    case 'normal':
      return cs
    case 'hue':
      return setLum(...setSat(cs[0], cs[1], cs[2], sat(cb[0], cb[1], cb[2])), lum(cb[0], cb[1], cb[2]))
    case 'saturation':
      return setLum(...setSat(cb[0], cb[1], cb[2], sat(cs[0], cs[1], cs[2])), lum(cb[0], cb[1], cb[2]))
    case 'color':
      return setLum(cs[0], cs[1], cs[2], lum(cb[0], cb[1], cb[2]))
    case 'luminosity':
      return setLum(cb[0], cb[1], cb[2], lum(cs[0], cs[1], cs[2]))
    default:
      return [separable(mode, cb[0], cs[0]), separable(mode, cb[1], cs[1]), separable(mode, cb[2], cs[2])]
  }
}

/**
 * 한 픽셀 합성 (스트레이트 알파 0~1 입력, 스트레이트 알파 출력).
 *   Cs' = (1 − αb)·Cs + αb·B(Cb, Cs)
 *   co  = αs·Cs' + (1 − αs)·αb·Cb   (프리멀티플라이드)
 *   αo  = αs + αb·(1 − αs)
 */
export function compositePixel(
  mode: BlendMode,
  cb: [number, number, number],
  ab: number,
  cs: [number, number, number],
  as: number,
  out: [number, number, number, number] = [0, 0, 0, 0]
): [number, number, number, number] {
  if (as <= 0) {
    out[0] = cb[0]
    out[1] = cb[1]
    out[2] = cb[2]
    out[3] = ab
    return out
  }
  const B = mode === 'normal' ? cs : blendColor(mode, cb, cs)
  const ao = as + ab * (1 - as)
  if (ao <= 0) {
    out.fill(0)
    return out
  }
  out[3] = ao
  for (let i = 0; i < 3; i++) {
    const mixed = (1 - ab) * cs[i] + ab * B[i]
    out[i] = (as * mixed + (1 - as) * ab * cb[i]) / ao
  }
  return out
}
