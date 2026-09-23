/**
 * MCP 어댑터 — 도구 호출을 application 서비스로. HTTP API 를 다시 부르지 않고 같은 서비스를 직접 쓴다 (plans/0004 §2).
 *
 *  - 호출자(Principal)는 전송 계층의 인증 정보(`extra.authInfo`)에서만 얻는다. stdio 는 서버를 띄운 사용자 한 명.
 *  - 도구 이름·제목·설명은 `application/catalog.ts`(사용 설명서와 공유), 매개변수 스키마(zod → JSON Schema)는 여기.
 *    스키마는 클라이언트 안내용이고 실제 검증은 application 이 다시 한다.
 *  - 도구 실행 오류는 `isError` 결과(코드·문구·고칠 정보)로, 프로토콜 오류는 SDK 가 JSON-RPC 오류로 낸다.
 *  - 변경 도구는 작업을 시작하고 waitMs 만큼 기다린다. 그 안에 안 끝나면 작업 상태를 돌려주고 compositor_job_get 으로 이어 본다.
 *  - 이미지 원문은 도구 인자로 주고받지 않는다: 업로드는 HTTP `POST /v1/assets`, 결과는 resource_link(+다운로드 URL).
 *    HTTP 를 못 쓰는 stdio 클라이언트만 작은 base64 업로드(`compositor_asset_upload_base64`, 한도 있음)를 쓸 수 있다.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { z, type ZodRawShape } from 'zod'
import { BLEND_MODES, ADJUSTMENT_KINDS } from '../core/doc/types'
import { ANCHORS } from '../core/canvassize'
import { MAX_SIDE } from '../core/limits'
import { FILTER_KINDS, MORE_KINDS } from '../application/commands/index'
import { TOOL_CATALOG, type ToolDoc } from '../application/catalog'
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

// ── 공통 스키마 조각 ──
const ID = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/)
const docId = ID.describe('문서 ID (compositor_document_create/import 가 준 docId)')
const layerId = ID.describe('레이어 ID (compositor_layer_list)')
const expectedRevision = z.number().int().min(1).describe('지금 알고 있는 문서 revision — 다르면 REVISION_CONFLICT (compositor_document_get 으로 다시 조회)')
const operationId = ID.describe('이 변경의 고유 ID. 응답이 끊겨 다시 부를 때 같은 값을 쓰면 같은 결과를 돌려준다 (중복 실행 없음)')
const waitMs = z.number().int().min(0).max(30_000).optional().describe('끝날 때까지 기다릴 시간(ms, 기본 10000). 안 끝나면 작업 상태를 돌려준다')
const mutation = { docId, expectedRevision, operationId, waitMs }
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .describe('#rrggbb')
const px = z.number().min(-MAX_SIDE).max(MAX_SIDE)
const size = z.number().int().min(1).max(MAX_SIDE)
const pt = z.object({ x: z.number(), y: z.number() })
const ptP = z.object({ x: z.number(), y: z.number(), pressure: z.number().min(0).max(1).optional() })
const pts = z.array(pt).min(1).max(5000).describe('문서 px 점 목록 — 한 획')
const ptsP = z.array(ptP).min(1).max(5000).describe('문서 px 점 목록 — 한 획 (pressure 0~1 선택)')
const brush = z
  .object({
    size: z.number().min(1).max(5000).optional(),
    hardness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    pressureSize: z.boolean().optional(),
    pressureOpacity: z.boolean().optional()
  })
  .strict()
  .optional()
  .describe('붓 (기본 30px·경도 0.8·불투명도 1)')
const target = z.enum(['layer', 'mask']).optional().describe('레이어 픽셀(기본) 또는 그 마스크')
const ids = z.array(ID).min(1).max(256)
const blendKeys = BLEND_MODES.map((b) => b.key) as [string, ...string[]]
const curve = z
  .array(z.object({ x: z.number().min(0).max(255), y: z.number().min(0).max(255) }))
  .min(2)
  .max(32)
  .optional()
  .describe('커브 제어점, x 오름차순 (기본 직선)')
const tone = z
  .object({
    inBlack: z.number().int().min(0).max(254).optional(),
    inWhite: z.number().int().min(1).max(255).optional(),
    midtone: z.number().min(0.1).max(9.99).optional(),
    outBlack: z.number().int().min(0).max(255).optional(),
    outWhite: z.number().int().min(0).max(255).optional(),
    curve
  })
  .strict()
const rangeAdj = z.object({ hue: z.number().min(-180).max(180).optional(), saturation: z.number().min(-100).max(100).optional(), lightness: z.number().min(-100).max(100).optional() }).strict()
const adjustment = z
  .object({
    exposure: z.number().min(-5).max(5).optional(),
    offset: z.number().min(-0.5).max(0.5).optional(),
    gamma: z.number().min(0.1).max(3).optional(),
    inBlack: z.number().int().min(0).max(254).optional(),
    inWhite: z.number().int().min(1).max(255).optional(),
    midtone: z.number().min(0.1).max(9.99).optional(),
    outBlack: z.number().int().min(0).max(255).optional(),
    outWhite: z.number().int().min(0).max(255).optional(),
    curve,
    hue: z.number().min(-180).max(180).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    lightness: z.number().min(-100).max(100).optional(),
    grain: z.number().min(0).max(100).optional(),
    invert: z.boolean().optional(),
    colorize: z.boolean().optional(),
    gradientMap: z.object({ shadows: color, highlights: color, reversed: z.boolean().optional() }).strict().nullable().optional(),
    channels: z.object({ r: tone.optional(), g: tone.optional(), b: tone.optional() }).strict().optional(),
    hueRanges: z
      .object({ reds: rangeAdj.optional(), yellows: rangeAdj.optional(), greens: rangeAdj.optional(), cyans: rangeAdj.optional(), blues: rangeAdj.optional(), magentas: rangeAdj.optional() })
      .strict()
      .optional()
  })
  .strict()
const effectPart = <T extends ZodRawShape>(shape: T) =>
  z
    .object({ enabled: z.boolean().optional(), color: color.optional(), opacity: z.number().min(0).max(1).optional(), ...shape })
    .strict()
    .optional()
const shadowPart = effectPart({ angle: z.number().min(-360).max(360).optional(), distance: z.number().min(0).max(500).optional(), blur: z.number().min(0).max(500).optional() })
const effects = z
  .object({
    stroke: effectPart({ size: z.number().min(0).max(200).optional(), inside: z.boolean().optional() }),
    shadow: shadowPart,
    innerShadow: shadowPart,
    overlay: effectPart({}),
    outerGlow: effectPart({ size: z.number().min(0).max(500).optional(), spread: z.number().min(0).max(100).optional() })
  })
  .strict()
  .optional()
  .describe('레이어 효과 — 준 항목만 바꾼다')
const bwPart = z.number().min(-200).max(300).optional()
const cbPart = z.array(z.number().min(-100).max(100)).length(3).optional()

/** 변경 도구의 매개변수 (공통 docId·expectedRevision·operationId·waitMs 는 자동으로 붙는다) */
const MUTATION_SCHEMAS: Record<string, ZodRawShape> = {
  compositor_document_guides: { vertical: z.array(z.number()).max(200).optional(), horizontal: z.array(z.number()).max(200).optional() },
  compositor_image_resize: { width: size, height: size, resolution: z.number().min(1).max(10000).optional(), resampling: z.enum(['bilinear']).optional() },
  compositor_image_crop: { x: z.number().int().min(0).max(MAX_SIDE), y: z.number().int().min(0).max(MAX_SIDE), width: size, height: size, deleteCropped: z.boolean().optional() },
  compositor_image_canvas_size: { width: size, height: size, anchor: z.enum(ANCHORS as [string, ...string[]]).optional(), background: z.union([z.null(), color, z.literal('content')]).optional() },
  compositor_image_rotate: { angle: z.union([z.literal(90), z.literal(-90), z.literal(180)]) },
  compositor_image_flip: { axis: z.enum(['horizontal', 'vertical']) },
  compositor_image_trim: {},
  compositor_image_flatten: {},
  compositor_layer_add: {
    kind: z.enum(['pixel', 'group', 'adjustment', 'image']),
    name: z.string().max(255).optional(),
    adjustmentKind: z.enum(ADJUSTMENT_KINDS.map((k) => k.key) as [string, ...string[]]).optional(),
    assetId: ID.optional().describe('kind=image: 올린 PNG'),
    x: px.optional(),
    y: px.optional(),
    aboveId: ID.optional().describe('이 레이어 위에 (없으면 활성 레이어 위)')
  },
  compositor_layer_update: {
    layerId,
    name: z.string().min(1).max(255).optional(),
    visible: z.boolean().optional(),
    opacity: z.number().min(0).max(1).optional(),
    blend: z.enum(blendKeys).optional(),
    clip: z.boolean().optional(),
    x: px.optional(),
    y: px.optional(),
    width: z.number().min(1).max(MAX_SIDE).optional(),
    height: z.number().min(1).max(MAX_SIDE).optional(),
    rotation: z.number().min(-360).max(360).optional(),
    flipH: z.boolean().optional(),
    flipV: z.boolean().optional(),
    lock: z.object({ alpha: z.boolean().optional(), pixels: z.boolean().optional(), position: z.boolean().optional() }).strict().optional(),
    effects,
    adjustment: adjustment.optional().describe('조정 레이어의 설정 (준 항목만)'),
    shape: z
      .object({
        fill: color.nullable().optional(),
        stroke: color.nullable().optional(),
        strokeWidth: z.number().min(0).max(200).optional(),
        radius: z.number().min(0).max(1000).optional(),
        w: z.number().min(0).max(MAX_SIDE).optional(),
        h: z.number().min(0).max(MAX_SIDE).optional()
      })
      .strict()
      .optional(),
    maskEnabled: z.boolean().optional(),
    maskLinked: z.boolean().optional()
  },
  compositor_layer_delete: { layerIds: ids },
  compositor_layer_duplicate: { layerIds: ids },
  compositor_layer_reorder: { layerId, by: z.union([z.literal(1), z.literal(-1)]).optional(), targetId: ID.optional(), where: z.enum(['above', 'below', 'inside']).optional() },
  compositor_layer_group: { layerIds: ids, name: z.string().max(255).optional() },
  compositor_layer_ungroup: { layerId },
  compositor_layer_merge: { mode: z.enum(['down', 'layers', 'visible']), layerId: ID.optional(), layerIds: ids.optional(), name: z.string().max(255).optional() },
  compositor_layer_mask: {
    layerId,
    op: z.enum(['add', 'fromSelection', 'delete', 'invert', 'feather']),
    initial: z.enum(['reveal', 'hide', 'selection']).optional(),
    apply: z.boolean().optional(),
    radius: z.number().min(0.5).max(200).optional()
  },
  compositor_layer_set_active: { layerId },
  compositor_layer_flip: { layerId, axis: z.enum(['horizontal', 'vertical']) },
  compositor_layer_via_copy: { layerId, cut: z.boolean().optional() },
  compositor_selection_set: {
    shape: z.enum(['all', 'none', 'invert', 'rect', 'ellipse', 'polygon', 'wand', 'layerAlpha']),
    mode: z.enum(['replace', 'add', 'subtract', 'intersect']).optional(),
    x: px.optional(),
    y: px.optional(),
    width: z.number().min(1).max(MAX_SIDE).optional(),
    height: z.number().min(1).max(MAX_SIDE).optional(),
    points: z.array(pt).min(3).max(5000).optional().describe('polygon 꼭짓점'),
    tolerance: z.number().int().min(0).max(255).optional().describe('wand 허용치 (기본 32)'),
    contiguous: z.boolean().optional(),
    sampleAll: z.boolean().optional().describe('wand: 보이는 그대로에서 (기본 layerId 의 레이어에서)'),
    layerId: ID.optional(),
    antialias: z.boolean().optional()
  },
  compositor_selection_modify: {
    op: z.enum(['expand', 'contract', 'feather', 'smooth', 'move']),
    amount: z.number().min(0.5).max(500).optional(),
    dx: z.number().int().optional(),
    dy: z.number().int().optional()
  },
  compositor_pixels_fill: { layerId, color, target },
  compositor_pixels_erase: { layerId },
  compositor_pixels_stroke_selection: { layerId, width: z.number().min(1).max(500), color, position: z.enum(['inside', 'center', 'outside']).optional(), opacity: z.number().min(0).max(1).optional() },
  compositor_pixels_content_fill: { layerId },
  compositor_brush_stroke: { layerId, points: ptsP, brush, mode: z.enum(['paint', 'erase']).optional(), color: color.optional(), target },
  compositor_gradient_apply: {
    layerId,
    from: pt,
    to: pt,
    shape: z.enum(['linear', 'radial']).optional(),
    color,
    endColor: color.nullable().optional().describe('없으면 투명으로'),
    reverse: z.boolean().optional(),
    target
  },
  compositor_retouch_stroke: { layerId, points: pts, mode: z.enum(['blur', 'smudge', 'liquify']), brush, strength: z.number().min(1).max(100).optional(), target },
  compositor_clone_stroke: { layerId, points: ptsP, source: pt.describe('가져올 원본 점'), brush, sampleAll: z.boolean().optional() },
  compositor_heal_stroke: { layerId, points: ptsP, brush },
  compositor_shape_add: {
    kind: z.enum(['rect', 'roundRect', 'ellipse', 'line']),
    x: px,
    y: px,
    width: z.number().min(0).max(MAX_SIDE),
    height: z.number().min(0).max(MAX_SIDE),
    fill: color.nullable().optional().describe('기본 검정, null = 채우기 없음'),
    stroke: color.nullable().optional(),
    strokeWidth: z.number().min(0).max(200).optional(),
    radius: z.number().min(0).max(1000).optional(),
    dir: z
      .union([z.literal(1), z.literal(-1)])
      .optional()
      .describe('line: 1 = 왼쪽 위→오른쪽 아래, -1 = 왼쪽 아래→오른쪽 위'),
    name: z.string().max(255).optional()
  },
  compositor_adjust_apply: { layerId, adjustment },
  compositor_adjust_quick: { layerId, kind: z.enum(['invert', 'desaturate', 'contrast', 'color', 'neutral']) },
  compositor_adjust_more: {
    layerId,
    kind: z.enum(MORE_KINDS as [string, ...string[]]),
    blackWhite: z.object({ reds: bwPart, yellows: bwPart, greens: bwPart, cyans: bwPart, blues: bwPart, magentas: bwPart }).strict().optional(),
    colorBalance: z.object({ shadows: cbPart, midtones: cbPart, highlights: cbPart, preserveLuminosity: z.boolean().optional() }).strict().optional(),
    vibrance: z.number().min(-100).max(100).optional(),
    saturation: z.number().min(-100).max(100).optional(),
    levels: z.number().int().min(2).max(255).optional(),
    threshold: z.number().int().min(1).max(255).optional()
  },
  compositor_filter_apply: {
    layerId,
    filter: z.enum(FILTER_KINDS),
    params: z
      .record(z.string(), z.union([z.number(), z.boolean()]))
      .optional()
      .describe(
        'gaussianBlur{radius} motionBlur{distance,angle} addNoise{amount,gaussian,mono} lensCorrection{amount} unsharpMask{amount,radius,threshold} highPass{radius} mosaic{cellSize} median{radius}'
      ),
    seed: z.number().int().min(0).max(0xffffffff).optional()
  }
}

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
type Args = Record<string, unknown>

