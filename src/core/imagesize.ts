/**
 * "이미지 크기" 대화상자의 계산 (순수 TS).
 *
 * 출처: `~/Compositor` `UI/ImageSizeSheet.swift` 의 모델을 그대로 옮긴 것.
 *  - 단위 네 가지(픽셀·퍼센트·인치·센티미터)로 같은 크기를 바꿔 본다.
 *  - **리샘플 켬**: 픽셀 수가 바뀐다. 비율 잠금이면 반대 변이 따라온다.
 *  - **리샘플 끔**: 픽셀은 그대로, 인쇄 크기와 해상도(DPI)만 맞바꾼다 —
 *    가로를 2배로 적으면 DPI 가 절반이 된다. (픽셀·퍼센트 단위는 이때 의미가 없어 인치로 넘어간다)
 *  - 해상도를 바꾸면(리샘플 켬 + 인치/cm) 인쇄 크기를 유지하려고 픽셀이 따라 늘어난다.
 *
 * 캔버스 한도(30,000px/변·100MP)는 `limits.ts` 와 공유한다.
 */

import { checkLimits } from './limits'

export type SizeUnit = 'px' | 'percent' | 'inch' | 'cm'

export const SIZE_UNITS: { key: SizeUnit; label: string }[] = [
  { key: 'px', label: '픽셀' },
  { key: 'percent', label: '퍼센트' },
  { key: 'inch', label: '인치' },
  { key: 'cm', label: '센티미터' }
]

/** 해상도(DPI)의 허용 범위 — Compositor 와 동일 */
export const MIN_DPI = 1
export const MAX_DPI = 9600
export const DEFAULT_DPI = 72

export interface ImageSizeState {
  /** 출력 픽셀 폭 (실수 — 확정 시 반올림) */
  width: number
  height: number
  /** 인쇄 해상도 (픽셀/인치) */
  dpi: number
  /** 비율 잠금 */
  lock: boolean
  /** 리샘플(픽셀 수 변경) 여부 */
  resample: boolean
  unit: SizeUnit
}

export interface SourceSize {
  width: number
  height: number
}

export function initialState(src: SourceSize, dpi = DEFAULT_DPI): ImageSizeState {
  return { width: src.width, height: src.height, dpi, lock: true, resample: true, unit: 'px' }
}

/** 픽셀 값 → 현재 단위로 보여 줄 숫자 */
export function toDisplay(pixels: number, original: number, unit: SizeUnit, dpi: number): number {
  switch (unit) {
    case 'percent':
      return original > 0 ? (pixels / original) * 100 : 0
    case 'inch':
      return dpi > 0 ? pixels / dpi : 0
    case 'cm':
      return dpi > 0 ? (pixels / dpi) * 2.54 : 0
    default:
      return pixels
  }
}

/** 현재 단위의 입력 숫자 → 픽셀 */
export function toPixels(value: number, original: number, unit: SizeUnit, dpi: number): number {
  switch (unit) {
    case 'percent':
      return (value / 100) * original
    case 'inch':
      return value * dpi
    case 'cm':
      return (value / 2.54) * dpi
    default:
      return value
  }
}

/** 표시용 반올림 — 픽셀·퍼센트는 정수 느낌, 인치/cm 는 소수 3자리 */
export function roundDisplay(value: number, unit: SizeUnit): number {
  if (!Number.isFinite(value)) return 0
  return unit === 'px' ? Math.round(value) : Math.round(value * 1000) / 1000
}

/**
 * 가로 또는 세로 입력을 반영한 새 상태.
 * 리샘플이 꺼져 있으면 픽셀은 그대로 두고 DPI 를 바꾼다(인쇄 크기 ↔ 해상도 맞바꿈).
 */
export function setDimension(state: ImageSizeState, which: 'width' | 'height', displayValue: number, src: SourceSize): ImageSizeState {
  if (!Number.isFinite(displayValue) || displayValue <= 0) return state
  const original = which === 'width' ? src.width : src.height
  const current = which === 'width' ? state.width : state.height

  if (!state.resample) {
    // 픽셀 고정: 적어 넣은 인쇄 크기가 되도록 DPI 를 되계산
    const inches = state.unit === 'cm' ? displayValue / 2.54 : displayValue
    if (inches <= 0) return state
    return { ...state, dpi: clamp(current / inches, MIN_DPI, MAX_DPI) }
  }

  const pixels = toPixels(displayValue, original, state.unit, state.dpi)
  if (!Number.isFinite(pixels) || pixels <= 0) return state
  if (which === 'width') {
    const height = state.lock && state.width > 0 ? (pixels * state.height) / state.width : state.height
    return { ...state, width: pixels, height }
  }
  const width = state.lock && state.height > 0 ? (pixels * state.width) / state.height : state.width
  return { ...state, width, height: pixels }
}

/** 해상도 입력 반영 — 리샘플 + 인치/cm 이면 인쇄 크기를 지키려고 픽셀이 따라온다 */
export function setDpi(state: ImageSizeState, dpi: number): ImageSizeState {
  if (!Number.isFinite(dpi) || dpi <= 0) return state
  const next = clamp(dpi, MIN_DPI, MAX_DPI)
  const printUnit = state.unit === 'inch' || state.unit === 'cm'
  if (state.resample && printUnit && state.dpi > 0) {
    const k = next / state.dpi
    return { ...state, dpi: next, width: state.width * k, height: state.height * k }
  }
  return { ...state, dpi: next }
}

/** 리샘플 토글 — 끄면 픽셀을 원본으로 되돌리고 단위를 인쇄 단위로 옮긴다 (Compositor 와 동일) */
export function setResample(state: ImageSizeState, resample: boolean, src: SourceSize): ImageSizeState {
  if (resample === state.resample) return state
  if (resample) return { ...state, resample }
  return {
    ...state,
    resample,
    width: src.width,
    height: src.height,
    lock: true,
    unit: state.unit === 'px' || state.unit === 'percent' ? 'inch' : state.unit
  }
}

/** 확정될 출력 픽셀 크기 */
export function resultPixels(state: ImageSizeState): { width: number; height: number } {
  return { width: Math.max(1, Math.round(state.width)), height: Math.max(1, Math.round(state.height)) }
}

/** 적용 가능 여부 + 안내 문구 (한도 위반이면 문구가 이유를 말한다) */
export function validate(state: ImageSizeState): { ok: boolean; message: string } {
  if (!Number.isFinite(state.dpi) || state.dpi < MIN_DPI || state.dpi > MAX_DPI) {
    return { ok: false, message: `해상도는 ${MIN_DPI}~${MAX_DPI.toLocaleString()} 픽셀/인치 사이여야 합니다.` }
  }
  const { width, height } = resultPixels(state)
  if (!state.resample) {
    const inW = width / state.dpi
    const inH = height / state.dpi
    return { ok: true, message: `픽셀은 그대로 ${width.toLocaleString()}×${height.toLocaleString()} · 인쇄 크기 ${inW.toFixed(2)}×${inH.toFixed(2)}인치` }
  }
  const limit = checkLimits(width, height)
  if (limit) return { ok: false, message: limit }
  return { ok: true, message: `결과: ${width.toLocaleString()}×${height.toLocaleString()}픽셀` }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
