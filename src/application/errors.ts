/**
 * application 명령의 오류 계약 — 데스크톱·웹·서버·MCP 가 같은 코드를 쓴다 (plans/0004 §4).
 * 외부로 나가는 문구에는 내부 경로·토큰·stack 을 넣지 않는다. `details` 는 호출자가 고칠 수 있는 정보만.
 */
export type ErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'FORBIDDEN' | 'REVISION_CONFLICT' | 'RESOURCE_LIMIT' | 'CANCELLED' | 'TIMEOUT' | 'UNSUPPORTED_CAPABILITY' | 'INTERNAL'

export class CommandError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CommandError'
  }
}

export const invalid = (message: string, details?: Record<string, unknown>): CommandError => new CommandError('INVALID_INPUT', message, details)
export const notFound = (what: string): CommandError => new CommandError('NOT_FOUND', `${what}을(를) 찾을 수 없습니다.`)
export const limit = (message: string, details?: Record<string, unknown>): CommandError => new CommandError('RESOURCE_LIMIT', message, details)
export const unsupported = (message: string): CommandError => new CommandError('UNSUPPORTED_CAPABILITY', message)

/** 모르는 예외를 외부에 내보낼 모양으로 — 내부 문구는 숨긴다 */
export function toCommandError(error: unknown): CommandError {
  if (error instanceof CommandError) return error
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'CANCELLED' || code === 'TIMEOUT') return new CommandError(code, code === 'CANCELLED' ? '작업을 취소했습니다.' : '작업 시간 한도를 넘었습니다.')
  return new CommandError('INTERNAL', '작업을 처리하지 못했습니다.')
}
