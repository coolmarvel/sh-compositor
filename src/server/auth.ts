/**
 * 인증 — Bearer 토큰 → Principal(owner·scope). 호출자가 인자로 준 userId 는 쓰지 않는다.
 * 토큰 비교는 SHA-256 요약끼리 상수 시간으로 (길이·내용이 시간으로 새지 않게). 원문 토큰은 기록하지 않는다.
 * 이 MVP 는 서버 설정에 적은 정적 토큰(개인·소규모)만 받는다. OAuth 인가 서버와의 연동은 SHC_AUTH_SERVERS 메타데이터 공지까지 (ADR-0005).
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Principal } from '../application/service'
import type { TokenEntry } from './config'

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest()

export class TokenAuth {
  private entries: { hash: Buffer; principal: Principal }[]
  constructor(tokens: TokenEntry[]) {
    this.entries = tokens.map((t) => ({ hash: digest(t.token), principal: { owner: t.owner, scopes: t.scopes } }))
  }
  get configured(): boolean {
    return this.entries.length > 0
  }
  /** Authorization 헤더 → Principal (없거나 틀리면 null) */
  verify(header: string | undefined): Principal | null {
    const m = /^Bearer ([A-Za-z0-9._~+/=-]{16,512})$/.exec(header ?? '')
    if (!m) return null
    const h = digest(m[1])
    let found: Principal | null = null
    // 일치 여부와 상관없이 모든 항목을 비교한다
    for (const e of this.entries) if (timingSafeEqual(e.hash, h)) found = e.principal
    return found
  }
}
