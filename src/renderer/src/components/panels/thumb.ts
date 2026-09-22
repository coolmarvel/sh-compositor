import type { Bitmap } from '@core/index'

/** 비트맵 → 썸네일 dataURL (비트맵은 불변이라 객체 자체를 키로 캐시) */
const cache = new WeakMap<Bitmap, string>()
const maskCache = new WeakMap<Bitmap, string>()

/**
 * 원본 크기 캔버스를 만들지 않고 JS 에서 바로 줄인다 (상자 평균, 한 칸당 최대 4×4 표본).
 * 큰 사진(수천 px)에서 레이어가 바뀔 때마다 원본 크기 putImageData 하던 비용을 없앤다.
 */
export function thumbUrl(b: Bitmap, side = 64, asMask = false): string {
  const c = asMask ? maskCache : cache
  const hit = c.get(b)
  if (hit) return hit
  const s = Math.min(1, side / Math.max(b.width, b.height))
  const w = Math.max(1, Math.round(b.width * s))
  const h = Math.max(1, Math.round(b.height * s))
  const out = new Uint8ClampedArray(w * h * 4)
  const fx = b.width / w
  const fy = b.height / h
  const nx = Math.max(1, Math.min(4, Math.floor(fx)))
  const ny = Math.max(1, Math.min(4, Math.floor(fy)))
  const src = b.data
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let bl = 0
      let a = 0
      for (let j = 0; j < ny; j++) {
        const sy = Math.min(b.height - 1, Math.floor((y + (j + 0.5) / ny) * fy))
        for (let i = 0; i < nx; i++) {
          const sx = Math.min(b.width - 1, Math.floor((x + (i + 0.5) / nx) * fx))
          const o = (sy * b.width + sx) * 4
          if (asMask) {
            r += src[o]
            a += 255
          } else {
            const al = src[o + 3]
            r += src[o] * al
            g += src[o + 1] * al
            bl += src[o + 2] * al
            a += al
          }
        }
      }
      const n = nx * ny
      const d = (y * w + x) * 4
      if (asMask) {
        out[d] = out[d + 1] = out[d + 2] = r / n
        out[d + 3] = 255
      } else if (a > 0) {
        out[d] = r / a
        out[d + 1] = g / a
        out[d + 2] = bl / a
        out[d + 3] = a / n
      }
    }
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  cv.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0)
  const url = cv.toDataURL()
  c.set(b, url)
  return url
}
