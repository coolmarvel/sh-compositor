/**
 * "캔버스 크기" 계산 (순수 TS).
 *
 * 출처: `~/Compositor` `UI/CanvasSizeSheet.swift` / `IO/CanvasResizer.swift`.
 * 이미지 크기(리샘플)와 다르다 — **픽셀은 그대로 두고 종이만 키우거나 잘라 낸다.**
 * 9방향 앵커가 원본을 새 종이의 어디에 앉힐지 정하고, 늘어난 여백은 배경색으로 채운다.
 * (여권 사진 여백 주기, 정사각 썸네일 만들기 같은 변환기다운 쓰임)
 */

export type Anchor = 'nw' | 'n' | 'ne' | 'w' | 'c' | 'e' | 'sw' | 's' | 'se'

export const ANCHORS: Anchor[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se']

/**
 * 여러 파일을 한 번에 변환하므로 크기 지정은 세 가지 방식이다.
 *  - absolute: 모든 결과를 W×H 종이에 (여권 사진·배너처럼 규격이 정해진 경우)
 *  - relative: 각 이미지에 가로 +W, 세로 +H 픽셀 여백(음수면 잘라 냄)
 *  - square:   긴 변에 맞춘 정사각 (썸네일·아이콘)
 */
export type CanvasSizeMode = 'absolute' | 'relative' | 'square'

export interface CanvasSizeOptions {
  mode: CanvasSizeMode
  width: number
  height: number
  anchor: Anchor
  /** 여백 색 '#rrggbb' — 투명이면 null, 'content' = 내용 인식 채우기(주변 그림으로) */
  background: string | null
}

/** 여백을 내용 인식 채우기로 메우는가 */
export const CONTENT_FILL = 'content'

/** 원본 크기 + 옵션 → 새 캔버스 크기 */
export function canvasTarget(srcW: number, srcH: number, o: CanvasSizeOptions): { width: number; height: number } {
  if (o.mode === 'square') {
    const s = Math.max(srcW, srcH)
    return { width: s, height: s }
  }
  if (o.mode === 'relative') {
    return { width: Math.max(1, Math.round(srcW + o.width)), height: Math.max(1, Math.round(srcH + o.height)) }
  }
  return { width: Math.max(1, Math.round(o.width)), height: Math.max(1, Math.round(o.height)) }
}

/** 옵션이 실제로 크기를 바꾸는가 (원본과 같으면 파이프라인에서 건너뛴다) */
export function changesCanvas(srcW: number, srcH: number, o: CanvasSizeOptions | null | undefined): o is CanvasSizeOptions {
  if (!o) return false
  const t = canvasTarget(srcW, srcH, o)
  return t.width !== srcW || t.height !== srcH
}

/** 원본을 새 캔버스의 어디에 그릴지 (좌상단 좌표, 음수면 잘려 나간다) */
export function anchorOffset(srcW: number, srcH: number, dstW: number, dstH: number, anchor: Anchor): { dx: number; dy: number } {
  const west = anchor === 'nw' || anchor === 'w' || anchor === 'sw'
  const east = anchor === 'ne' || anchor === 'e' || anchor === 'se'
  const north = anchor === 'nw' || anchor === 'n' || anchor === 'ne'
  const south = anchor === 'sw' || anchor === 's' || anchor === 'se'
  const dx = west ? 0 : east ? dstW - srcW : Math.round((dstW - srcW) / 2)
  const dy = north ? 0 : south ? dstH - srcH : Math.round((dstH - srcH) / 2)
  return { dx, dy }
}

/** 방향 화살표 라벨 (앵커 격자 버튼의 보조 설명) */
export function anchorLabel(anchor: Anchor): string {
  const names: Record<Anchor, string> = {
    nw: '왼쪽 위',
    n: '위',
    ne: '오른쪽 위',
    w: '왼쪽',
    c: '가운데',
    e: '오른쪽',
    sw: '왼쪽 아래',
    s: '아래',
    se: '오른쪽 아래'
  }
  return names[anchor]
}
