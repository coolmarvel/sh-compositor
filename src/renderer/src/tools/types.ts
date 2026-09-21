/**
 * 도구 공통 계약 — Compositor 의 도구별 `EditorSession+…` 확장과 `EditorCanvas` 의 이벤트 분기를 모듈 하나씩으로.
 * 캔버스(CanvasView)가 포인터·키 이벤트를 활성 도구에 넘기고, 도구는 문서를 `editor.commit` 으로 바꾸거나
 * 오버레이(2D 캔버스)에 미리보기를 그린다.
 */
import type { Doc } from '@core/index'
import type { GLRenderer, View } from '../gl/GLRenderer'

export interface Pt {
  x: number
  y: number
}

export interface ToolCtx {
  doc(): Doc | null
  view(): View
  renderer(): GLRenderer | null
  /** 화면(캔버스 요소 기준 CSS px) → 문서 px */
  toDoc(sx: number, sy: number): Pt
  toScreen(dx: number, dy: number): Pt
  /** GL·오버레이 다시 그리기 */
  redraw(): void
  setView(v: View): void
}

export interface PointerInfo {
  /** 문서 좌표 */
  p: Pt
  /** 화면 좌표 (캔버스 요소 기준) */
  s: Pt
  shift: boolean
  alt: boolean
  ctrl: boolean
  button: number
  pressure: number
  e: PointerEvent
}

export interface ToolHandler {
  down?(c: ToolCtx, p: PointerInfo): void
  move?(c: ToolCtx, p: PointerInfo, dragging: boolean): void
  up?(c: ToolCtx, p: PointerInfo): void
  /** true 면 처리했음 (전역 단축키로 넘기지 않음) */
  key?(c: ToolCtx, e: KeyboardEvent): boolean
  overlay?(c: ToolCtx, g: CanvasRenderingContext2D): void
  cursor?(c: ToolCtx, hover: PointerInfo | null): string
  /** Esc */
  cancel?(c: ToolCtx): void
  /** Enter */
  commit?(c: ToolCtx): void
  /** 도구를 떠날 때 (진행 중인 것 확정) */
  leave?(c: ToolCtx): void
  /** 더블클릭 */
  dbl?(c: ToolCtx, p: PointerInfo): void
}

/** 화면 px 를 문서 px 로 (히트 판정 반경 등) */
export const screenToDocLen = (c: ToolCtx, px: number): number => px / c.view().zoom

/** 개미 행진 선 (흑백 교대 점선, 시간에 따라 흐름) */
export function antsStroke(g: CanvasRenderingContext2D, path: () => void, t = performance.now()): void {
  g.save()
  g.lineWidth = 1
  g.setLineDash([4, 4])
  g.strokeStyle = '#000'
  g.lineDashOffset = -(t / 60) % 8
  path()
  g.stroke()
  g.strokeStyle = '#fff'
  g.lineDashOffset = (-(t / 60) % 8) + 4
  path()
  g.stroke()
  g.restore()
}
