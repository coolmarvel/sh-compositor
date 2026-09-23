/**
 * SH Compositor headless 서버 진입점 (plans/0004 4~5단계). 브라우저·Electron 없이 문서를 편집한다.
 *
 *   node out/server/index.mjs            HTTP (업로드·다운로드 + 원격 MCP /mcp). SHC_TOKENS 필수
 *   node out/server/index.mjs --stdio    로컬 MCP (stdio). 서버를 띄운 사용자 한 명(SHC_STDIO_OWNER, 기본 local)
 *
 * 문서·자산은 메모리에만 있다 (프로세스를 끝내면 사라진다 — 보관 기간은 capabilities 의 retention).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DocumentService } from '../application/service'
import { loadConfig } from './config'
import { WorkerThreadRunner } from './workerRunner'
import { createHttpApp, jsonLogger } from './http'
import { createMcpServer } from './mcp'

async function main(): Promise<void> {
  const config = loadConfig()
  const runner = new WorkerThreadRunner(new URL('./taskWorker.mjs', import.meta.url), config.workerHeapMb)
  const service = new DocumentService({ runner, limits: config.limits })
  const stop = async (app?: { close(): Promise<void> }): Promise<void> => {
    await (app ? app.close() : service.close())
    process.exit(0)
  }
  if (process.argv.includes('--stdio')) {
    const owner = process.env.SHC_STDIO_OWNER ?? 'local'
    const mcp = createMcpServer({ service, localPrincipal: { owner, scopes: ['documents:read', 'documents:write'] }, maxInlineUploadBytes: config.maxInlineUploadBytes, log: jsonLogger })
    const sweeper = setInterval(() => service.sweep(), 60_000)
    sweeper.unref()
    await mcp.connect(new StdioServerTransport())
    // stdout 은 프로토콜 전용 — 안내는 stderr 로
    jsonLogger({ event: 'ready', transport: 'stdio', owner })
    process.stdin.on('end', () => void stop())
    process.on('SIGINT', () => void stop())
    process.on('SIGTERM', () => void stop())
    return
  }
  const app = createHttpApp(config, service, jsonLogger, () => ({ workerThreads: runner.active }))
  const { port } = await app.listen()
  jsonLogger({ event: 'ready', transport: 'http', host: config.host, port, mcp: `${config.publicUrl}/mcp`, owners: config.tokens.map((t) => t.owner) })
  process.on('SIGINT', () => void stop(app))
  process.on('SIGTERM', () => void stop(app))
}

main().catch((e) => {
  jsonLogger({ event: 'fatal', message: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})
