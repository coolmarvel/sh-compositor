/**
 * 데스크톱·웹 편집기 ↔ application 명령. 편집기는 탭 ID·revision 을 명시해 커밋한다 (활성 탭을 암묵적 대상으로 쓰지 않는다).
 *
 *  - `runCommand`: UI 입력을 application 명령으로 검증·실행해 지금 탭에 한 단계로 커밋. 서버·MCP 와 같은 명령이라 결과가 같다.
 *  - `capture`/`land`: 오래 걸리는 작업(배경 제거·내용 인식 등)이 시작할 때의 탭·revision 을 잡아 두고,
 *    끝나면 그 탭이 그대로일 때만 커밋한다. 탭이 닫혔거나 문서가 바뀌었으면 결과를 버리고 알린다.
 */
import { editor } from './store'
import { type DocCommand } from '../../../application/commands'
import { CommandError } from '../../../application/errors'
import type { Doc } from '@core/index'

export interface Captured {
  tabId: string
  revision: number
  doc: Doc
  signal: AbortSignal
}

/** 지금 탭의 문서·revision 을 잡는다 (문서가 없으면 null) */
export function capture(): Captured | null {
  const t = editor.tab
  return t ? { tabId: t.id, revision: t.revision, doc: t.history.present, signal: editor.tabSignal(t.id) } : null
}

/** 잡아 둔 탭에 커밋. 버렸으면 false (안내 포함) */
export function land(c: Captured, doc: Doc, label: string): boolean {
  const r = editor.commitTo(c.tabId, c.revision, doc, label)
  if (r === 'conflict') editor.toast('info', `${label} 결과를 적용하지 않았습니다. 작업하는 동안 문서가 바뀌었습니다. 다시 실행해 주세요.`)
  return r === 'ok'
}

/** 잡아 둔 탭의 지금 문서 (닫혔으면 null) */
export function currentDoc(c: Captured): Doc | null {
  return editor.state.tabs.find((t) => t.id === c.tabId)?.history.present ?? null
}

/** application 명령을 지금 탭에 — 검증 실패는 안내로 보여 주고 false */
export function runCommand<I>(cmd: DocCommand<I>, raw: unknown, label?: string): boolean {
  const c = capture()
  if (!c) return false
  try {
    const out = cmd.run(c.doc, cmd.parse(raw))
    return land(c, out.doc, label ?? out.label)
  } catch (e) {
    editor.toast(e instanceof CommandError && e.code !== 'INTERNAL' ? 'info' : 'err', e instanceof Error ? e.message : String(e))
    return false
  }
}