export function principalFromAuth(auth: AuthInfo | undefined, local?: Principal): Principal {
  if (auth) return { owner: auth.clientId, scopes: auth.scopes.filter((s): s is Scope => s === 'documents:read' || s === 'documents:write') }
  if (local) return local
  throw new CommandError('FORBIDDEN', '인증 정보가 없습니다.')
}

const docOf = (name: string): ToolDoc => {
  const d = TOOL_CATALOG.find((t) => t.name === name)
  if (!d) throw new Error(`catalog 에 없는 도구: ${name}`)
  return d
}

export function createMcpServer(o: McpOptions): McpServer {
  const { service } = o
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {}, resources: {} },
    instructions: [
      'SH Compositor 문서를 서버에서 편집합니다. 먼저 compositor_capabilities 로 지원 형식·한도를 확인하세요.',
      '흐름: compositor_document_create 또는 (PNG/PSD/.shcomp 업로드 → compositor_document_import) → compositor_layer_list 로 레이어 ID 확인 → 편집 도구 → compositor_export → 결과 링크 내려받기.',
      '모든 변경은 docId·expectedRevision·operationId 가 필요합니다. 응답의 result.revision 이 다음 expectedRevision 입니다. REVISION_CONFLICT 면 compositor_document_get 으로 revision 을 다시 읽고 새 operationId 로 시도하세요.',
      '응답이 끊겼으면 같은 operationId 로 다시 부르면 같은 결과를 받습니다. 좌표·크기는 문서 픽셀(왼쪽 위 원점), 레이어 목록은 아래 → 위 순서입니다.',
      '선택 영역(compositor_selection_set)은 채우기·지우기·보정·필터·붓질을 그 안으로 제한합니다. 문자·AI 기능은 서버에서 지원하지 않습니다.'
    ].join('\n')
  })

  const run =
    (tool: string, fn: (p: Principal) => Promise<unknown> | unknown, links?: (data: unknown) => ToolResult['content']) =>
    async (extra: Extra): Promise<ToolResult> => {
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
  const settle = (p: Principal, job: JobInfo, wait: unknown): Promise<JobInfo> => service.waitJob(p, job.jobId, typeof wait === 'number' ? wait : 10_000)
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

  /** 도구 등록 — 제목·설명은 catalog, 스키마·핸들러는 여기 */
  const reg = (
    name: string,
    cfg: { inputSchema?: ZodRawShape; outputSchema?: z.ZodTypeAny; annotations?: Record<string, boolean> },
    fn: (args: Args, p: Principal) => unknown,
    links?: (data: unknown) => ToolResult['content']
  ): void => {
    const d = docOf(name)
    const config = { title: d.title, description: [...d.lines, `매개변수: ${d.params}`].join('\n'), ...cfg } as Parameters<McpServer['registerTool']>[1]
    const handler = cfg.inputSchema ? (args: Args, extra: Extra) => run(name, (p) => fn(args ?? {}, p), links)(extra) : (extra: Extra) => run(name, (p) => fn({}, p), links)(extra)
    server.registerTool(name, config, handler as never)
  }

  // ── 변경 도구 (catalog 의 command 가 있는 것 전부 — 같은 모양) ──
  for (const d of TOOL_CATALOG.filter((t) => t.command)) {
    const shape = MUTATION_SCHEMAS[d.name]
    if (!shape) throw new Error(`스키마가 없는 도구: ${d.name}`)
    reg(d.name, { inputSchema: { ...mutation, ...shape }, outputSchema: JOB_OUT, annotations: d.name === 'compositor_layer_delete' ? { ...WRITE, destructiveHint: true } : WRITE }, async (args, p) => {
      const { waitMs: w, ...rest } = args
      return settle(p, service.startCommand(p, d.command!, rest), w)
    })
  }
  for (const which of ['undo', 'redo'] as const)
    reg(`compositor_document_${which}`, { inputSchema: mutation, outputSchema: JOB_OUT, annotations: WRITE }, async (args, p) => {
      const { waitMs: w, ...rest } = args
      return settle(p, service.startHistoryStep(p, which, rest), w)
    })

  // ── 문서·자산·조회 ──
  reg('compositor_capabilities', { annotations: READ }, () => service.capabilities())
  reg(
    'compositor_document_create',
    {
      inputSchema: {
        width: size,
        height: size,
        background: z.union([z.enum(['white', 'black', 'transparent']), color]).optional(),
        resolution: z.number().min(1).max(10000).optional(),
        name: z.string().max(255).optional()
      },
      outputSchema: DOC_OUT,
      annotations: { ...WRITE, idempotentHint: false }
    },
    (args, p) => service.createDocument(p, args)
  )
  reg(
    'compositor_asset_upload_base64',
    { inputSchema: { dataBase64: z.string().max(Math.ceil((o.maxInlineUploadBytes * 4) / 3) + 4), name: z.string().max(255).optional() }, annotations: { ...WRITE, idempotentHint: false } },
    (args, p) => {
      const bytes = new Uint8Array(Buffer.from(String(args.dataBase64 ?? ''), 'base64'))
      if (bytes.byteLength > o.maxInlineUploadBytes) throw new CommandError('RESOURCE_LIMIT', `base64 업로드는 ${o.maxInlineUploadBytes}바이트까지입니다. HTTP 업로드를 쓰세요.`)
      return service.uploadAsset(p, bytes, { name: typeof args.name === 'string' ? args.name : 'upload' })
    }
  )
  reg('compositor_document_import', { inputSchema: { assetId: ID, name: z.string().max(255).optional() }, outputSchema: DOC_OUT, annotations: { ...WRITE, idempotentHint: false } }, (args, p) =>
    service.importDocument(p, args)
  )
  reg('compositor_document_list', { annotations: READ }, (_a, p) => ({ documents: service.listDocuments(p) }))
  reg('compositor_document_get', { inputSchema: { docId }, outputSchema: DOC_OUT, annotations: READ }, (args, p) => service.getDocument(p, args))
  reg('compositor_document_rename', { inputSchema: { docId, name: z.string().min(1).max(255) }, outputSchema: DOC_OUT, annotations: WRITE }, (args, p) => service.renameDocument(p, args))
  reg('compositor_document_delete', { inputSchema: { docId }, annotations: { ...WRITE, destructiveHint: true } }, (args, p) => service.deleteDocument(p, args))
  reg('compositor_layer_list', { inputSchema: { docId }, annotations: READ }, (args, p) => service.listLayers(p, args))
  reg('compositor_histogram', { inputSchema: { docId, layerId: ID.optional() }, annotations: READ }, (args, p) => service.getHistogram(p, args))
  reg(
    'compositor_export',
    {
      inputSchema: { docId, format: z.enum(['png', 'shcomp', 'psd']), revision: z.number().int().min(1).optional(), operationId: operationId.optional(), waitMs },
      outputSchema: JOB_OUT,
      annotations: { ...READ, idempotentHint: true }
    },
    async (args, p) => {
      const { waitMs: w, ...rest } = args
      return withDownload(await settle(p, service.startExport(p, rest), w))
    },
    artifactLinks
  )
  reg(
    'compositor_job_get',
    { inputSchema: { jobId: ID, waitMs }, outputSchema: JOB_OUT, annotations: READ },
    async (args, p) => {
      service.getJob(p, { jobId: args.jobId })
      return withDownload(await service.waitJob(p, String(args.jobId), typeof args.waitMs === 'number' ? args.waitMs : 0))
    },
    artifactLinks
  )
  reg('compositor_job_cancel', { inputSchema: { jobId: ID }, outputSchema: JOB_OUT, annotations: { ...WRITE, destructiveHint: false } }, (args, p) => service.cancelJob(p, args))

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

/** 등록되는 도구 이름 (테스트·문서 대조용) */
export const TOOL_NAMES: string[] = TOOL_CATALOG.map((t) => t.name)
/** 변경 도구 스키마 키 (테스트: catalog 의 command 도구와 1:1) */
export const MUTATION_TOOL_NAMES: string[] = Object.keys(MUTATION_SCHEMAS)
