/**
 * 문서 서비스 — 서버(HTTP·MCP 어댑터)가 부르는 application 진입점. plans/0004 §4~§6 의 계약을 코드로 옮긴 것.
 *
 *  - 호출자 = Principal(인증에서 얻은 owner·scope). 입력에 들어온 userId 는 믿지 않는다.
 *  - 모든 변경은 docId·expectedRevision·operationId 를 받는다. 활성 탭 같은 암묵적 대상은 없다.
 *  - 변경은 작업(job)으로 돈다: 캡처한 revision 으로 계산 → 커밋 직전에 revision 을 다시 비교 → 앞선 편집이 있으면 REVISION_CONFLICT.
 *    성공한 변경 하나 = 실행취소 한 단계.
 *  - operationId 는 owner+ID 로 보관한다: 같은 입력으로 다시 부르면 같은 작업·결과, 다른 입력이면 INVALID_INPUT.
 *  - 다른 owner 의 문서·자산·작업은 NOT_FOUND 로 답한다 (존재 여부를 알리지 않는다). scope 부족은 FORBIDDEN.
 */
import type { Doc } from '../core/doc/types'
import { newDoc } from '../core/doc/ops'
import { record, undo as hUndo, redo as hRedo, canUndo, canRedo, historyBytes } from '../core/doc/history'
import { MAX_SIDE } from '../core/limits'
import { COMMANDS, COMMAND_NAMES, type CommandName, type CommandContext } from './commands/index'
import { CommandError, invalid, limit, notFound, toCommandError } from './errors'
import { object, onlyKeys, int, num, str, oneOf, id, hex } from './validate'
import { MemoryDocumentRepository, newToken, type DocumentRepository, type StoredDocument } from './repository'
import { MemoryAssetStore, assetInfo, type Asset, type AssetInfo, type AssetStore } from './assets'
import { InlineJobRunner, cancelled, type JobRunner, type Task, type TaskResult } from './jobs'
import { importDocument, importBitmap, inspectUpload, EXPORT_FORMATS, IMPORT_FORMATS, MEDIA_TYPES, type ExportFormat } from './codecs'
import { histogram, type Histogram } from '../core/adjust'
import { flattenDoc } from '../core/doc/render'
import { bakeLayer } from '../core/doc/pixels'
import { getLayer } from '../core/doc/ops'
import { describeDoc, describeLayers, type DocSummary, type LayerInfo } from './info'

export type Scope = 'documents:read' | 'documents:write'
export interface Principal {
  owner: string
  scopes: readonly Scope[]
}

/** 운영 한도 — 숫자는 실제 메모리 측정·동시성으로 정해 설정값으로 둔다 (server/config.ts 가 환경 변수에서 읽는다) */
export interface ServiceLimits {
  maxUploadBytes: number
  maxPixels: number
  maxLayers: number
  maxDocsPerOwner: number
  maxAssetBytesPerOwner: number
  maxConcurrentJobs: number
  maxQueuedJobsPerOwner: number
  jobTimeoutMs: number
  docTtlMs: number
  assetTtlMs: number
  /** 끝난 작업·operationId 보관 기간 */
  operationTtlMs: number
  historyLimit: number
  historyBudgetBytes: number
}

export const DEFAULT_LIMITS: ServiceLimits = {
  maxUploadBytes: 32 * 1024 * 1024,
  maxPixels: 40_000_000,
  maxLayers: 64,
  maxDocsPerOwner: 20,
  maxAssetBytesPerOwner: 512 * 1024 * 1024,
  maxConcurrentJobs: 2,
  maxQueuedJobsPerOwner: 8,
  jobTimeoutMs: 60_000,
  docTtlMs: 24 * 60 * 60 * 1000,
  assetTtlMs: 60 * 60 * 1000,
  operationTtlMs: 24 * 60 * 60 * 1000,
  historyLimit: 30,
  historyBudgetBytes: 512 * 1024 * 1024
}

export interface DocInfo extends DocSummary {
  docId: string
  name: string
  revision: number
  canUndo: boolean
  canRedo: boolean
  historyBytes: number
  expiresAt: number
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface JobResult {
  docId: string
  revision: number
  summary: string
  warnings: string[]
  artifact?: AssetInfo
}
export interface JobInfo {
  jobId: string
  operationId: string
  kind: string
  docId: string
  status: JobStatus
  /** 사람이 읽을 단계 (queued → running → committing) */
  stage: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  result?: JobResult
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

interface Job {
  info: JobInfo
  owner: string
  controller: AbortController
  done: Promise<void>
  expiresAt: number
  start?: () => void
  release?: () => void
}

interface Operation {
  fingerprint: string
  jobId: string
  expiresAt: number
}

/** 키 순서와 무관한 JSON (operationId 입력 지문) */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v) ?? 'null'
}

