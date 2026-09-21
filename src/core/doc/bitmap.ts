/**
 * 비트맵 유틸 (순수 TS). 전부 새 비트맵을 돌려준다 — 문서에 들어간 비트맵은 불변.
 */
import type { Bitmap } from './types'

export function createBitmap(width: number, height: number, fill?: [number, number, number, number]): Bitmap {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const data = new Uint8ClampedArray(w * h * 4)
  if (fill && (fill[0] || fill[1] || fill[2] || fill[3])) for (let i = 0; i < data.length; i += 4) data.set(fill, i)
  return { width: w, height: h, data }
}

export function cloneBitmap(b: Bitmap): Bitmap {
  return { width: b.width, height: b.height, data: b.data.slice() }
}

/** 마스크용 회색 비트맵 (R=G=B=v, A=255) */
export function grayBitmap(width: number, height: number, v: number): Bitmap {
  return createBitmap(width, height, [v, v, v, 255])
}

/** 사각형 잘라내기 (범위 밖은 투명) */
export function cropBitmap(b: Bitmap, x: number, y: number, w: number, h: number): Bitmap {
  const out = createBitmap(w, h)
  for (let yy = 0; yy < out.height; yy++) {
    const sy = y + yy
    if (sy < 0 || sy >= b.height) continue
    for (let xx = 0; xx < out.width; xx++) {
      const sx = x + xx
      if (sx < 0 || sx >= b.width) continue
      const s = (sy * b.width + sx) * 4
      const d = (yy * out.width + xx) * 4
      out.data[d] = b.data[s]
      out.data[d + 1] = b.data[s + 1]
      out.data[d + 2] = b.data[s + 2]
      out.data[d + 3] = b.data[s + 3]
    }
  }
  return out
}

/** 좌우/상하 반전 */
export function flipBitmap(b: Bitmap, horizontal: boolean): Bitmap {
  const out = createBitmap(b.width, b.height)
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const sx = horizontal ? b.width - 1 - x : x
      const sy = horizontal ? y : b.height - 1 - y
      out.data.set(b.data.subarray((sy * b.width + sx) * 4, (sy * b.width + sx) * 4 + 4), (y * b.width + x) * 4)
    }
  }
  return out
}

/** 불투명 픽셀이 있는 경계 (없으면 null) */
export function opaqueBounds(b: Bitmap, threshold = 0): { x: number; y: number; w: number; h: number } | null {
  let x0 = b.width
  let y0 = b.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < b.height; y++) {
    const row = y * b.width * 4
    for (let x = 0; x < b.width; x++) {
      if (b.data[row + x * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/** src 를 dst 의 (dx,dy) 에 source-over (스트레이트 알파) — 새 비트맵 */
export function drawOver(dst: Bitmap, src: Bitmap, dx: number, dy: number, opacity = 1): Bitmap {
  const out = cloneBitmap(dst)
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy
    if (ty < 0 || ty >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx
      if (tx < 0 || tx >= dst.width) continue
      const s = (y * src.width + x) * 4
      const d = (ty * dst.width + tx) * 4
      const sa = (src.data[s + 3] / 255) * opacity
      if (sa <= 0) continue
      const da = out.data[d + 3] / 255
      const oa = sa + da * (1 - sa)
      for (let c = 0; c < 3; c++) out.data[d + c] = (src.data[s + c] * sa + out.data[d + c] * da * (1 - sa)) / oa
      out.data[d + 3] = oa * 255
    }
  }
  return out
}

/** 같은 내용인가 (테스트용) */
export function sameBitmap(a: Bitmap, b: Bitmap): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}
