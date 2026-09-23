/**
 * HTTP 서버 — 업로드·다운로드(자산)와 원격 MCP(Streamable HTTP, `/mcp`). 브라우저를 띄우지 않는다.
 *
 *  POST /v1/assets        PNG 원문 업로드 (Content-Type: image/png, 선택 X-Filename) → AssetInfo
 *  GET  /v1/assets/:id    자신의 업로드·결과 파일 내려받기
 *  POST|GET|DELETE /mcp   MCP (stateless — 요청마다 서버·전송을 새로 만든다. 문서 수명은 MCP 세션과 무관)
 *  GET  /healthz          상태
 *  GET  /.well-known/oauth-protected-resource   보호 자원 메타데이터 (RFC 9728, MCP authorization)
 *
 * 인증은 모든 /v1·/mcp 에 Bearer 토큰. Origin 헤더가 붙은 요청은 허용 목록에 있을 때만 (DNS rebinding·다른 사이트의 호출 방지).
 * 로그: 요청 ID·경로·상태·시간·owner·오류 코드만 (본문·이미지·토큰은 남기지 않는다).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { DocumentService, Principal } from '../application/service'
import { toCommandError, CommandError, type ErrorCode } from '../application/errors'
import type { ServerConfig } from './config'
import { TokenAuth } from './auth'
import { createMcpServer } from './mcp'

const STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  REVISION_CONFLICT: 409,
  RESOURCE_LIMIT: 413,
  CANCELLED: 409,
  TIMEOUT: 504,
  UNSUPPORTED_CAPABILITY: 415,
  INTERNAL: 500
}
/** MCP JSON 본문 상한 (이미지는 /v1/assets 로 — 도구 인자는 작다) */
const MAX_MCP_BODY = 8 * 1024 * 1024

export type Logger = (entry: Record<string, unknown>) => void
export const jsonLogger: Logger = (entry) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(text)
}
function sendError(res: ServerResponse, error: unknown, headers: Record<string, string> = {}): string {
  const e = toCommandError(error)
  send(res, STATUS[e.code], { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, headers)
  return e.code
}

/** 본문 읽기 — 상한을 넘으면 즉시 멈춘다 */
function readBody(req: IncomingMessage, max: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > max) return reject(new CommandError('RESOURCE_LIMIT', `본문이 너무 큽니다 (한도 ${max.toLocaleString()}바이트).`, { max }))
    const parts: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        // 소켓을 바로 끊으면 413 을 보내지 못한다 — 읽기를 멈추고 응답 뒤 연결을 닫는다
        req.removeAllListeners('data')
        req.pause()
        reject(new CommandError('RESOURCE_LIMIT', `본문이 너무 큽니다 (한도 ${max.toLocaleString()}바이트).`, { max }))
        return
      }
      parts.push(c)
    })
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts))))
    req.on('error', reject)
  })
}

export interface HttpApp {
  server: Server
  listen(): Promise<{ port: number }>
  close(): Promise<void>
}