export interface ServiceOptions {
  repo?: DocumentRepository
  assets?: AssetStore
  runner?: JobRunner
  limits?: Partial<ServiceLimits>
  now?: () => number
}

export class DocumentService {
  readonly limits: ServiceLimits
  private repo: DocumentRepository
  private assets: AssetStore
  private runner: JobRunner
  /** 가벼운 명령(속성·변형만 바꾸는 것)은 스레드를 띄우지 않고 이 실행기로 */
  private inline = new InlineJobRunner()
  private now: () => number
  private jobs = new Map<string, Job>()
  private operations = new Map<string, Operation>()
  private queue: Job[] = []
  private running = 0
  /** 작업별 기한 — 타이머가 늦게 깨어나도(부하·VM 정지) 기한을 넘긴 결과는 커밋하지 않는다 */
  private deadlines = new WeakMap<AbortSignal, number>()

  constructor(o: ServiceOptions = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...o.limits }
    this.repo = o.repo ?? new MemoryDocumentRepository()
    this.assets = o.assets ?? new MemoryAssetStore()
    this.runner = o.runner ?? new InlineJobRunner()
    this.now = o.now ?? Date.now
  }

  /** 지원 기능 — 클라이언트가 먼저 보고 고른다 */
  capabilities(): Record<string, unknown> {
    return {
      commands: COMMAND_NAMES,
      importFormats: IMPORT_FORMATS,
      exportFormats: EXPORT_FORMATS,
      coordinates: '문서 픽셀, 왼쪽 위 원점. 레이어 배열은 아래 → 위.',
      unsupported: ['문자 레이어 만들기·편집 (서버에 글꼴·캔버스 없음)', 'AI 배경 제거·피사체 선택·개체 선택 (브라우저 전용 모델)', 'JPEG·WebP·HEIC·TIFF 가져오기/내보내기 (브라우저 디코더)'],
      resampling: ['bilinear'],
      limits: {
        maxUploadBytes: this.limits.maxUploadBytes,
        maxPixels: this.limits.maxPixels,
        maxSide: MAX_SIDE,
        maxLayers: this.limits.maxLayers,
        maxDocsPerOwner: this.limits.maxDocsPerOwner,
        jobTimeoutMs: this.limits.jobTimeoutMs
      },
      retention: { documentMs: this.limits.docTtlMs, assetMs: this.limits.assetTtlMs, operationMs: this.limits.operationTtlMs }
    }
  }

  // ── 권한·조회 공용 ──
  private need(p: Principal, scope: Scope): void {
    if (!p.scopes.includes(scope)) throw new CommandError('FORBIDDEN', `이 작업에는 ${scope} 권한이 필요합니다.`)
  }
  private stored(p: Principal, docId: string): StoredDocument {
    const s = this.repo.get(docId)
    if (!s || s.owner !== p.owner || s.expiresAt <= this.now()) throw new CommandError('NOT_FOUND', '문서를 찾을 수 없습니다.', { docId })
    return s
  }
  private info(s: StoredDocument): DocInfo {
    return {
      docId: s.id,
      name: s.name,
      revision: s.revision,
      ...describeDoc(s.history.present),
      canUndo: canUndo(s.history),
      canRedo: canRedo(s.history),
      historyBytes: historyBytes(s.history),
      expiresAt: s.expiresAt
    }
  }
  private checkDoc(doc: Doc): void {
    if (doc.width * doc.height > this.limits.maxPixels)
      throw limit(`문서가 너무 큽니다 (${doc.width}×${doc.height}, 한도 ${this.limits.maxPixels.toLocaleString()}픽셀).`, { maxPixels: this.limits.maxPixels })
    if (doc.layers.length > this.limits.maxLayers) throw limit(`레이어가 너무 많습니다 (한도 ${this.limits.maxLayers}장).`, { maxLayers: this.limits.maxLayers })
  }
  private newDocSlot(p: Principal): void {
    if (this.repo.countByOwner(p.owner) >= this.limits.maxDocsPerOwner)
      throw limit(`문서는 ${this.limits.maxDocsPerOwner}개까지 둘 수 있습니다. 쓰지 않는 문서를 지우세요.`, { maxDocsPerOwner: this.limits.maxDocsPerOwner })
  }

  // ── 문서 ──
  createDocument(p: Principal, raw: unknown): DocInfo {
    this.need(p, 'documents:write')
    const o = object(raw)
    onlyKeys(o, ['width', 'height', 'background', 'resolution', 'name'])
    const width = int(o, 'width', 1, MAX_SIDE)
    const height = int(o, 'height', 1, MAX_SIDE)
    if (width * height > this.limits.maxPixels) throw limit(`문서가 너무 큽니다 (한도 ${this.limits.maxPixels.toLocaleString()}픽셀).`, { maxPixels: this.limits.maxPixels })
    const bgName = typeof o.background === 'string' && !o.background.startsWith('#') ? oneOf(o, 'background', ['white', 'black', 'transparent'] as const) : undefined
    const bgHex = bgName ? undefined : hex(o, 'background')
    const bg: [number, number, number, number] | null = bgName === 'transparent' ? null : bgName === 'black' ? [0, 0, 0, 255] : bgHex ? [...bgHex, 255] : [255, 255, 255, 255]
    const resolution = num(o, 'resolution', 1, 10000, 72)!
    const name = str(o, 'name', 255, '제목 없음')!
    this.newDocSlot(p)
    const s = this.repo.create(p.owner, name, newDoc(width, height, bg, resolution), this.now(), this.limits.docTtlMs)
    return this.info(s)
  }

  importDocument(p: Principal, raw: unknown): DocInfo & { warnings: string[] } {
    this.need(p, 'documents:write')
    const o = object(raw)
    onlyKeys(o, ['assetId', 'name'])
    const asset = this.asset(p, id(o, 'assetId'))
    const name = str(o, 'name', 255, undefined) ?? asset.name.replace(/\.[^.]+$/, '')
    this.newDocSlot(p)
    const { doc, warnings } = importDocument(asset.bytes, name, this.limits.maxPixels)
    this.checkDoc(doc)
    return { ...this.info(this.repo.create(p.owner, name, doc, this.now(), this.limits.docTtlMs)), warnings }
  }

  getDocument(p: Principal, raw: unknown): DocInfo {
    this.need(p, 'documents:read')
    const o = object(raw)
    onlyKeys(o, ['docId'])
    return this.info(this.stored(p, id(o, 'docId')))
  }

  listDocuments(p: Principal): DocInfo[] {
    this.need(p, 'documents:read')
    return this.repo
      .listByOwner(p.owner)
      .filter((s) => s.expiresAt > this.now())
      .map((s) => this.info(s))
  }
  /** 이름 같은 메타데이터 — revision 을 올리지 않는다 */
  renameDocument(p: Principal, raw: unknown): DocInfo {
    this.need(p, 'documents:write')
    const o = object(raw)
    onlyKeys(o, ['docId', 'name'])
    const s = this.stored(p, id(o, 'docId'))
    const name = str(o, 'name', 255)
    if (!name.trim()) throw invalid('name 은 비워 둘 수 없습니다.', { field: 'name' })
    s.name = name.trim()
    return this.info(s)
  }
  /** 히스토그램 — 레이어(문서 정렬로 구운 픽셀) 또는 합성 결과 */
  getHistogram(p: Principal, raw: unknown): { docId: string; revision: number; layerId: string | null; histogram: Histogram } {
    this.need(p, 'documents:read')
    const o = object(raw)
    onlyKeys(o, ['docId', 'layerId'])
    const s = this.stored(p, id(o, 'docId'))
    const doc = s.history.present
    if (o.layerId === undefined) return { docId: s.id, revision: s.revision, layerId: null, histogram: histogram(flattenDoc(doc).data) }
    const layerId = id(o, 'layerId')
    const l = getLayer(doc, layerId)
    if (!l) throw new CommandError('NOT_FOUND', '레이어를 찾을 수 없습니다.', { layerId })
    if (!l.bitmap) throw invalid('픽셀이 없는 레이어입니다.', { layerId })
    return { docId: s.id, revision: s.revision, layerId, histogram: histogram(getLayer(bakeLayer(doc, l.id), l.id)!.bitmap!.data) }
  }
  listLayers(p: Principal, raw: unknown): { docId: string; revision: number; layers: LayerInfo[] } {
    this.need(p, 'documents:read')
    const o = object(raw)
    onlyKeys(o, ['docId'])
    const s = this.stored(p, id(o, 'docId'))
    return { docId: s.id, revision: s.revision, layers: describeLayers(s.history.present) }
  }

  deleteDocument(p: Principal, raw: unknown): { docId: string; deleted: boolean } {
    this.need(p, 'documents:write')
    const o = object(raw)
    onlyKeys(o, ['docId'])
    const s = this.stored(p, id(o, 'docId'))
    for (const j of this.jobs.values()) if (j.info.docId === s.id) this.abortJob(j)
    return { docId: s.id, deleted: this.repo.delete(s.id) }
  }

  // ── 자산 ──
  uploadAsset(p: Principal, bytes: Uint8Array, meta: { name?: string; mediaType?: string }): AssetInfo {
    this.need(p, 'documents:write')
    if (bytes.byteLength === 0) throw invalid('빈 파일입니다.')
    if (bytes.byteLength > this.limits.maxUploadBytes) throw limit(`파일이 너무 큽니다 (한도 ${this.limits.maxUploadBytes.toLocaleString()}바이트).`, { maxUploadBytes: this.limits.maxUploadBytes })
    this.assetRoom(p, bytes.byteLength)
    const name = (meta.name ?? 'upload').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 255) || 'upload'
    // 형식은 내용으로 판정한다 (선언한 mediaType 을 믿지 않는다)
    const { mediaType } = inspectUpload(bytes)
    const now = this.now()
    return assetInfo(this.assets.put({ owner: p.owner, kind: 'upload', name, mediaType, bytes, createdAt: now, expiresAt: now + this.limits.assetTtlMs }))
  }
  private assetRoom(p: Principal, add: number): void {
    if (this.assets.bytesByOwner(p.owner) + add > this.limits.maxAssetBytesPerOwner)
      throw limit('보관 중인 파일 용량 한도를 넘었습니다. 오래된 결과가 만료되면 다시 시도하세요.', { maxAssetBytesPerOwner: this.limits.maxAssetBytesPerOwner })
  }
  private asset(p: Principal, assetId: string): Asset {
    const a = this.assets.get(assetId)
    if (!a || a.owner !== p.owner || a.expiresAt <= this.now()) throw new CommandError('NOT_FOUND', '파일을 찾을 수 없습니다.', { assetId })
    return a
  }
  /** 다운로드 — 권한을 확인한 뒤 바이트를 준다 */
  readAsset(p: Principal, assetId: string): Asset {
    this.need(p, 'documents:read')
    return this.asset(p, assetId)
  }
  getAssetInfo(p: Principal, assetId: string): AssetInfo {
    return assetInfo(this.readAsset(p, assetId))
  }

  // ── 변경 명령 (작업) ──
  /**
   * 명령 시작 — 입력·권한·revision 을 먼저 검사해 바로 거절할 것은 거절하고, 통과하면 작업을 돌려준다.
   * raw = { docId, expectedRevision, operationId, ...명령 입력 }
   */
  startCommand(p: Principal, name: CommandName, raw: unknown): JobInfo {
    this.need(p, 'documents:write')
    const cmd = COMMANDS[name]
    if (!cmd || !COMMAND_NAMES.includes(name)) throw new CommandError('UNSUPPORTED_CAPABILITY', `알 수 없는 명령입니다: ${name}`)
    const { docId, expectedRevision, operationId, rest } = this.envelope(raw)
    const input = cmd.parse(rest)
    // 문서 밖 자원(업로드한 그림)은 서비스가 소유권을 확인하고 넘긴다 — 가벼운 명령만 (일꾼 스레드에는 없다)
    const ctx: CommandContext = { loadImage: (assetId) => ({ bitmap: importBitmap(this.asset(p, assetId).bytes, this.limits.maxPixels), name: this.asset(p, assetId).name.replace(/\.[^.]+$/, '') }) }
    // 결과 크기를 미리 알면 계산 전에 막는다 (메모리를 먼저 쓰고 나서 거절하지 않게)
    const size = cmd.resultSize?.(input)
    if (size && size.width * size.height > this.limits.maxPixels)
      throw limit(`결과가 너무 큽니다 (${size.width}×${size.height}, 한도 ${this.limits.maxPixels.toLocaleString()}픽셀).`, { maxPixels: this.limits.maxPixels })
    return this.operation(p, operationId, { kind: name, docId, expectedRevision, input: rest }, () => {
      const s = this.stored(p, docId)
      this.expect(s, expectedRevision)
      const doc = s.history.present
      return this.enqueue(p, operationId, name, docId, async (signal) => {
        const runner = cmd.heavy ? this.runner : this.inline
        const out = (await runner.run({ type: 'command', name, doc, input, ...(cmd.heavy ? {} : { ctx }) } as Task, signal)) as Extract<TaskResult, { type: 'command' }>
        return this.commit(p, docId, expectedRevision, (h) => record(h, out.doc, out.label, this.historyLimits()), out.doc, out.summary, out.warnings, signal)
      })
    })
  }

  /** 실행취소·다시 실행도 revision 을 비교하는 변경이다 */
  startHistoryStep(p: Principal, which: 'undo' | 'redo', raw: unknown): JobInfo {
    this.need(p, 'documents:write')
    const { docId, expectedRevision, operationId, rest } = this.envelope(raw)
    onlyKeys(rest, [])
    return this.operation(p, operationId, { kind: which, docId, expectedRevision, input: {} }, () => {
      const s = this.stored(p, docId)
      this.expect(s, expectedRevision)
      if (which === 'undo' ? !canUndo(s.history) : !canRedo(s.history)) throw invalid(which === 'undo' ? '실행 취소할 단계가 없습니다.' : '다시 실행할 단계가 없습니다.')
      // 라벨은 지금 읽는다 (대기 중 다른 커밋이 future 를 비우면 커밋은 REVISION_CONFLICT 로 끝난다)
      const label = which === 'undo' ? s.history.label : s.history.future[0].label
      return this.enqueue(p, operationId, which, docId, async (signal) => {
        return this.commit(p, docId, expectedRevision, which === 'undo' ? hUndo : hRedo, null, `${which === 'undo' ? '실행 취소' : '다시 실행'}: ${label}`, [], signal)
      })
    })
  }

  /** 지정 revision(생략 시 현재)을 PNG·.shcomp 결과 자산으로 */
  startExport(p: Principal, raw: unknown): JobInfo {
    this.need(p, 'documents:read')
    const o = object(raw)
    onlyKeys(o, ['docId', 'revision', 'format', 'operationId'])
    const docId = id(o, 'docId')
    const operationId = o.operationId === undefined ? newToken('op') : id(o, 'operationId')
    const format = oneOf(o, 'format', EXPORT_FORMATS)
    const revision = int(o, 'revision', 1, Number.MAX_SAFE_INTEGER, undefined)
    return this.operation(p, operationId, { kind: 'export', docId, revision, format }, () => {
      const s = this.stored(p, docId)
      const rev = revision ?? s.revision
      const doc = this.repo.docAt(s.id, rev)
      if (!doc) throw new CommandError('NOT_FOUND', '그 revision 은 이력에 남아 있지 않습니다.', { docId, revision: rev, currentRevision: s.revision })
      return this.enqueue(p, operationId, 'export', docId, async (signal) => {
        const out = (await this.runner.run({ type: 'export', doc, format: format as ExportFormat }, signal)) as Extract<TaskResult, { type: 'export' }>
        this.guard(signal)
        this.assetRoom(p, out.bytes.byteLength)
        const now = this.now()
        const artifact = this.assets.put({
          owner: p.owner,
          kind: 'artifact',
          name: `${s.name}.${format}`,
          mediaType: MEDIA_TYPES[format as ExportFormat],
          bytes: out.bytes,
          createdAt: now,
          expiresAt: now + this.limits.assetTtlMs,
          source: { docId, revision: rev, format }
        })
        return { docId, revision: rev, summary: `${format.toUpperCase()} ${out.bytes.byteLength.toLocaleString()}바이트`, warnings: out.warnings, artifact: assetInfo(artifact) }
      })
    })
  }

  private envelope(raw: unknown): { docId: string; expectedRevision: number; operationId: string; rest: Record<string, unknown> } {
    const o = object(raw)
    const docId = id(o, 'docId')
    const expectedRevision = int(o, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER)
    const operationId = id(o, 'operationId')
    const rest = { ...o }
    delete rest.docId
    delete rest.expectedRevision
    delete rest.operationId
    return { docId, expectedRevision, operationId, rest }
  }
  private expect(s: StoredDocument, expectedRevision: number): void {
    if (s.revision !== expectedRevision)
      throw new CommandError('REVISION_CONFLICT', '다른 편집이 먼저 반영되었습니다. 문서를 다시 조회한 뒤 시도하세요.', { docId: s.id, expectedRevision, currentRevision: s.revision })
  }
  /** 결과를 남기기 직전 검사 — 취소됐거나 기한을 넘겼으면 버린다 */
  private guard(signal: AbortSignal): void {
    if (signal.aborted) throw cancelled()
    if (this.now() > (this.deadlines.get(signal) ?? Infinity)) throw new CommandError('TIMEOUT', `작업 시간 한도(${this.limits.jobTimeoutMs}ms)를 넘었습니다.`)
  }
  private historyLimits(): { limit: number; budgetBytes: number } {
    return { limit: this.limits.historyLimit, budgetBytes: this.limits.historyBudgetBytes }
  }
  private commit(
    p: Principal,
    docId: string,
    expectedRevision: number,
    update: Parameters<DocumentRepository['commit']>[2],
    doc: Doc | null,
    summary: string,
    warnings: string[],
    signal: AbortSignal
  ): JobResult {
    // 커밋 전까지만 취소가 먹는다
    this.guard(signal)
    if (doc) this.checkDoc(doc)
    this.stored(p, docId)
    const s = this.repo.commit(docId, expectedRevision, update, this.now(), this.limits.docTtlMs)
    return { docId, revision: s.revision, summary, warnings }
  }

  /** operationId 보관: 같은 지문이면 기존 작업, 다르면 오류, 처음이면 start() */
  private operation(p: Principal, operationId: string, fingerprintOf: unknown, start: () => JobInfo): JobInfo {
    this.sweep()
    const key = `${p.owner}\u0000${operationId}`
    const fingerprint = stableJson(fingerprintOf)
    const prev = this.operations.get(key)
    if (prev) {
      if (prev.fingerprint !== fingerprint) throw invalid('이 operationId 는 다른 입력으로 이미 쓰였습니다. 새 operationId 를 쓰세요.', { operationId, reason: 'OPERATION_ID_REUSED' })
      const job = this.jobs.get(prev.jobId)
      if (job) return { ...job.info }
    }
    const info = start()
    this.operations.set(key, { fingerprint, jobId: info.jobId, expiresAt: this.now() + this.limits.operationTtlMs })
    return info
  }

  private enqueue(p: Principal, operationId: string, kind: string, docId: string, work: (signal: AbortSignal) => Promise<JobResult>): JobInfo {
    const queued = [...this.jobs.values()].filter((j) => j.owner === p.owner && !this.finished(j)).length
    if (queued >= this.limits.maxQueuedJobsPerOwner) throw limit(`동시에 둘 수 있는 작업은 ${this.limits.maxQueuedJobsPerOwner}개입니다. 끝난 뒤 다시 시도하세요.`)
    const controller = new AbortController()
    const now = this.now()
    const info: JobInfo = { jobId: newToken('job'), operationId, kind, docId, status: 'queued', stage: '대기 중', createdAt: now }
    let release!: () => void
    const done = new Promise<void>((r) => (release = r))
    const job: Job = { info, owner: p.owner, controller, done, expiresAt: now + this.limits.operationTtlMs, release }
    job.start = () => {
      if (controller.signal.aborted) return this.finish(job, 'cancelled', undefined, cancelled(), release)
      this.running++
      info.status = 'running'
      info.stage = '계산 중'
      info.startedAt = this.now()
      this.deadlines.set(controller.signal, info.startedAt + this.limits.jobTimeoutMs)
      let timer: ReturnType<typeof setTimeout> | null = null
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // 먼저 TIMEOUT 으로 끝낸 뒤 실행기에 중단을 알린다 (순서가 바뀌면 CANCELLED 로 보인다)
          reject(new CommandError('TIMEOUT', `작업 시간 한도(${this.limits.jobTimeoutMs}ms)를 넘었습니다.`))
          controller.abort()
        }, this.limits.jobTimeoutMs)
      })
      const aborted = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(cancelled()), { once: true }))
      Promise.race([work(controller.signal), timeout, aborted])
        .then(
          (result) => this.finish(job, 'succeeded', result, undefined, release),
          (error) => {
            const e = toCommandError(error)
            this.finish(job, e.code === 'CANCELLED' ? 'cancelled' : 'failed', undefined, e, release)
          }
        )
        .finally(() => {
          if (timer) clearTimeout(timer)
          this.running--
          this.pump()
        })
    }
    this.jobs.set(info.jobId, job)
    this.queue.push(job)
    this.pump()
    return { ...info }
  }
  private pump(): void {
    while (this.running < this.limits.maxConcurrentJobs && this.queue.length) this.queue.shift()!.start!()
  }
  private finished(j: Job): boolean {
    return j.info.status === 'succeeded' || j.info.status === 'failed' || j.info.status === 'cancelled'
  }
  private finish(job: Job, status: JobStatus, result: JobResult | undefined, error: CommandError | undefined, release: () => void): void {
    if (this.finished(job)) return release()
    job.info.status = status
    job.info.stage = status === 'succeeded' ? '완료' : status === 'cancelled' ? '취소됨' : '실패'
    job.info.finishedAt = this.now()
    job.expiresAt = job.info.finishedAt + this.limits.operationTtlMs
    if (result) job.info.result = result
    if (error) job.info.error = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
    release()
  }

  // ── 작업 조회·취소 ──
  private job(p: Principal, jobId: string): Job {
    const j = this.jobs.get(jobId)
    if (!j || j.owner !== p.owner) throw notFound('작업')
    return j
  }
  getJob(p: Principal, raw: unknown): JobInfo {
    this.need(p, 'documents:read')
    const o = object(raw)
    onlyKeys(o, ['jobId'])
    return { ...this.job(p, id(o, 'jobId')).info }
  }
  /** 커밋 전이면 취소한다. 이미 끝난 작업은 그 상태를 그대로 돌려준다 */
  cancelJob(p: Principal, raw: unknown): JobInfo {
    this.need(p, 'documents:write')
    const o = object(raw)
    onlyKeys(o, ['jobId'])
    const j = this.job(p, id(o, 'jobId'))
    this.abortJob(j)
    return { ...j.info }
  }
  /** 커밋 전 작업을 끝낸다 — 대기 중이면 큐에서 빼고, 돌고 있으면 취소로 표시하고 실행기에 알린다 */
  private abortJob(j: Job): void {
    if (this.finished(j)) return
    j.controller.abort()
    if (j.info.status === 'queued') {
      this.queue = this.queue.filter((q) => q !== j)
      j.start!()
    } else this.finish(j, 'cancelled', undefined, cancelled(), j.release!)
  }
  /** 작업이 끝나거나 waitMs 가 지날 때까지 기다린 뒤 상태 */
  async waitJob(p: Principal, jobId: string, waitMs: number): Promise<JobInfo> {
    const j = this.job(p, jobId)
    if (!this.finished(j) && waitMs > 0) {
      let timer: ReturnType<typeof setTimeout> | null = null
      await Promise.race([j.done, new Promise<void>((r) => (timer = setTimeout(r, waitMs)))])
      if (timer) clearTimeout(timer)
    }
    return { ...j.info }
  }

  /** 만료 정리 — 문서·자산·끝난 작업·operationId. 호출마다 가볍게 돈다 (서버는 주기적으로도 부른다) */
  sweep(): { docs: number; assets: number; jobs: number } {
    const now = this.now()
    const docs = this.repo.sweep(now)
    for (const j of this.jobs.values()) if (docs.includes(j.info.docId)) this.abortJob(j)
    const assets = this.assets.sweep(now)
    let jobs = 0
    for (const [k, j] of this.jobs)
      if (this.finished(j) && j.expiresAt <= now) {
        this.jobs.delete(k)
        jobs++
      }
    for (const [k, op] of this.operations) if (op.expiresAt <= now && !this.jobs.has(op.jobId)) this.operations.delete(k)
    return { docs: docs.length, assets: assets.length, jobs }
  }

  /** 운영 지표 (소유자·문서 내용 없이 개수만) */
  stats(): { jobsRunning: number; jobsQueued: number; jobsKept: number } {
    return { jobsRunning: this.running, jobsQueued: this.queue.length, jobsKept: this.jobs.size }
  }

  /** 종료 — 돌던 작업을 취소하고 실행기를 닫는다 */
  async close(): Promise<void> {
    for (const j of this.jobs.values()) this.abortJob(j)
    await Promise.all([...this.jobs.values()].map((j) => j.done))
    await this.runner.close?.()
  }
}
