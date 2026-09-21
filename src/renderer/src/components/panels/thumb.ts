import type { Bitmap } from '@core/index'

/** 비트맵 → 썸네일 dataURL (비트맵은 불변이라 객체 자체를 키로 캐시) */
const cache = new WeakMap<Bitmap, string>()
const maskCache = new WeakMap<Bitmap, string>()

export function thumbUrl(b: Bitmap, side = 64, asMask = false): string {
  const c = asMask ? maskCache : cache
  const hit = c.get(b)
  if (hit) return hit
  const src = document.createElement('canvas')
  src.width = b.width
  src.height = b.height
  const data = new Uint8ClampedArray(b.data)
  if (asMask) for (let i = 0; i < data.length; i += 4) ((data[i + 1] = data[i + 2] = data[i]), (data[i + 3] = 255))
  src.getContext('2d')!.putImageData(new ImageData(data, b.width, b.height), 0, 0)
  const s = Math.min(1, side / Math.max(b.width, b.height))
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(b.width * s))
  out.height = Math.max(1, Math.round(b.height * s))
  const g = out.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(src, 0, 0, out.width, out.height)
  const url = out.toDataURL()
  c.set(b, url)
  return url
}
