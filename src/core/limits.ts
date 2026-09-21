/**
 * 캔버스 안전 한도 (순수 TS).
 *
 * 출처: `~/Compositor` `IO/ImageExporter.swift` — 한 변 30,000px · 전체 1억 픽셀(100MP).
 * 브라우저 canvas 도 같은 종류의 벽이 있고(칩·브라우저마다 다르지만 대략 16k~32k 변, 총 픽셀 한도),
 * 넘어서면 조용히 빈 이미지가 나오거나 렌더러가 죽는다. 그래서 **변환 전에 막고 문구로 알린다.**
 * (todo P2 "변환 경로 캔버스 상한 검토" 해소)
 */

/** 한 변의 최대 픽셀 */
export const MAX_SIDE = 30_000
/** 전체 픽셀 수 상한 (1억 = 100MP) */
export const MAX_PIXELS = 100_000_000

export interface Size {
  width: number
  height: number
}

/** 한도를 넘으면 사람이 읽을 안내 문구, 괜찮으면 null */
export function checkLimits(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return '가로·세로는 1픽셀 이상이어야 합니다.'
  }
  if (width > MAX_SIDE || height > MAX_SIDE) {
    return `한 변이 ${MAX_SIDE.toLocaleString()}픽셀을 넘을 수 없습니다 (요청: ${Math.round(width).toLocaleString()}×${Math.round(height).toLocaleString()}).`
  }
  if (width * height > MAX_PIXELS) {
    return `전체 ${(MAX_PIXELS / 1_000_000).toFixed(0)}메가픽셀을 넘을 수 없습니다 (요청: ${mp(width, height)}메가픽셀). 크기를 줄이거나 해상도를 낮춰 주세요.`
  }
  return null
}

/** 비율을 지키면서 한도 안으로 줄인 크기 (이미 안이면 그대로) */
export function fitWithinLimits(width: number, height: number): Size {
  let w = Math.max(1, Math.round(width))
  let h = Math.max(1, Math.round(height))
  const sideK = Math.min(1, MAX_SIDE / w, MAX_SIDE / h)
  if (sideK < 1) {
    w = Math.max(1, Math.floor(w * sideK))
    h = Math.max(1, Math.floor(h * sideK))
  }
  if (w * h > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (w * h))
    w = Math.max(1, Math.floor(w * k))
    h = Math.max(1, Math.floor(h * k))
  }
  return { width: w, height: h }
}

/** 메가픽셀 표기 (소수 1자리) */
export function mp(width: number, height: number): string {
  return ((width * height) / 1_000_000).toFixed(1)
}
