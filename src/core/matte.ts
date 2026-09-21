/**
 * 배경 제거 마스크 다듬기 (순수 TS — Float32Array 만 다룬다).
 *
 * 출처: `~/Compositor` `Document/GuidedMatte.swift` + `Document/SubjectRemoval.swift` 의 `refined()`.
 * Compositor 는 마스크를 Apple Vision(macOS 전용)으로 만들고 이 단계로 다듬는다. 우리는 마스크를
 * 오프라인 AI 모델(@imgly, Windows 에서도 동작)로 만들고 **다듬기 단계만** 가져왔다.
 *
 *  - 가장자리 다듬기(refine): 가이드 필터(He·Sun·Tang). 원본 이미지의 경계에 마스크를 끌어붙여
 *    모델이 뭉툭하게 자른 머리카락·털을 되살린다. 상자 평균을 누적합 두 번으로 — 반경과 무관한 비용.
 *  - 가장자리 이동(shift): 흐림 뒤 문턱값 — 음수면 안쪽으로 줄여 테두리의 배경색 띠를 없앤다.
 *  - 매트 대비(contrast): 회색 구간을 벌려 배경이 비치는 뿌연 기운을 걷어 낸다.
 */

export interface MatteRefine {
  /** 가장자리 다듬기 반경(px) 0~40. 0 = 끔 */
  refine: number
  /** 가장자리 이동(px) −20~20. 음수 = 안쪽으로 */
  shift: number
  /** 매트 대비 0~100 */
  contrast: number
}

/** Compositor 기본값과 같은 출발점 (refineEdges 12 · matteContrast 25) */
export const DEFAULT_MATTE: MatteRefine = { refine: 12, shift: 0, contrast: 25 }
export const NO_MATTE: MatteRefine = { refine: 0, shift: 0, contrast: 0 }

export function hasMatteRefine(m: MatteRefine | null | undefined): m is MatteRefine {
  return !!m && (m.refine > 0 || m.shift !== 0 || m.contrast > 0)
}

/** (2r+1)² 상자 평균 — 가로·세로 누적합 두 번 */
export function boxMean(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const r = Math.max(0, Math.round(radius))
  if (r === 0) return src.slice()
  const span = r * 2 + 1
  const pass = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(width - 1, Math.max(0, x))]
    for (let x = 0; x < width; x++) {
      pass[row + x] = sum / span
      sum -= src[row + Math.min(width - 1, Math.max(0, x - r))]
      sum += src[row + Math.min(width - 1, Math.max(0, x + r + 1))]
    }
  }
  const out = new Float32Array(width * height)
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += pass[Math.min(height - 1, Math.max(0, y)) * width + x]
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span
      sum -= pass[Math.min(height - 1, Math.max(0, y - r)) * width + x]
      sum += pass[Math.min(height - 1, Math.max(0, y + r + 1)) * width + x]
    }
  }
  return out
}

/** 가이드 필터 — mask·guide 는 0~1, 같은 크기 */
export function guidedFilter(mask: Float32Array, guide: Float32Array, width: number, height: number, radius: number, epsilon = 1e-4): Float32Array {
  const n = width * height
  const meanI = boxMean(guide, width, height, radius)
  const meanP = boxMean(mask, width, height, radius)
  const sq = new Float32Array(n)
  const pr = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    sq[i] = guide[i] * guide[i]
    pr[i] = guide[i] * mask[i]
  }
  const meanII = boxMean(sq, width, height, radius)
  const meanIP = boxMean(pr, width, height, radius)
  const a = new Float32Array(n)
  const b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const variance = meanII[i] - meanI[i] * meanI[i]
    const covariance = meanIP[i] - meanI[i] * meanP[i]
    a[i] = covariance / (variance + epsilon)
    b[i] = meanP[i] - a[i] * meanI[i]
  }
  const meanA = boxMean(a, width, height, radius)
  const meanB = boxMean(b, width, height, radius)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, meanA[i] * guide[i] + meanB[i]))
  return out
}

/** 가장자리 이동 — 가우시안 근사(상자 3회) 흐림 뒤 문턱값. 줄이면 0.75, 늘리면 0.25 에서 자른다 */
export function shiftEdge(mask: Float32Array, width: number, height: number, shift: number): Float32Array {
  if (!shift) return mask
  const reach = Math.abs(shift)
  // σ = reach/2 인 가우시안을 상자 3회로 근사: 상자 반경 ≈ σ·√3 / √3 ... 경험적으로 reach/3
  const r = Math.max(1, Math.round(reach / 3))
  let m = boxMean(mask, width, height, r)
  m = boxMean(m, width, height, r)
  m = boxMean(m, width, height, r)
  const level = shift < 0 ? 0.75 : 0.25
  const out = new Float32Array(m.length)
  for (let i = 0; i < m.length; i++) out[i] = Math.min(1, Math.max(0, (m[i] - level) * 1000))
  return out
}

/** 매트 대비 — 0 은 그대로, 100 은 한가운데서 딱 자르기 */
export function matteContrast(mask: Float32Array, contrast: number): Float32Array {
  if (contrast <= 0) return mask
  const strength = Math.min(1, contrast / 100)
  const slope = 1 / Math.max(0.02, 1 - strength * 0.98)
  const bias = (1 - slope) / 2
  const out = new Float32Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = Math.min(1, Math.max(0, mask[i] * slope + bias))
  return out
}

/** 세 단계를 Compositor 와 같은 순서로 (다듬기 → 이동 → 대비) */
export function refineMatte(mask: Float32Array, guide: Float32Array, width: number, height: number, m: MatteRefine): Float32Array {
  let out = mask
  if (m.refine > 0) out = guidedFilter(out, guide, width, height, m.refine)
  if (m.shift !== 0) out = shiftEdge(out, width, height, m.shift)
  if (m.contrast > 0) out = matteContrast(out, m.contrast)
  return out
}
