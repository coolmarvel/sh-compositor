/**
 * 서버 설정 — 전부 환경 변수. 숫자 한도는 실제 메모리 측정·예상 동시성으로 정해 여기서 바꾼다 (plans/0004 §6).
 * 비밀(토큰)은 로그·오류에 내보내지 않는다.
 */
import { readFileSync } from 'node:fs'
import { DEFAULT_LIMITS, type ServiceLimits, type Scope } from '../application/service'

export interface TokenEntry {
  owner: string
  token: string
  scopes: Scope[]
}

export interface ServerConfig {
  host: string
  port: number
  /** 결과 다운로드 링크의 바깥 주소 (프록시 뒤라면 그 주소) */
  publicUrl: string
  tokens: TokenEntry[]
  /** 브라우저에서 부를 수 있는 Origin (그 외 Origin 헤더가 붙은 요청은 거절). CORS 는 인증이 아니다 */
  allowedOrigins: string[]
  /** 선택: 토큰 발급자(OAuth 인가 서버) — 보호 자원 메타데이터에 알린다 */
  authorizationServers: string[]
  /** base64 인라인 업로드 한도 (stdio 처럼 HTTP 업로드를 못 쓰는 클라이언트용 — 작게) */
  maxInlineUploadBytes: number
  limits: ServiceLimits
  /** 작업 스레드 메모리 상한(MB, V8 힙) */
  workerHeapMb: number
}

const ALL: Scope[] = ['documents:read', 'documents:write']

/**
 * SHC_TOKENS="owner:token[:read|write|all]; owner2:token2" 또는 SHC_TOKENS_FILE=[{owner,token,scopes}] (JSON).
 * 토큰은 32자 이상만 받는다.
 */
export function parseTokens(env: NodeJS.ProcessEnv): TokenEntry[] {
  let list: TokenEntry[] = []
  if (env.SHC_TOKENS_FILE) list = JSON.parse(readFileSync(env.SHC_TOKENS_FILE, 'utf8')) as TokenEntry[]
  else if (env.SHC_TOKENS)
    list = env.SHC_TOKENS.split(/[;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        // owner:token[:scope] — 토큰에 ':' 가 있으면 scope 로 잘못 읽히므로 형식을 엄격히 본다
        const parts = s.split(':')
        if (parts.length < 2 || parts.length > 3) throw new Error('SHC_TOKENS: owner:token[:read|write|all] 형식이어야 합니다.')
        const [owner, token, scope = 'all'] = parts
        if (!['read', 'write', 'all'].includes(scope)) throw new Error(`SHC_TOKENS: ${owner} 의 scope 는 read·write·all 중 하나여야 합니다.`)
        const scopes: Scope[] = scope === 'read' ? ['documents:read'] : ALL
        return { owner, token, scopes }
      })
  for (const t of list) {
    if (!t.owner || !/^[A-Za-z0-9_.-]{1,64}$/.test(t.owner)) throw new Error('SHC_TOKENS: owner 는 영문·숫자·_.- 1~64자여야 합니다.')
    if (!t.token || t.token.length < 32) throw new Error(`SHC_TOKENS: ${t.owner} 의 토큰이 너무 짧습니다 (32자 이상).`)
    if (!t.scopes?.length || t.scopes.some((s) => !ALL.includes(s))) throw new Error(`SHC_TOKENS: ${t.owner} 의 scope 가 올바르지 않습니다.`)
  }
  return list
}

const num = (v: string | undefined, fallback: number): number => {
  if (v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`설정값이 숫자가 아닙니다: ${v}`)
  return n
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = env.SHC_HOST ?? '127.0.0.1'
  const port = num(env.SHC_PORT, 8787)
  const min = 60_000
  return {
    host,
    port,
    publicUrl: (env.SHC_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/+$/, ''),
    tokens: parseTokens(env),
    allowedOrigins: (env.SHC_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    authorizationServers: (env.SHC_AUTH_SERVERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxInlineUploadBytes: num(env.SHC_MAX_INLINE_UPLOAD_KB, 4096) * 1024,
    workerHeapMb: num(env.SHC_WORKER_HEAP_MB, 512),
    limits: {
      ...DEFAULT_LIMITS,
      maxUploadBytes: num(env.SHC_MAX_UPLOAD_MB, DEFAULT_LIMITS.maxUploadBytes / 1024 / 1024) * 1024 * 1024,
      maxPixels: num(env.SHC_MAX_PIXELS, DEFAULT_LIMITS.maxPixels),
      maxLayers: num(env.SHC_MAX_LAYERS, DEFAULT_LIMITS.maxLayers),
      maxDocsPerOwner: num(env.SHC_MAX_DOCS, DEFAULT_LIMITS.maxDocsPerOwner),
      maxAssetBytesPerOwner: num(env.SHC_MAX_ASSET_MB, DEFAULT_LIMITS.maxAssetBytesPerOwner / 1024 / 1024) * 1024 * 1024,
      maxConcurrentJobs: num(env.SHC_MAX_CONCURRENT_JOBS, DEFAULT_LIMITS.maxConcurrentJobs),
      maxQueuedJobsPerOwner: num(env.SHC_MAX_QUEUED_JOBS, DEFAULT_LIMITS.maxQueuedJobsPerOwner),
      jobTimeoutMs: num(env.SHC_JOB_TIMEOUT_MS, DEFAULT_LIMITS.jobTimeoutMs),
      docTtlMs: num(env.SHC_DOC_TTL_MIN, DEFAULT_LIMITS.docTtlMs / min) * min,
      assetTtlMs: num(env.SHC_ASSET_TTL_MIN, DEFAULT_LIMITS.assetTtlMs / min) * min,
      operationTtlMs: num(env.SHC_OPERATION_TTL_MIN, DEFAULT_LIMITS.operationTtlMs / min) * min,
      historyLimit: num(env.SHC_HISTORY_LIMIT, DEFAULT_LIMITS.historyLimit),
      historyBudgetBytes: num(env.SHC_HISTORY_BUDGET_MB, DEFAULT_LIMITS.historyBudgetBytes / 1024 / 1024) * 1024 * 1024
    }
  }
}
