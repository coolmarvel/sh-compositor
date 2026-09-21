/**
 * 보기(배율·위치) 계산 — 캔버스와 스토어가 함께 쓴다 (문서 크기가 바뀌는 순간 스토어가 동기적으로 다시 맞추도록).
 */
import type { View } from '../gl/GLRenderer'

/** 문서가 화면에 맞는 배율 (여백 24px) — Compositor viewport.fit */
export function fitView(w: number, h: number, cw: number, ch: number): View {
  const z = Math.min((cw - 48) / w, (ch - 48) / h, 1)
  const zoom = Math.max(0.01, z)
  return { zoom, panX: Math.round((cw - w * zoom) / 2), panY: Math.round((ch - h * zoom) / 2), fit: true, cw, ch }
}

/**
 * 캔버스 영역 크기가 바뀌었을 때의 보기 — 맞춤 상태면 다시 맞추고(처음 연 문서는 항상 상하좌우 가운데),
 * 사용자가 팬·줌한 보기면 화면 중심을 유지한다 (창 최대화·패널 폭 조절). 2026-09-21 피드백: 최대화 후 왼쪽 위에 남던 문제.
 */
export function adaptView(v: View | null, docW: number, docH: number, cw: number, ch: number): View {
  if (!v || v.fit) {
    const f = fitView(docW, docH, cw, ch)
    return v && v.zoom === f.zoom && v.panX === f.panX && v.panY === f.panY && v.cw === cw && v.ch === ch ? v : f
  }
  if (v.cw === undefined || v.ch === undefined) return { ...v, cw, ch }
  if (v.cw === cw && v.ch === ch) return v
  return { ...v, panX: Math.round(v.panX + (cw - v.cw) / 2), panY: Math.round(v.panY + (ch - v.ch) / 2), cw, ch }
}

/** 확대 단계 (Photoshop 식 프리셋) */
const ZOOM_STEPS = [0.02, 0.03, 0.05, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 1.5, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32]
export function nextZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z * 1.001) ?? 32
  return [...ZOOM_STEPS].reverse().find((s) => s < z / 1.001) ?? 0.02
}
