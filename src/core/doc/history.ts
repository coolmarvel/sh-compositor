/**
 * 실행취소/다시실행 (순수 TS) — Compositor `DocumentHistory`.
 * 문서 스냅샷을 쌓는다. 문서는 불변이고 안 바뀐 레이어·비트맵은 공유하므로 한 칸의 비용 = 바뀐 부분.
 * 각 칸에 동작 이름("브러시", "레벨" …)을 붙여 메뉴에 "실행취소: 브러시" 로 보인다.
 *
 * 한도는 두 가지: 단계 수(`limit`)와 픽셀 메모리(`budgetBytes`). 메모리는 칸들이 붙잡는 **서로 다른** 픽셀 버퍼의 합이다
 * (공유 비트맵은 한 번만 센다). 넘으면 오래된 칸부터 지운다. 단, 직전 한 단계는 예산을 넘어도 남긴다 (방금 한 일은 되돌릴 수 있게).
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
/** 탭 하나의 기본 이력 메모리 예산(MB). 4000×3000 레이어 하나가 약 46MB — 전체 레이어를 고치는 편집이면 약 20단계 */
export const HISTORY_BUDGET_MB = 1024
/** 예산을 넘어도 남기는 최소 실행취소 단계 */
export const HISTORY_MIN_STEPS = 1

export interface HistoryLimits {
  limit?: number
  budgetBytes?: number
}

export function startHistory(doc: Doc, label = '열기'): History {
  return { past: [], present: doc, label, future: [] }
}

/** 문서가 붙잡는 픽셀 버퍼들 (레이어·마스크 비트맵, 선택 마스크) */
function eachBuffer(doc: Doc, fn: (buf: ArrayBufferLike, bytes: number) => void): void {
  for (const l of doc.layers) {
    if (l.bitmap) fn(l.bitmap.data.buffer, l.bitmap.data.byteLength)
    if (l.mask) fn(l.mask.bitmap.data.buffer, l.mask.bitmap.data.byteLength)
  }
  if (doc.selection) fn(doc.selection.mask.buffer, doc.selection.mask.byteLength)
}

/** 문서들이 함께 붙잡는 픽셀 바이트 (같은 버퍼는 한 번). 부분 view 는 view 크기로 센다 */
export function docsBytes(docs: Iterable<Doc>): number {
  const seen = new Set<ArrayBufferLike>()
  let total = 0
  for (const d of docs)
    eachBuffer(d, (buf, bytes) => {
      if (seen.has(buf)) return
      seen.add(buf)
      total += bytes
    })
  return total
}

/** 이력 전체(과거·현재·미래)가 붙잡는 픽셀 바이트 */
export function historyBytes(h: History): number {
  return docsBytes([...h.past.map((p) => p.doc), h.present, ...h.future.map((f) => f.doc)])
}

/**
 * 오래된 칸을 지워 예산 안으로. present·future 는 지우지 않는다.
 * 버퍼마다 "마지막으로 쓰는 칸"을 구하면, 앞에서 k 칸을 지울 때 풀리는 바이트 = 마지막 사용이 k 이전인 버퍼들 — 한 번 훑기로 계산한다.
 */
function trimToBudget(h: History, budgetBytes: number): History {
  const docs = [...h.past.map((p) => p.doc), h.present, ...h.future.map((f) => f.doc)]
  const last = new Map<ArrayBufferLike, { index: number; bytes: number }>()
  docs.forEach((d, i) => eachBuffer(d, (buf, bytes) => last.set(buf, { index: i, bytes })))
  let total = 0
  const freedAt = new Float64Array(h.past.length + 1)
  for (const { index, bytes } of last.values()) {
    total += bytes
    if (index < h.past.length) freedAt[index + 1] += bytes
  }
  if (total <= budgetBytes) return h
  const maxDrop = Math.max(0, h.past.length - HISTORY_MIN_STEPS)
  let freed = 0
  let drop = 0
  while (drop < maxDrop && total - freed > budgetBytes) {
    drop++
    freed += freedAt[drop]
  }
  return drop ? { ...h, past: h.past.slice(drop) } : h
}

/** 새 상태를 기록. 같은 문서면 무시 */
export function record(h: History, doc: Doc, label: string, limits: number | HistoryLimits = HISTORY_LIMIT): History {
  if (doc === h.present) return h
  const { limit = HISTORY_LIMIT, budgetBytes } = typeof limits === 'number' ? { limit: limits } : limits
  const past = [...h.past, { doc: h.present, label: h.label }]
  if (past.length > limit) past.splice(0, past.length - limit)
  const next = { past, present: doc, label, future: [] }
  return budgetBytes !== undefined ? trimToBudget(next, budgetBytes) : next
}

/**
 * 직전 칸을 덮어쓴다 — 슬라이더를 끄는 동안처럼 "한 동작"이 여러 번 바뀌는 경우.
 * (마지막 기록의 label 이 같을 때만 합친다)
 */
export function replace(h: History, doc: Doc, label: string, limits: number | HistoryLimits = HISTORY_LIMIT): History {
  if (h.label !== label || h.past.length === 0) return record(h, doc, label, limits)
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