export function createHttpApp(config: ServerConfig, service: DocumentService, log: Logger = jsonLogger, extraStats: () => Record<string, number> = () => ({})): HttpApp {
  const auth = new TokenAuth(config.tokens)
  if (!auth.configured) throw new Error('SHC_TOKENS(또는 SHC_TOKENS_FILE)가 없습니다. 원격 서버는 인증 없이 띄우지 않습니다.')
  const metadataUrl = `${config.publicUrl}/.well-known/oauth-protected-resource`
  const challenge = { 'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"` }

  const server = createServer((req, res) => {
    const requestId = randomUUID()
    const started = Date.now()
    let owner: string | undefined
    let code: string | undefined
    res.setHeader('X-Request-Id', requestId)
    res.on('finish', () => log({ requestId, method: req.method, path: (req.url ?? '').split('?')[0], status: res.statusCode, ms: Date.now() - started, owner, code }))
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://local')
      const origin = req.headers.origin
      if (origin && !config.allowedOrigins.includes(origin)) {
        code = 'FORBIDDEN'
        return send(res, 403, { error: { code: 'FORBIDDEN', message: '허용하지 않은 Origin 입니다.' } })
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, X-Request-Id, WWW-Authenticate')
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Filename, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
          'Access-Control-Max-Age': '600'
        })
        return res.end()
      }
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, ...service.stats(), ...extraStats() })
      if (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')
        return send(res, 200, {
          resource: `${config.publicUrl}/mcp`,
          authorization_servers: config.authorizationServers,
          scopes_supported: ['documents:read', 'documents:write'],
          bearer_methods_supported: ['header']
        })

      const principal: Principal | null = auth.verify(req.headers.authorization)
      if (!principal) {
        code = 'UNAUTHORIZED'
        return send(res, 401, { error: { code: 'UNAUTHORIZED', message: '유효한 Bearer 토큰이 필요합니다.' } }, challenge)
      }
      owner = principal.owner

      if (url.pathname === '/v1/assets' && req.method === 'POST') {
        const type = (req.headers['content-type'] ?? '').split(';')[0].trim()
        if (type !== 'image/png') throw new CommandError('UNSUPPORTED_CAPABILITY', '지금은 image/png 만 올릴 수 있습니다.')
        const bytes = await readBody(req, service.limits.maxUploadBytes)
        let name = String(req.headers['x-filename'] ?? 'upload.png')
        try {
          name = decodeURIComponent(name)
        } catch {
          /* 잘못된 퍼센트 인코딩 — 원문 그대로 (service 가 위험 문자를 바꾼다) */
        }
        return send(res, 201, service.uploadAsset(principal, bytes, { name }))
      }
      const asset = /^\/v1\/assets\/([A-Za-z0-9_.:-]{1,128})$/.exec(url.pathname)
      if (asset && req.method === 'GET') {
        const a = service.readAsset(principal, asset[1])
        res.writeHead(200, {
          'Content-Type': a.mediaType,
          'Content-Length': String(a.bytes.byteLength),
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        })
        return res.end(Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength))
      }
      if (url.pathname === '/mcp') {
        if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') return send(res, 405, { error: { code: 'INVALID_INPUT', message: '지원하지 않는 메서드입니다.' } })
        let body: unknown
        if (req.method === 'POST') {
          const raw = await readBody(req, MAX_MCP_BODY)
          try {
            body = JSON.parse(Buffer.from(raw).toString('utf8'))
          } catch {
            return send(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null })
          }
        }
        const mcp = createMcpServer({ service, publicUrl: config.publicUrl, maxInlineUploadBytes: config.maxInlineUploadBytes, log: (e) => log({ requestId, ...e }) })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        res.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        const authed = Object.assign(req, { auth: { token: 'redacted', clientId: principal.owner, scopes: [...principal.scopes] } })
        await transport.handleRequest(authed, res, body)
        return
      }
      code = 'NOT_FOUND'
      send(res, 404, { error: { code: 'NOT_FOUND', message: '없는 경로입니다.' } })
    })().catch((error) => {
      if (res.headersSent) {
        res.destroy()
        return
      }
      // 본문을 다 읽지 않고 끝낸 요청은 연결을 닫는다 (남은 업로드를 버린다)
      if (!req.complete) {
        res.setHeader('Connection', 'close')
        res.once('finish', () => req.destroy())
      }
      code = sendError(res, error)
    })
  })

  // 만료 정리 — 요청이 없어도 돈다
  const sweeper = setInterval(() => service.sweep(), 60_000)
  sweeper.unref()

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.port, config.host, () => {
          const addr = server.address()
          resolve({ port: typeof addr === 'object' && addr ? addr.port : config.port })
        })
      }),
    close: async () => {
      clearInterval(sweeper)
      const closed = new Promise<void>((r) => server.close(() => r()))
      server.closeAllConnections()
      await closed
      await service.close()
    }
  }
}
