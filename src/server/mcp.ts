/**
 * MCP 어댑터 — 도구 호출을 application 서비스로. HTTP API 를 다시 부르지 않고 같은 서비스를 직접 쓴다 (plans/0004 §2).
 *
 *  - 호출자(Principal)는 전송 계층의 인증 정보(`extra.authInfo`)에서만 얻는다. stdio 는 서버를 띄운 사용자 한 명.
 *  - 입력 스키마(zod → JSON Schema)는 클라이언트 안내용이고, 실제 검증은 application 이 다시 한다.
 *  - 도구 실행 오류는 `isError` 결과(코드·문구·고칠 정보)로, 프로토콜 오류는 SDK 가 JSON-RPC 오류로 낸다.
 *  - 변경 도구는 작업을 시작하고 waitMs 만큼 기다린다. 그 안에 안 끝나면 작업 상태를 돌려주고 compositor_job_get 으로 이어 본다.
 *  - 이미지 원문은 도구 인자로 주고받지 않는다: 업로드는 HTTP `POST /v1/assets`, 결과는 resource_link(+다운로드 URL).
 *    HTTP 를 못 쓰는 stdio 클라이언트만 작은 base64 업로드(`compositor_asset_upload_base64`, 한도 있음)를 쓸 수 있다.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { z } from 'zod'
import { BLEND_MODES } from '../core/doc/types'
import { MAX_SIDE } from '../core/limits'
import { FILTER_KINDS, type CommandName } from '../application/commands'
import { CommandError, toCommandError } from '../application/errors'
import type { DocumentService, JobInfo, Principal, Scope } from '../application/service'

/** 버전은 build-server 가 package.json 에서 넣는다 */
export const SERVER_INFO = { name: 'sh-compositor', version: process.env.SHC_VERSION ?? 'dev' }

export interface McpOptions {
  service: DocumentService
  /** 결과 다운로드 링크의 바깥 주소 (없으면 resource_link 만) */
  publicUrl?: string
  /** stdio 처럼 전송에 인증이 없을 때의 호출자 */
  localPrincipal?: Principal
  maxInlineUploadBytes: number
  /** 도구 호출 기록 (요청·작업·문서 ID·코드·시간만. 인자·이미지·토큰은 남기지 않는다) */
  log?: (entry: Record<string, unknown>) => void
}

const ID = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/)
  .describe('ID (영문·숫자·_.:-, 128자 이하)')
const docId = ID.describe('문서 ID (compositor_document_create/import 가 준 docId)')
const expectedRevision = z.number().int().min(1).describe('지금 알고 있는 문서 revision — 다르면 REVISION_CONFLICT (compositor_document_get 으로 다시 조회)')
const operationId = ID.describe('이 변경의 고유 ID. 응답이 끊겨 다시 부를 때 같은 값을 쓰면 같은 결과를 돌려준다 (중복 실행 없음)')
const waitMs = z.number().int().min(0).max(30_000).optional().describe('끝날 때까지 기다릴 시간(ms, 기본 10000). 안 끝나면 작업 상태를 돌려준다')
const mutation = { docId, expectedRevision, operationId, waitMs }

