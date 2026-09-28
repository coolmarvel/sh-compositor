/**
 * AI 지우개(인페인팅) 앞뒤 처리 — 모델(LaMa, 512×512 고정)은 편집기 일꾼이 돌리고, 여기는 순수 계산만 (테스트 `test/inpaint.test.ts`).
 *
 *  1. 칠한 자리(hole)를 조금 넓힌다 — 개체 가장자리의 테두리·그림자 한 겹까지 지워야 자국이 남지 않는다.
 *  2. 그 둘레를 정사각형으로 넉넉히 잘라(주변을 보고 그리도록) 512×512 로 줄이거나 늘려 모델 입력을 만든다.
 *  3. 결과를 잘라 낸 크기로 되돌려 부드러운 가장자리로 원본에 섞는다 — 지운 곳 밖의 픽셀은 한 값도 바뀌지 않는다.
 */
import type { Bitmap } from './doc/types'
import { maskBounds } from './doc/selection'

/** 모델 입력 한 변 (LaMa ONNX 는 512 고정) */
export const INPAINT_SIZE = 512

export interface InpaintJob {
  /** 원본 비트맵 안의 잘라 낸 사각형 */
  crop: { x: number; y: number; w: number; h: number }
  /** 모델 입력 한 변 */
  size: number
  /** 모델 입력 RGB (CHW, 0~1) · 마스크 (1 = 지울 곳) */
  image: Float32Array
  mask: Float32Array
  /** crop 크기의 섞기 가중치 0~1 (1 = 모델 결과) */
  weight: Float32Array
}

/** 이진 팽창 (정사각 반경 r, 가로·세로 분리 — 누적합으로 반경에 상관없이 한 번씩) */
export function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return bin.slice()
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  const row = new Int32Array(w + 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x + 1] = row[x] + (bin[y * w + x] ? 1 : 0)
    for (let x = 0; x < w; x++) tmp[y * w + x] = row[Math.min(w, x + r + 1)] - row[Math.max(0, x - r)] > 0 ? 1 : 0
  }
  const col = new Int32Array(h + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y + 1] = col[y] + tmp[y * w + x]
    for (let y = 0; y < h; y++) out[y * w + x] = col[Math.min(h, y + r + 1)] - col[Math.max(0, y - r)] > 0 ? 1 : 0
  }
  return out
}

/** 상자 흐림 (가로·세로 한 번씩, 반경 r) — 0~1 값 */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src.slice()
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const acc = new Float64Array(Math.max(w, h) + 1)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + src[y * w + x]
    for (let x = 0; x < w; x++) {
      const a = Math.max(0, x - r)
      const b = Math.min(w, x + r + 1)
      tmp[y * w + x] = (acc[b] - acc[a]) / (b - a)
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + tmp[y * w + x]
    for (let y = 0; y < h; y++) {
      const a = Math.max(0, y - r)
      const b = Math.min(h, y + r + 1)
      out[y * w + x] = (acc[b] - acc[a]) / (b - a)
    }
  }
  return out
}

/**
 * 한 채널 크기 바꾸기 — 줄일 때는 덮는 칸의 넓이 평균(계단 무늬 없이), 늘릴 때는 쌍선형.
 * src 는 plane 개 채널이 이어 붙은 배열 (CHW).
 */
function resample(src: ArrayLike<number>, sw: number, sh: number, dw: number, dh: number, planes: number): Float32Array {
  const out = new Float32Array(planes * dw * dh)
  const sp = sw * sh
  const dp = dw * dh
  if (dw <= sw && dh <= sh) {
    const kx = sw / dw
    const ky = sh / dh
    for (let y = 0; y < dh; y++) {
      const y0 = Math.floor(y * ky)
      const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * ky)))
      for (let x = 0; x < dw; x++) {
        const x0 = Math.floor(x * kx)
        const x1 = Math.max(x0 + 1, Math.min(sw, Math.floor((x + 1) * kx)))
        const n = (x1 - x0) * (y1 - y0)
        for (let c = 0; c < planes; c++) {
          let sum = 0
          for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) sum += src[c * sp + sy * sw + sx]
          out[c * dp + y * dw + x] = sum / n
        }
      }
    }
    return out
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      for (let c = 0; c < planes; c++) {
        const o = c * sp
        const a = src[o + y0 * sw + x0] + (src[o + y0 * sw + x1] - src[o + y0 * sw + x0]) * tx
        const b = src[o + y1 * sw + x0] + (src[o + y1 * sw + x1] - src[o + y1 * sw + x0]) * tx
        out[c * dp + y * dw + x] = a + (b - a) * ty
      }
    }
  }
  return out
}

/**
 * 지울 곳(hole: 비트맵 크기, 0~255 — 128 이상을 지운다)으로 모델 입력을 만든다. 지울 곳이 없으면 null.
 * 투명한 픽셀은 흰색 위에 얹어 넣는다 (모델은 RGB 만 본다).
 */
