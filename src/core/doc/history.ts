/**
 * 실행취소/다시실행 (순수 TS) — Compositor `DocumentHistory`.
 * 문서 스냅샷을 쌓는다. 문서는 불변이고 안 바뀐 레이어·비트맵은 공유하므로 한 칸의 비용 = 바뀐 부분.
 * 각 칸에 동작 이름("브러시", "레벨" …)을 붙여 메뉴에 "실행취소: 브러시" 로 보인다.
 */
import type { Doc } from './types'

export interface History {
  past: { doc: Doc; label: string }[]
  present: Doc
  /** present 를 만든 동작 이름 */
  label: string
  future: { doc: Doc; label: string }[]
}

/** 기본 한도 — 비트맵 공유 덕에 수백 칸도 가능하지만 큰 브러시 편집이 쌓이면 메모리가 늘어난다 */
export const HISTORY_LIMIT = 80

export function startHistory(doc: Doc, label = '열기'): History {
  return { past: [], present: doc, label, future: [] }
}

/** 새 상태를 기록. 같은 문서면 무시 */
export function record(h: History, doc: Doc, label: string, limit = HISTORY_LIMIT): History {
  if (doc === h.present) return h
  const past = [...h.past, { doc: h.present, label: h.label }]
  if (past.length > limit) past.splice(0, past.length - limit)
  return { past, present: doc, label, future: [] }
}

/**
 * 직전 칸을 덮어쓴다 — 슬라이더를 끄는 동안처럼 "한 동작"이 여러 번 바뀌는 경우.
 * (마지막 기록의 label 이 같을 때만 합친다)
 */
export function replace(h: History, doc: Doc, label: string): History {
  if (h.label !== label || h.past.length === 0) return record(h, doc, label)
  return { ...h, present: doc }
}

/** 선택 영역·활성 레이어처럼 이력에 남기지 않는 변화 */
export function silent(h: History, doc: Doc): History {
  return { ...h, present: doc }
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1]
  if (!prev) return h
  return { past: h.past.slice(0, -1), present: prev.doc, label: prev.label, future: [{ doc: h.present, label: h.label }, ...h.future] }
}

export function redo(h: History): History {
  const next = h.future[0]
  if (!next) return h
  return { past: [...h.past, { doc: h.present, label: h.label }], present: next.doc, label: next.label, future: h.future.slice(1) }
}

export const canUndo = (h: History): boolean => h.past.length > 0
export const canRedo = (h: History): boolean => h.future.length > 0
/** 다음 실행취소 이름 */
export const undoLabel = (h: History): string | null => (h.past.length ? h.label : null)
export const redoLabel = (h: History): string | null => h.future[0]?.label ?? null
