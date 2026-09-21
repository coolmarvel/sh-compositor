/**
 * 커서 위치·색 — 상태 줄 전용 작은 스토어. 포인터가 움직일 때마다 앱 전체를 다시 그리지 않도록 편집기 스토어와 분리.
 */
import { useSyncExternalStore } from 'react'

export interface CursorInfo {
  x: number
  y: number
  /** 보이는 합성 색 (GPU 결과, 스트레이트 알파) — 문서 밖이면 null */
  rgba: [number, number, number, number] | null
}

let state: CursorInfo | null = null
const listeners = new Set<() => void>()

export function setCursor(c: CursorInfo | null): void {
  if (c === state || (c && state && c.x === state.x && c.y === state.y && c.rgba?.join() === state.rgba?.join())) return
  state = c
  for (const l of listeners) l()
}

export function useCursor(): CursorInfo | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state
  )
}
