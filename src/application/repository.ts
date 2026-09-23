/**
 * 문서 저장소 — ID별 스냅샷 조회와 **버전 비교 커밋**. 브라우저 탭·서버가 각자 구현한다 (plans/0004 §3).
 * 메모리 구현은 서버 MVP·테스트용: 프로세스가 끝나면 사라진다 (보관 정책은 service 의 TTL).
 */
import type { Doc } from '../core/doc/types'
import { startHistory, type History } from '../core/doc/history'
import { CommandError } from './errors'

export interface StoredDocument {
  readonly id: string
  readonly owner: string
  name: string
  /** 커밋마다 1씩 (실행취소도 새 revision) */
  revision: number
  history: History
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface DocumentRepository {
  create(owner: string, name: string, doc: Doc, now: number, ttlMs: number): StoredDocument
  get(id: string): StoredDocument | null
  /** expectedRevision 이 현재와 다르면 REVISION_CONFLICT. update 는 새 이력을 돌려준다 */
  commit(id: string, expectedRevision: number, update: (h: History) => History, now: number, ttlMs: number): StoredDocument
  /** 이력에 남아 있는 revision 의 문서 (없으면 null) */
  docAt(id: string, revision: number): Doc | null
  delete(id: string): boolean
  countByOwner(owner: string): number
  /** 만료된 문서를 지우고 그 ID 들을 돌려준다 */
  sweep(now: number): string[]
}

export const newToken = (prefix: string): string => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`

export class MemoryDocumentRepository implements DocumentRepository {
  private docs = new Map<string, StoredDocument>()
  /** revision → 문서. 이력에서 빠진 문서는 지운다 */
  private revisions = new Map<string, Map<number, Doc>>()

  create(owner: string, name: string, doc: Doc, now: number, ttlMs: number): StoredDocument {
    const s: StoredDocument = { id: newToken('doc'), owner, name, revision: 1, history: startHistory(doc, '만들기'), createdAt: now, updatedAt: now, expiresAt: now + ttlMs }
    this.docs.set(s.id, s)
    this.revisions.set(s.id, new Map([[1, doc]]))
    return s
  }
  get(id: string): StoredDocument | null {
    return this.docs.get(id) ?? null
  }
  commit(id: string, expectedRevision: number, update: (h: History) => History, now: number, ttlMs: number): StoredDocument {
    const s = this.docs.get(id)
    if (!s) throw new CommandError('NOT_FOUND', '문서를 찾을 수 없습니다.', { docId: id })
    if (s.revision !== expectedRevision)
      throw new CommandError('REVISION_CONFLICT', '다른 편집이 먼저 반영되었습니다. 문서를 다시 조회한 뒤 시도하세요.', { docId: id, expectedRevision, currentRevision: s.revision })
    const history = update(s.history)
    if (history.present === s.history.present) return s
    s.history = history
    s.revision++
    s.updatedAt = now
    s.expiresAt = now + ttlMs
    const revs = this.revisions.get(id)!
    revs.set(s.revision, history.present)
    const alive = new Set<Doc>([...history.past.map((p) => p.doc), history.present, ...history.future.map((f) => f.doc)])
    for (const [r, d] of revs) if (!alive.has(d)) revs.delete(r)
    return s
  }
  docAt(id: string, revision: number): Doc | null {
    return this.revisions.get(id)?.get(revision) ?? null
  }
  delete(id: string): boolean {
    this.revisions.delete(id)
    return this.docs.delete(id)
  }
  countByOwner(owner: string): number {
    let n = 0
    for (const d of this.docs.values()) if (d.owner === owner) n++
    return n
  }
  sweep(now: number): string[] {
    const gone: string[] = []
    for (const d of this.docs.values()) if (d.expiresAt <= now) gone.push(d.id)
    for (const id of gone) this.delete(id)
    return gone
  }
}
