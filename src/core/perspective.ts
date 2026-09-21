/**
 * 원근 보정(문서 펴기) — 네 모서리를 직사각형으로 편다 (순수 TS).
 *
 * 출처: `~/Compositor` `Document/Distort.swift` — 자유 변형(⌘-드래그로 네 모서리를 따로 옮기고, 적용하면
 * 픽셀을 새 모양으로 리샘플). 에디터에서는 "직사각형 → 사각형" 이지만, 변환기에서는 반대로
 * **사진 속 비뚤어진 사각형(문서·영수증·칠판) → 반듯한 직사각형** 이 쓸모 있어 방향을 뒤집었다.
 * 계산은 표준 호모그래피(8원 연립방정식) + 역매핑 양선형 샘플.
 */

export interface Pt {
  x: number
  y: number
}

/** 원본 이미지 기준 0~1 정규화 네 모서리 — 왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래 */
export type Quad = [Pt, Pt, Pt, Pt]

export const IDENTITY_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 }
]

export function isIdentityQuad(q: Quad | null | undefined): boolean {
  if (!q) return true
  return q.every((p, i) => Math.abs(p.x - IDENTITY_QUAD[i].x) < 1e-6 && Math.abs(p.y - IDENTITY_QUAD[i].y) < 1e-6)
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

/** 펴진 결과의 픽셀 크기 — 마주 보는 변 길이의 평균 (원본 픽셀 기준) */
export function quadOutputSize(q: Quad, srcW: number, srcH: number): { width: number; height: number } {
  const px = q.map((p) => ({ x: p.x * srcW, y: p.y * srcH })) as Quad
  const w = (dist(px[0], px[1]) + dist(px[3], px[2])) / 2
  const h = (dist(px[0], px[3]) + dist(px[1], px[2])) / 2
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
}

/** 네 모서리를 중심 기준으로 deg 만큼 회전 (가로세로 비 aspect = W/H 를 고려 — 화면에서 진짜 각도가 되게) */
export function rotateQuad(q: Quad, deg: number, aspect: number): Quad {
  const r = (deg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const cx = q.reduce((s, p) => s + p.x, 0) / 4
  const cy = q.reduce((s, p) => s + p.y, 0) / 4
  return q.map((p) => {
    const x = (p.x - cx) * aspect
    const y = p.y - cy
    return { x: cx + (x * cos - y * sin) / aspect, y: cy + x * sin + y * cos }
  }) as Quad
}

/**
 * (0,0)-(w,h) 직사각형을 네 점 dst 로 보내는 호모그래피 3×3 (행 우선, h33 = 1).
 * 가우스 소거로 8원 연립방정식을 푼다.
 */
export function rectToQuadHomography(w: number, h: number, dst: Quad): number[] {
  const src: Pt[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h }
  ]
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[pivot][c])) pivot = r
    ;[A[c], A[pivot]] = [A[pivot], A[c]]
    const d = A[c][c] || 1e-12
    for (let k = c; k < 9; k++) A[c][k] /= d
    for (let r = 0; r < 8; r++) {
      if (r === c) continue
      const f = A[r][c]
      if (!f) continue
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1]
}

export function applyHomography(H: number[], x: number, y: number): Pt {
  const w = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w }
}

/**
 * 원본 RGBA 에서 q(정규화) 사각형을 outW×outH 직사각형으로 편다.
 * 원본 밖은 투명. 프리멀티플라이드 양선형이라 투명 경계가 검게 번지지 않는다.
 */
export function warpQuad(src: Uint8ClampedArray, srcW: number, srcH: number, q: Quad, outW: number, outH: number): Uint8ClampedArray {
  const dst = q.map((p) => ({ x: p.x * srcW, y: p.y * srcH })) as Quad
  const H = rectToQuadHomography(outW, outH, dst)
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const s = applyHomography(H, x + 0.5, y + 0.5)
      const sx = s.x - 0.5
      const sy = s.y - 0.5
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < 2; j++) {
        const yy = y0 + j
        if (yy < 0 || yy >= srcH) continue
        const wy = j ? fy : 1 - fy
        for (let i = 0; i < 2; i++) {
          const xx = x0 + i
          if (xx < 0 || xx >= srcW) continue
          const wgt = wy * (i ? fx : 1 - fx)
          if (!wgt) continue
          const o = (yy * srcW + xx) * 4
          const al = src[o + 3] * wgt
          r += src[o] * al
          g += src[o + 1] * al
          b += src[o + 2] * al
          a += al
        }
      }
      const o = (y * outW + x) * 4
      out[o + 3] = a
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
    }
  }
  return out
}
