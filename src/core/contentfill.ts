/**
 * 내용 인식 채우기 — 비어 있는 영역을 주변 그림의 패치로 채운다 (순수 TS).
 *
 * 출처: `~/Compositor` `Rendering/ContentFill.c` (`content_fill`) 를 그대로 옮김.
 * 알고리즘: 알려진 픽셀과 맞닿은 빈 픽셀부터 너비 우선으로, 이웃이 고른 원본 위치를 이어 쓰고(전파)
 * 무작위 후보 24개 + 반경을 반씩 줄이는 무작위 탐색으로 5×5 패치 거리(SSD)가 가장 작은 원본을 골라 복사.
 * 변환기에서의 쓰임: **캔버스 크기로 늘린 여백을 단색 대신 주변 그림으로** (Compositor 도 이미지를 가장자리 너머로
 * 늘리는 데 쓴다).
 */

function lcg(state: { s: number }): number {
  state.s = (Math.imul(state.s, 1664525) + 1013904223) >>> 0
  return state.s
}

function match(px: Uint8ClampedArray, known: Uint8Array, w: number, h: number, p: number, q: number, radius: number): number {
  const pxx = p % w
  const pyy = (p / w) | 0
  const qx = q % w
  const qy = (q / w) | 0
  let count = 0
  let sum = 0
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = pxx + dx
      const y = pyy + dy
      const sx = qx + dx
      const sy = qy + dy
      if (x < 0 || y < 0 || x >= w || y >= h || sx < 0 || sy < 0 || sx >= w || sy >= h || !known[y * w + x]) continue
      const a = (y * w + x) * 4
      const b = (sy * w + sx) * 4
      for (let c = 0; c < 4; c++) {
        const d = px[a + c] - px[b + c]
        sum += d * d
      }
      count++
    }
  }
  return count ? sum / count : Number.MAX_VALUE
}

/**
 * pixels(RGBA) 의 target(1 = 채울 곳) 을 채운다 (in place).
 * 반환: 1 = 성공, 0 = 원본으로 쓸 불투명 픽셀이 없음.
 */
export function contentFill(pixels: Uint8ClampedArray, target: Uint8Array, w: number, h: number): number {
  const n = w * h
  const known = new Uint8Array(n)
  const valid = new Uint8Array(n)
  const queued = new Uint8Array(n)
  const donors = new Int32Array(n)
  const queue = new Int32Array(n)
  const chosen = new Int32Array(n).fill(-1)
  const radius = w >= 5 && h >= 5 ? 2 : 0
  let missing = 0
  let donorCount = 0
  let head = 0
  let tail = 0
  let scan = 0
  for (let p = 0; p < n; p++) {
    known[p] = !target[p] && pixels[p * 4 + 3] === 255 ? 1 : 0
    if (target[p]) missing++
  }
  if (!missing) return 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!known[p]) continue
      let ok = true
      for (let dy = -radius; dy <= radius && ok; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = x + dx
          const sy = y + dy
          if (sx < 0 || sy < 0 || sx >= w || sy >= h || !known[sy * w + sx]) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        valid[p] = 1
        donors[donorCount++] = p
      }
    }
  }
  if (!donorCount) return 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (target[p] && ((x && known[p - 1]) || (x + 1 < w && known[p + 1]) || (y && known[p - w]) || (y + 1 < h && known[p + w]))) {
        queue[tail++] = p
        queued[p] = 1
      }
    }
  }
  const seed = { s: 0x6d2b79f5 }
  for (;;) {
    while (head < tail) {
      const p = queue[head++]
      const x = p % w
      const y = (p / w) | 0
      let best = -1
      let score = Number.MAX_VALUE
      const neighbors = [x ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y ? p - w : -1, y + 1 < h ? p + w : -1]
      // 이웃이 고른 원본 오프셋을 이어 쓰고(전파), 무작위 패치 탐색으로 다듬는다
      for (let k = 0; k < 28; k++) {
        let q = -1
        if (k < 4) {
          const t = neighbors[k]
          if (t >= 0) q = (chosen[t] >= 0 ? chosen[t] : t) + (p - t)
        } else q = donors[lcg(seed) % donorCount]
        if (q < 0 || q >= n || !valid[q]) continue
        const s = match(pixels, known, w, h, p, q, radius)
        if (best < 0 || s < score) {
          score = s
          best = q
        }
      }
      if (best < 0) best = donors[0]
      for (let r = 64; r >= 1; r = r >> 1) {
        const qx = (best % w) + (lcg(seed) % (2 * r + 1)) - r
        const qy = ((best / w) | 0) + (lcg(seed) % (2 * r + 1)) - r
        if (qx < 0 || qy < 0 || qx >= w || qy >= h || !valid[qy * w + qx]) continue
        const q = qy * w + qx
        const s = match(pixels, known, w, h, p, q, radius)
        if (s < score) {
          score = s
          best = q
        }
      }
      pixels.copyWithin(p * 4, best * 4, best * 4 + 4)
      known[p] = 1
      chosen[p] = best
      for (let k = 0; k < 4; k++) {
        const q = neighbors[k]
        if (q >= 0 && target[q] && !known[q] && !queued[q]) {
          queued[q] = 1
          queue[tail++] = q
        }
      }
    }
    // 투명만 닿아 있는 채울 영역은 무작위 원본에서 시작해 퍼뜨린다
    while (scan < n && (!target[scan] || known[scan])) scan++
    if (scan >= n) break
    queue[tail++] = scan
    queued[scan] = 1
  }
  return 1
}
