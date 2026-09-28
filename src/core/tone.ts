/**
 * 닷지·번·스펀지 (순수 TS 기준) — 포토샵 O 도구. 획 덮임(StrokeCoverage)을 원본에 한 번에 적용한다 (붓처럼 획 안에서 겹쳐도 누적되지 않는다).
 *  - dodge: 밝게 v += (255 − v)·e·w     - burn: 어둡게 v −= v·e·w
 *  - sponge: 채도 (saturate: 회색에서 멀리, desaturate: 회색으로) v = gray + (v − gray)·(1 ± e·cov)
 *  - w = 범위 가중 (shadows: 어두울수록, midtones: 중간일수록, highlights: 밝을수록) — 밝기 L 은 0~1
 * Rust WASM(`native/kernels`)이 같은 식을 돌리며 최대 1바이트(반올림) 차이를 허용한다.
 */
export type ToneMode = 'dodge' | 'burn' | 'sponge'
export type ToneRange = 'shadows' | 'midtones' | 'highlights'
export interface ToneSettings {
  mode: ToneMode
  range: ToneRange
  /** 노출·유량 0~1 */
  exposure: number
  /** sponge: true = 채도 높이기, false = 채도 낮추기 */
  saturate: boolean
}
export const DEFAULT_TONE_SETTINGS: ToneSettings = { mode: 'dodge', range: 'midtones', exposure: 0.5, saturate: false }

export function rangeWeight(range: ToneRange, l: number): number {
  if (range === 'shadows') return Math.max(0, 1 - l * 2) * 0.75 + 0.25 * (1 - l)
  if (range === 'highlights') return Math.max(0, l * 2 - 1) * 0.75 + 0.25 * l
  return 1 - Math.abs(l * 2 - 1)
}

/**
 * 원본(orig)의 [x0,y0,w,h] 영역을 덮임(cov, 레이어 전체 크기)만큼 처리해 out 에 쓴다 (out 은 orig 와 같은 크기).
 * limit 가 있으면 픽셀별로 곱한다 (선택 영역).
 */
export function applyTone(
  orig: Uint8ClampedArray,
  out: Uint8ClampedArray,
  W: number,
  cov: Float32Array,
  r: { x: number; y: number; w: number; h: number },
  s: ToneSettings,
  limit?: (i: number) => number
): void {
  const e = s.exposure
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const i = y * W + x
      let a = cov[i] * e
      if (a > 0 && limit) a *= limit(i)
      const o = i * 4
      if (a <= 0) {
        out[o] = orig[o]
        out[o + 1] = orig[o + 1]
        out[o + 2] = orig[o + 2]
        out[o + 3] = orig[o + 3]
        continue
      }
      const R = orig[o]
      const G = orig[o + 1]
      const B = orig[o + 2]
      const gray = 0.299 * R + 0.587 * G + 0.114 * B
      if (s.mode === 'sponge') {
        const k = s.saturate ? 1 + a : Math.max(0, 1 - a)
        out[o] = gray + (R - gray) * k
        out[o + 1] = gray + (G - gray) * k
        out[o + 2] = gray + (B - gray) * k
      } else {
        const w = rangeWeight(s.range, gray / 255) * a
        if (s.mode === 'dodge') {
          out[o] = R + (255 - R) * w
          out[o + 1] = G + (255 - G) * w
          out[o + 2] = B + (255 - B) * w
        } else {
          out[o] = R - R * w
          out[o + 1] = G - G * w
          out[o + 2] = B - B * w
        }
      }
      out[o + 3] = orig[o + 3]
    }
}
