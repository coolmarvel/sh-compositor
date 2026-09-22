export function polygonMask(width: number, height: number, pts: { x: number; y: number }[], antialias = true): Uint8Array {
  const m = new Uint8Array(width * height)
  if (pts.length < 3) return m
  const S = antialias ? 4 : 1
  const ys = pts.map((p) => p.y)
  const minY = Math.max(0, Math.floor(Math.min(...ys)))
  const maxY = Math.min(height, Math.ceil(Math.max(...ys)))
  const acc = new Uint16Array(width)
  const xs: number[] = []
  for (let y = minY; y < maxY; y++) {
    acc.fill(0)
    let touched = false
    for (let sy = 0; sy < S; sy++) {
      const py = y + (sy + 0.5) / S
      xs.length = 0
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i]
        const b = pts[j]
        if ((a.y <= py && b.y > py) || (b.y <= py && a.y > py)) xs.push(a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k]
        const xb = xs[k + 1]
        for (let sx = 0; sx < S * width; sx++) {
          const px = (sx + 0.5) / S
          if (px < xa) continue
          if (px >= xb) break
          acc[(sx / S) | 0]++
          touched = true
        }
      }
    }
    if (!touched) continue
    const row = y * width
    for (let x = 0; x < width; x++) if (acc[x]) m[row + x] = Math.round((acc[x] / (S * S)) * 255)
  }
  return m
}