export function prepareInpaint(bmp: Bitmap, hole: Uint8Array, N = INPAINT_SIZE): InpaintJob | null {
  const { width: W, height: H, data } = bmp
  const bin = new Uint8Array(W * H)
  for (let i = 0; i < bin.length; i++) bin[i] = hole[i] >= 128 ? 1 : 0
  const b = maskBounds(bin, W, H)
  if (!b) return null
  const size = Math.max(b.w, b.h)
  const grow = Math.min(20, 3 + Math.round(size * 0.015)) // 테두리 한 겹
  const feather = Math.max(2, Math.round(grow / 2))
  // 정사각형으로 자른다 (모델 입력이 정사각형이라 찌그러지지 않게) — 지울 곳의 약 2.2배, 적어도 256
  const side = Math.max(256, Math.round(size * 2.2) + 2 * (grow + feather))
  const cw = Math.min(W, side)
  const ch = Math.min(H, side)
  const x0 = Math.max(0, Math.min(W - cw, Math.round(b.x + b.w / 2 - cw / 2)))
  const y0 = Math.max(0, Math.min(H - ch, Math.round(b.y + b.h / 2 - ch / 2)))
  // 잘라 낸 영역에서 팽창·가중치
  const sub = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) sub.set(bin.subarray((y + y0) * W + x0, (y + y0) * W + x0 + cw), y * cw)
  const hard = dilate(sub, cw, ch, grow + feather) // 모델이 새로 그리는 곳
  const soft = new Float32Array(cw * ch)
  for (let i = 0; i < soft.length; i++) soft[i] = hard[i]
  // 상자 흐림 반경 = feather 라서 dilate(sub, grow) 안쪽은 가중치가 정확히 1 이다
  const weight = boxBlur(soft, cw, ch, feather)
  const P = cw * ch
  const rgb = new Float32Array(3 * P)
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const o = ((y + y0) * W + x + x0) * 4
      const a = data[o + 3] / 255
      const i = y * cw + x
      for (let c = 0; c < 3; c++) rgb[c * P + i] = (data[o + c] * a + 255 * (1 - a)) / 255
    }
  const image = resample(rgb, cw, ch, N, N, 3)
  // 마스크: 줄이든 늘리든 한 칸이 덮는 원래 칸 중 하나라도 지울 곳이면 지운다 (지울 곳이 새지 않게)
  const mask = new Float32Array(N * N)
  const kx = cw / N
  const ky = ch / N
  for (let y = 0; y < N; y++) {
    const sy0 = Math.min(ch - 1, Math.floor(y * ky))
    const sy1 = Math.min(ch, Math.max(sy0 + 1, Math.ceil((y + 1) * ky)))
    for (let x = 0; x < N; x++) {
      const sx0 = Math.min(cw - 1, Math.floor(x * kx))
      const sx1 = Math.min(cw, Math.max(sx0 + 1, Math.ceil((x + 1) * kx)))
      let on = 0
      for (let sy = sy0; sy < sy1 && !on; sy++) for (let sx = sx0; sx < sx1; sx++) if (hard[sy * cw + sx]) on = 1
      mask[y * N + x] = on
    }
  }
  return { crop: { x: x0, y: y0, w: cw, h: ch }, size: N, image, mask, weight }
}

/** 모델 결과(RGB CHW 0~255, size×size)를 잘라 낸 크기로 되돌려 원본에 섞은 새 픽셀 — 알파는 원래대로 */
export function finishInpaint(bmp: Bitmap, job: InpaintJob, result: ArrayLike<number>): Uint8ClampedArray {
  const { crop, weight } = job
  const res = resample(result, job.size, job.size, crop.w, crop.h, 3)
  const out = new Uint8ClampedArray(bmp.data)
  const P = crop.w * crop.h
  for (let y = 0; y < crop.h; y++)
    for (let x = 0; x < crop.w; x++) {
      const i = y * crop.w + x
      const t = weight[i]
      if (t <= 0) continue
      const o = ((y + crop.y) * bmp.width + x + crop.x) * 4
      for (let c = 0; c < 3; c++) out[o + c] = bmp.data[o + c] + (res[c * P + i] - bmp.data[o + c]) * t
    }
  return out
}

/**
 * 배경 흐리게 (인물 사진 모드) — 피사체 마스크(0~255) 밖만 흐린다.
 * 피사체 색이 배경으로 번지지 않게 "배경 가중치로 나눈 흐림"(정규화 합성곱)을 쓴다. 상자 흐림 3번 ≈ 가우시안.
 */
export function blurBackground(bmp: Bitmap, subject: Uint8Array, radius: number): Uint8ClampedArray {
  const { width: w, height: h, data } = bmp
  const n = w * h
  const r = Math.max(1, Math.round(radius / Math.sqrt(3)))
  const bgw = new Float32Array(n)
  for (let i = 0; i < n; i++) bgw[i] = (1 - subject[i] / 255) * (data[i * 4 + 3] / 255)
  let wsum: Float32Array = bgw
  for (let k = 0; k < 3; k++) wsum = boxBlur(wsum, w, h, r)
  const out = new Uint8ClampedArray(data)
  const ch = new Float32Array(n)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = (data[i * 4 + c] / 255) * bgw[i]
    let b: Float32Array = ch
    for (let k = 0; k < 3; k++) b = boxBlur(b, w, h, r)
    for (let i = 0; i < n; i++) {
      const s = subject[i] / 255
      const v = wsum[i] > 1e-4 ? (b[i] / wsum[i]) * 255 : data[i * 4 + c]
      out[i * 4 + c] = data[i * 4 + c] * s + v * (1 - s)
    }
  }
  return out
}

/** 배경을 한 색으로 (증명사진·상품 사진) — 피사체 마스크 밖을 그 색으로, 가장자리는 섞는다. 결과는 불투명 */
export function fillBackground(bmp: Bitmap, subject: Uint8Array, rgb: [number, number, number]): Uint8ClampedArray {
  const { data } = bmp
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < subject.length; i++) {
    const s = (subject[i] / 255) * (data[i * 4 + 3] / 255)
    for (let c = 0; c < 3; c++) out[i * 4 + c] = data[i * 4 + c] * s + rgb[c] * (1 - s)
    out[i * 4 + 3] = 255
  }
  return out
}