const JOB_OUT = z.looseObject({ jobId: z.string(), status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']), docId: z.string() })
const DOC_OUT = z.looseObject({ docId: z.string(), revision: z.number(), width: z.number(), height: z.number() })

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }

type Extra = { authInfo?: AuthInfo; requestId?: string | number }
type ToolResult = {
  content: ({ type: 'text'; text: string } | { type: 'resource_link'; uri: string; name: string; mimeType?: string; description?: string })[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export function principalFromAuth(auth: AuthInfo | undefined, local?: Principal): Principal {
  if (auth) return { owner: auth.clientId, scopes: auth.scopes.filter((s): s is Scope => s === 'documents:read' || s === 'documents:write') }
  if (local) return local
  throw new CommandError('FORBIDDEN', '인증 정보가 없습니다.')
}

export function createMcpServer(o: McpOptions): McpServer {
  const { service } = o
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {} },
    instructions: [
      'SH Compositor 문서를 서버에서 편집합니다. 먼저 compositor_capabilities 로 지원 형식·한도를 확인하세요.',
      '흐름: compositor_document_create 또는 (PNG 업로드 → compositor_document_import) → 편집 도구 → compositor_export → 결과 링크 내려받기.',
      '모든 변경은 docId·expectedRevision·operationId 가 필요합니다. REVISION_CONFLICT 면 compositor_document_get 으로 revision 을 다시 읽고 새 operationId 로 시도하세요.',
      '응답이 끊겼으면 같은 operationId 로 다시 부르면 같은 결과를 받습니다. 좌표·크기는 문서 픽셀(왼쪽 위 원점), 레이어 목록은 아래 → 위 순서입니다.'
    ].join('\n')
  })

  const run =
    (tool: string, fn: (p: Principal) => Promise<unknown> | unknown, links?: (data: unknown) => ToolResult['content']) =>
    async (_args: unknown, extra: Extra): Promise<ToolResult> => {
      const started = Date.now()
      let owner: string | undefined
      try {
        const p = principalFromAuth(extra.authInfo, o.localPrincipal)
        owner = p.owner
        const data = (await fn(p)) as Record<string, unknown>
        const job = data as Partial<JobInfo>
        o.log?.({ tool, owner, requestId: extra.requestId, docId: job.docId, jobId: job.jobId, status: job.status, code: job.error?.code, ms: Date.now() - started })
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }, ...(links?.(data) ?? [])], structuredContent: data }
      } catch (error) {
        const e = toCommandError(error)
        o.log?.({ tool, owner, requestId: extra.requestId, code: e.code, ms: Date.now() - started })
        const body = { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }
        // structuredContent 는 outputSchema 를 따라야 하므로 오류는 text 로만 (클라이언트가 스키마로 검사한다)
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] }
      }
    }
  const settle = (p: Principal, job: JobInfo, wait: number | undefined): Promise<JobInfo> => service.waitJob(p, job.jobId, wait ?? 10_000)
  /** 결과 자산이 있으면 resource_link (+ HTTP 다운로드 주소) */
  const artifactLinks = (data: unknown): ToolResult['content'] => {
    const a = (data as JobInfo).result?.artifact
    if (!a) return []
    return [
      {
        type: 'resource_link',
        uri: `compositor://assets/${a.id}`,
        name: a.name,
        mimeType: a.mediaType,
        description: o.publicUrl ? `다운로드: GET ${o.publicUrl}/v1/assets/${a.id} (같은 Bearer 토큰)` : '리소스로 읽기 (resources/read)'
      }
    ]
  }
  const withDownload = (job: JobInfo): JobInfo & { downloadUrl?: string } => (job.result?.artifact && o.publicUrl ? { ...job, downloadUrl: `${o.publicUrl}/v1/assets/${job.result.artifact.id}` } : job)
  const command = (name: CommandName, args: Record<string, unknown>) => async (p: Principal) => {
    const { waitMs: w, ...rest } = args
    return settle(p, service.startCommand(p, name, rest), w as number | undefined)
  }

  server.registerTool('compositor_capabilities', { title: '지원 기능', description: '지원 명령·가져오기/내보내기 형식·크기와 보관 한도를 알려 줍니다.', annotations: READ }, (extra) =>
    run('compositor_capabilities', () => service.capabilities())(undefined, extra)
  )

  server.registerTool(
    'compositor_document_create',
    {
      title: '빈 문서 만들기',
      description: '크기가 제한된 빈 문서를 만듭니다. 배경 레이어 하나가 생깁니다.',
      inputSchema: {
        width: z.number().int().min(1).max(MAX_SIDE),
        height: z.number().int().min(1).max(MAX_SIDE),
        background: z
          .union([z.enum(['white', 'black', 'transparent']), z.string().regex(/^#[0-9a-fA-F]{6}$/)])
          .optional()
          .describe('배경색 (기본 white)'),
        resolution: z.number().min(1).max(10000).optional().describe('DPI (기본 72)'),
        name: z.string().max(255).optional()
      },
      outputSchema: DOC_OUT,
      annotations: { ...WRITE, idempotentHint: false }
    },
    (args, extra) => run('compositor_document_create', (p) => service.createDocument(p, args))(args, extra)
  )

  server.registerTool(
    'compositor_asset_upload_base64',
    {
      title: '작은 PNG 올리기 (base64)',
      description: `HTTP 업로드(POST /v1/assets)를 쓸 수 없을 때만 — ${Math.round(o.maxInlineUploadBytes / 1024)}KB 이하 PNG. 돌려준 assetId 로 compositor_document_import 를 부릅니다.`,
      inputSchema: { dataBase64: z.string().max(Math.ceil((o.maxInlineUploadBytes * 4) / 3) + 4), name: z.string().max(255).optional() },
      annotations: { ...WRITE, idempotentHint: false }
    },
    (args, extra) =>
      run('compositor_asset_upload_base64', (p) => {
        const bytes = new Uint8Array(Buffer.from(args.dataBase64, 'base64'))
        if (bytes.byteLength > o.maxInlineUploadBytes) throw new CommandError('RESOURCE_LIMIT', `base64 업로드는 ${o.maxInlineUploadBytes}바이트까지입니다. HTTP 업로드를 쓰세요.`)
        return service.uploadAsset(p, bytes, { name: args.name ?? 'upload.png' })
      })(args, extra)
  )

  server.registerTool(
    'compositor_document_import',
    {
      title: '업로드한 이미지로 문서 만들기',
      description: '업로드한 assetId(지금은 PNG)로 새 문서를 만듭니다.',
      inputSchema: { assetId: ID, name: z.string().max(255).optional() },
      outputSchema: DOC_OUT,
      annotations: { ...WRITE, idempotentHint: false }
    },
    (args, extra) => run('compositor_document_import', (p) => service.importDocument(p, args))(args, extra)
  )

  server.registerTool(
    'compositor_document_get',
    { title: '문서 정보', description: 'revision·크기·레이어 수·실행취소 가능 여부를 봅니다.', inputSchema: { docId }, outputSchema: DOC_OUT, annotations: READ },
    (args, extra) => run('compositor_document_get', (p) => service.getDocument(p, args))(args, extra)
  )

  server.registerTool(
    'compositor_document_delete',
    { title: '문서 지우기', description: '문서와 진행 중인 작업을 지웁니다. 되돌릴 수 없습니다.', inputSchema: { docId }, annotations: { ...WRITE, destructiveHint: true } },
    (args, extra) => run('compositor_document_delete', (p) => service.deleteDocument(p, args))(args, extra)
  )

  server.registerTool(
    'compositor_layer_list',
    { title: '레이어 목록', description: '레이어 ID·종류·표시·불투명도·혼합·위치·크기. 배열은 아래 → 위 순서입니다.', inputSchema: { docId }, annotations: READ },
    (args, extra) => run('compositor_layer_list', (p) => service.listLayers(p, args))(args, extra)
  )

  server.registerTool(
    'compositor_layer_update',
    {
      title: '레이어 속성 바꾸기',
      description: '이름·표시·불투명도(0~1)·혼합 모드·클리핑·위치(x, y 문서 px)·잠금 중 준 것만 바꿉니다. 한 번 = 실행취소 한 단계.',
      inputSchema: {
        ...mutation,
        layerId: ID,
        name: z.string().min(1).max(255).optional(),
        visible: z.boolean().optional(),
        opacity: z.number().min(0).max(1).optional(),
        blend: z.enum(BLEND_MODES.map((b) => b.key) as [string, ...string[]]).optional(),
        clip: z.boolean().optional(),
        x: z.number().min(-MAX_SIDE).max(MAX_SIDE).optional(),
        y: z.number().min(-MAX_SIDE).max(MAX_SIDE).optional(),
        lock: z.object({ alpha: z.boolean().optional(), pixels: z.boolean().optional(), position: z.boolean().optional() }).strict().optional()
      },
      outputSchema: JOB_OUT,
      annotations: WRITE
    },
    (args, extra) => run('compositor_layer_update', command('layer.update', args))(args, extra)
  )

  server.registerTool(
    'compositor_image_resize',
    {
      title: '이미지 크기 바꾸기',
      description: '문서 전체를 width×height 로 (레이어 변형을 비율대로, 양선형). resolution 을 주면 DPI 도 바꿉니다.',
      inputSchema: {
        ...mutation,
        width: z.number().int().min(1).max(MAX_SIDE),
        height: z.number().int().min(1).max(MAX_SIDE),
        resolution: z.number().min(1).max(10000).optional(),
        resampling: z.enum(['bilinear']).optional()
      },
      outputSchema: JOB_OUT,
      annotations: WRITE
    },
    (args, extra) => run('compositor_image_resize', command('image.resize', args))(args, extra)
  )

  server.registerTool(
    'compositor_image_crop',
    {
      title: '자르기',
      description: '문서 안의 사각형(x, y, width, height — 문서 px)으로 자릅니다. deleteCropped 면 캔버스 밖 픽셀을 버립니다.',
      inputSchema: {
        ...mutation,
        x: z.number().int().min(0).max(MAX_SIDE),
        y: z.number().int().min(0).max(MAX_SIDE),
        width: z.number().int().min(1).max(MAX_SIDE),
        height: z.number().int().min(1).max(MAX_SIDE),
        deleteCropped: z.boolean().optional()
      },
      outputSchema: JOB_OUT,
      annotations: WRITE
    },
    (args, extra) => run('compositor_image_crop', command('image.crop', args))(args, extra)
  )

  server.registerTool(
    'compositor_filter_apply',
    {
      title: '필터 적용',
      description: [
        '픽셀 레이어 하나에 필터를 겁니다. params 는 필터마다 다릅니다:',
        'gaussianBlur{radius 0.5~100} · motionBlur{distance 1~200, angle -180~180} · addNoise{amount 1~100, gaussian?, mono?} (seed 로 재현)',
        'lensCorrection{amount -100~100, 0 제외} · unsharpMask{amount 1~500, radius 0.3~20, threshold 0~255} · highPass{radius 0.5~50} · mosaic{cellSize 2~100} · median{radius 1~10}'
      ].join('\n'),
      inputSchema: {
        ...mutation,
        layerId: ID,
        filter: z.enum(FILTER_KINDS),
        params: z.record(z.string(), z.union([z.number(), z.boolean()])).optional(),
        seed: z.number().int().min(0).max(0xffffffff).optional()
      },
      outputSchema: JOB_OUT,
      annotations: WRITE
    },
    (args, extra) => run('compositor_filter_apply', command('filter.apply', args))(args, extra)
  )

  for (const which of ['undo', 'redo'] as const)
    server.registerTool(
      `compositor_document_${which}`,
      {
        title: which === 'undo' ? '실행 취소' : '다시 실행',
        description: `${which === 'undo' ? '마지막 변경을 되돌립니다' : '되돌린 변경을 다시 적용합니다'}. 이것도 revision 을 올리는 변경입니다.`,
        inputSchema: mutation,
        outputSchema: JOB_OUT,
        annotations: WRITE
      },
      (args, extra) =>
        run(`compositor_document_${which}`, async (p) => {
          const { waitMs: w, ...rest } = args
          return settle(p, service.startHistoryStep(p, which, rest), w)
        })(args, extra)
    )

  server.registerTool(
    'compositor_export',
    {
      title: '내보내기',
      description: '지정 revision(생략 = 현재)을 PNG(합성) 또는 .shcomp(레이어 유지)로 만듭니다. 결과는 resource_link 와 downloadUrl 로 받습니다. 결과 파일은 보관 기간이 지나면 지워집니다.',
      inputSchema: {
        docId,
        format: z.enum(['png', 'shcomp']),
        revision: z.number().int().min(1).optional(),
        operationId: operationId.optional(),
        waitMs
      },
      outputSchema: JOB_OUT,
      annotations: { ...READ, idempotentHint: true }
    },
    (args, extra) =>
      run(
        'compositor_export',
        async (p) => {
          const { waitMs: w, ...rest } = args
          return withDownload(await settle(p, service.startExport(p, rest), w))
        },
        artifactLinks
      )(args, extra)
  )

  server.registerTool(
    'compositor_job_get',
    {
      title: '작업 상태',
      description: 'queued/running/succeeded/failed/cancelled 와 결과·오류. waitMs 를 주면 끝날 때까지 그만큼 기다립니다.',
      inputSchema: { jobId: ID, waitMs },
      outputSchema: JOB_OUT,
      annotations: READ
    },
    (args, extra) =>
      run(
        'compositor_job_get',
        async (p) => {
          service.getJob(p, { jobId: args.jobId })
          return withDownload(await service.waitJob(p, args.jobId, args.waitMs ?? 0))
        },
        artifactLinks
      )(args, extra)
  )

  server.registerTool(
    'compositor_job_cancel',
    {
      title: '작업 취소',
      description: '커밋 전이면 취소합니다. 이미 끝난 작업은 그 상태를 그대로 돌려줍니다.',
      inputSchema: { jobId: ID },
      outputSchema: JOB_OUT,
      annotations: { ...WRITE, destructiveHint: false }
    },
    (args, extra) => run('compositor_job_cancel', (p) => service.cancelJob(p, args))(args, extra)
  )

  // 결과 파일 읽기 (stdio 클라이언트용 — HTTP 는 /v1/assets 로 내려받는 편이 가볍다)
  server.registerResource(
    'asset',
    new ResourceTemplate('compositor://assets/{assetId}', { list: undefined }),
    { title: '업로드·결과 파일', description: '자신이 올리거나 내보낸 파일 (보관 기간 안에서만)' },
    async (uri, vars, extra) => {
      const p = principalFromAuth((extra as Extra).authInfo, o.localPrincipal)
      const a = service.readAsset(p, String(vars.assetId))
      return { contents: [{ uri: uri.href, mimeType: a.mediaType, blob: Buffer.from(a.bytes).toString('base64') }] }
    }
  )
  return server
}
