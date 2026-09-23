/**
 * headless 서버 + 원격 MCP E2E (plans/0004 4~5단계) — 실제 MCP 클라이언트(공식 SDK)로 out/server 번들을 부른다. 브라우저 없음.
 *
 * 실행: npm run build:server && npm run e2e:mcp
 * 확인: 인증·Origin 거절 → tools/list → PNG 업로드 → import → resize·filter → export → 결과 내려받기
 *       + 다른 사용자 접근·읽기 전용 토큰·과대 입력·동시 편집·응답 단절 후 재시도(operationId)·취소·기한·stdio·로그에 토큰 없음.
 */
import { createRequire } from 'module'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const sdk = (p) => import(require_.resolve(`@modelcontextprotocol/sdk/${p}`))
const { Client } = await sdk('client/index.js')
const { StreamableHTTPClientTransport } = await sdk('client/streamableHttp.js')
const { StdioClientTransport } = await sdk('client/stdio.js')

const PORT = 18787
const BASE = `http://127.0.0.1:${PORT}`
const TOKENS = { alice: 'a'.repeat(40), bob: 'b'.repeat(40), reader: 'r'.repeat(40) }
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-mcp-e2e-'))

// ── PNG ──
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (1 + w * 4) + 1 + x * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const pngDims = (b) => ({ ok: b.subarray(1, 4).toString() === 'PNG', w: b.readUInt32BE(16), h: b.readUInt32BE(20) })
const quad = png(200, 100, (x, y) => (x < 100 ? (y < 50 ? [220, 40, 40, 255] : [40, 180, 60, 255]) : [40, 60, 220, 255]))

// ── 하네스 ──
const results = []
async function t(name, fn) {
  try {
    await fn()
    results.push({ ok: true, name })
    console.log(`  PASS ${name}`)
  } catch (e) {
    results.push({ ok: false, name, err: e?.message ?? String(e) })
    console.log(`  FAIL ${name}: ${(e?.message ?? String(e)).slice(0, 500)}`)
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m)
}

let serverLog = ''
async function startServer() {
  const env = {
    ...process.env,
    SHC_PORT: String(PORT),
    SHC_TOKENS: `alice:${TOKENS.alice}; bob:${TOKENS.bob}; reader:${TOKENS.reader}:read`,
    SHC_ALLOWED_ORIGINS: 'https://allowed.example',
    SHC_MAX_UPLOAD_MB: '1',
    SHC_MAX_PIXELS: '5000000',
    SHC_JOB_TIMEOUT_MS: '2500'
  }
  const proc = spawn(process.execPath, [path.join(PROJECT, 'out/server/index.mjs')], { cwd: PROJECT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  proc.stderr.on('data', (d) => (serverLog += d))
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return proc
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  proc.kill('SIGKILL')
  throw new Error(`서버가 뜨지 않았습니다 (npm run build:server 먼저)\n${serverLog}`)
}

async function connect(who) {
  const client = new Client({ name: 'sc-e2e', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKENS[who]}` } } })
  await client.connect(transport)
  return client
}
/** 도구 호출 → { error } 또는 구조화 결과 */
async function call(client, name, args) {
  const r = await client.callTool({ name, arguments: args })
  if (r.isError) {
    // 도구 실행 오류 = {error:{code,…}} JSON, SDK 의 입력 스키마 위반 = 문장 ("MCP error -32602 …")
    try {
      return { error: JSON.parse(r.content[0].text).error, raw: r }
    } catch {
      return { error: { code: 'SCHEMA', message: r.content[0].text }, raw: r }
    }
  }
  return { ...(r.structuredContent ?? JSON.parse(r.content[0].text)), raw: r }
}
const upload = (who, bytes, name = 'in.png') =>
  fetch(`${BASE}/v1/assets`, { method: 'POST', headers: { Authorization: `Bearer ${TOKENS[who]}`, 'Content-Type': 'image/png', 'X-Filename': encodeURIComponent(name) }, body: bytes })
const health = async () => (await fetch(`${BASE}/healthz`)).json()

async function main() {
  const server = await startServer()
  const clients = []
  try {
    await t('M1 토큰 없음·틀린 토큰 → 401 + 보호 자원 메타데이터 안내', async () => {
      const r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      assert(r.status === 401, r.status)
      assert(/resource_metadata=/.test(r.headers.get('www-authenticate') ?? ''), 'no WWW-Authenticate')
      const bad = await fetch(`${BASE}/v1/assets/x`, { headers: { Authorization: `Bearer ${'z'.repeat(40)}` } })
      assert(bad.status === 401, bad.status)
      const meta = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json()
      assert(meta.resource === `${BASE}/mcp` && meta.scopes_supported.includes('documents:write'), JSON.stringify(meta))
    })
    await t('M2 허용하지 않은 Origin → 403, 허용한 Origin → CORS 헤더', async () => {
      const r = await fetch(`${BASE}/healthz`, { headers: { Origin: 'https://evil.example' } })
      assert(r.status === 403, r.status)
      const ok = await fetch(`${BASE}/healthz`, { headers: { Origin: 'https://allowed.example' } })
      assert(ok.status === 200 && ok.headers.get('access-control-allow-origin') === 'https://allowed.example', 'cors')
    })
    const alice = await connect('alice')
    clients.push(alice)
    await t('M3 초기화·tools/list: 도구 16개와 입력 스키마, 프로토콜 버전 고정', async () => {
      const { tools } = await alice.listTools()
      const names = tools.map((x) => x.name).sort()
      assert(names.length === 16, names.join(','))
      for (const n of ['compositor_document_create', 'compositor_image_resize', 'compositor_filter_apply', 'compositor_export', 'compositor_job_get', 'compositor_job_cancel'])
        assert(names.includes(n), `missing ${n}`)
      const resize = tools.find((x) => x.name === 'compositor_image_resize')
      assert(resize.inputSchema.required.includes('expectedRevision') && resize.inputSchema.properties.width.maximum === 30000, JSON.stringify(resize.inputSchema))
      assert(resize.annotations.readOnlyHint === false, 'annotations')
      assert(alice.getServerVersion().name === 'sh-compositor', 'server info')
      assert(alice.transport.protocolVersion === '2025-11-25', `protocol ${alice.transport.protocolVersion}`)
    })
    let doc, layerId, assetId
    await t('M4 PNG HTTP 업로드 → import → 레이어 목록', async () => {
      const r = await upload('alice', quad, 'quad.png')
      assert(r.status === 201, r.status)
      assetId = (await r.json()).id
      doc = await call(alice, 'compositor_document_import', { assetId })
      assert(!doc.error && doc.width === 200 && doc.height === 100 && doc.revision === 1 && doc.name === 'quad', JSON.stringify(doc.error ?? doc))
      const layers = await call(alice, 'compositor_layer_list', { docId: doc.docId })
      assert(layers.layers.length === 1, JSON.stringify(layers))
      layerId = layers.layers[0].id
    })
    let exported
    await t('M5 resize → filter → export → 결과 PNG 내려받기 (resource_link·downloadUrl)', async () => {
      const r1 = await call(alice, 'compositor_image_resize', { docId: doc.docId, expectedRevision: 1, operationId: 'm5-resize', width: 100, height: 50 })
      assert(r1.status === 'succeeded' && r1.result.revision === 2, JSON.stringify(r1.error ?? r1))
      const r2 = await call(alice, 'compositor_filter_apply', { docId: doc.docId, expectedRevision: 2, operationId: 'm5-blur', layerId, filter: 'gaussianBlur', params: { radius: 2 } })
      assert(r2.status === 'succeeded' && r2.result.revision === 3, JSON.stringify(r2.error ?? r2))
      exported = await call(alice, 'compositor_export', { docId: doc.docId, format: 'png' })
      assert(exported.status === 'succeeded' && exported.downloadUrl, JSON.stringify(exported.error ?? exported))
      assert(
        exported.raw.content.some((c) => c.type === 'resource_link' && c.uri.startsWith('compositor://assets/')),
        'no resource_link'
      )
      const dl = await fetch(exported.downloadUrl, { headers: { Authorization: `Bearer ${TOKENS.alice}` } })
      assert(dl.status === 200 && dl.headers.get('content-type') === 'image/png', dl.status)
      const dims = pngDims(Buffer.from(await dl.arrayBuffer()))
      assert(dims.ok && dims.w === 100 && dims.h === 50, JSON.stringify(dims))
      // 이전 revision 도 이력에 있으면 내보낼 수 있다
      const old = await call(alice, 'compositor_export', { docId: doc.docId, format: 'png', revision: 1 })
      const oldPng = await (await fetch(old.downloadUrl, { headers: { Authorization: `Bearer ${TOKENS.alice}` } })).arrayBuffer()
      assert(pngDims(Buffer.from(oldPng)).w === 200, 'revision 1 export')
    })
    const bob = await connect('bob')
    clients.push(bob)
    await t('M6 다른 사용자: 문서·작업·결과 파일 모두 NOT_FOUND (존재를 알리지 않음)', async () => {
      const g = await call(bob, 'compositor_document_get', { docId: doc.docId })
      assert(g.error?.code === 'NOT_FOUND', JSON.stringify(g))
      const u = await call(bob, 'compositor_layer_update', { docId: doc.docId, expectedRevision: 3, operationId: 'bob-1', layerId, name: 'x' })
      assert(u.error?.code === 'NOT_FOUND', JSON.stringify(u))
      const j = await call(bob, 'compositor_job_get', { jobId: exported.jobId })
      assert(j.error?.code === 'NOT_FOUND', JSON.stringify(j))
      const dl = await fetch(exported.downloadUrl, { headers: { Authorization: `Bearer ${TOKENS.bob}` } })
      assert(dl.status === 404, dl.status)
      // 인자로 소유자를 넣어도 무시된다 (스키마 밖 키는 거절)
      const spoof = await call(bob, 'compositor_document_get', { docId: doc.docId, owner: 'alice' })
      assert(spoof.error, 'owner arg accepted')
    })
    const reader = await connect('reader')
    clients.push(reader)
    await t('M7 읽기 전용 토큰: 조회는 되고 변경은 FORBIDDEN', async () => {
      const bdoc = await call(reader, 'compositor_document_create', { width: 10, height: 10 })
      assert(bdoc.error?.code === 'FORBIDDEN', JSON.stringify(bdoc))
      assert((await call(reader, 'compositor_capabilities', {})).exportFormats.includes('png'), 'capabilities')
    })
    await t('M8 과대 입력: 업로드 바이트 413 · 디코딩 픽셀 한도 · 지원 안 하는 형식', async () => {
      const big = await upload('alice', Buffer.alloc(1024 * 1024 + 10))
      assert(big.status === 413, big.status)
      // 작은 파일이지만 3000×3000 = 9MP > 5MP 한도
      const bomb = await upload(
        'alice',
        png(3000, 3000, () => [0, 0, 0, 0])
      )
      assert(bomb.status === 201, bomb.status)
      const imp = await call(alice, 'compositor_document_import', { assetId: (await bomb.json()).id })
      assert(imp.error?.code === 'RESOURCE_LIMIT', JSON.stringify(imp))
      const gif = await fetch(`${BASE}/v1/assets`, { method: 'POST', headers: { Authorization: `Bearer ${TOKENS.alice}`, 'Content-Type': 'image/gif' }, body: 'GIF89a' })
      assert(gif.status === 415, gif.status)
      const huge = await call(alice, 'compositor_document_create', { width: 30000, height: 30000 })
      assert(huge.error?.code === 'RESOURCE_LIMIT', JSON.stringify(huge))
      const badArg = await call(alice, 'compositor_image_resize', { docId: doc.docId, expectedRevision: 3, operationId: 'bad', width: 'wide', height: 5 })
      assert(badArg.raw.isError, 'schema violation accepted')
    })
    await t('M9 동시 편집: 같은 revision 의 두 변경 중 하나만 커밋, 나머지 REVISION_CONFLICT', async () => {
      const cur = await call(alice, 'compositor_document_get', { docId: doc.docId })
      const [a, b] = await Promise.all([
        call(alice, 'compositor_layer_update', { docId: doc.docId, expectedRevision: cur.revision, operationId: 'm9-a', layerId, name: 'A' }),
        call(alice, 'compositor_layer_update', { docId: doc.docId, expectedRevision: cur.revision, operationId: 'm9-b', layerId, name: 'B' })
      ])
      // 늦은 쪽은 시작할 때(즉시 오류) 또는 커밋할 때(작업 실패) REVISION_CONFLICT
      const outcomes = [a, b].map((r) => (r.status === 'succeeded' ? 'ok' : (r.error?.code ?? r.status)))
      assert(outcomes.filter((x) => x === 'ok').length === 1 && outcomes.filter((x) => x === 'REVISION_CONFLICT').length === 1, JSON.stringify(outcomes))
      assert((await call(alice, 'compositor_document_get', { docId: doc.docId })).revision === cur.revision + 1, 'revision')
    })
    await t('M10 응답 단절 후 재시도: 같은 operationId = 같은 결과, 다른 입력 = INVALID_INPUT', async () => {
      const cur = await call(alice, 'compositor_document_get', { docId: doc.docId })
      const first = await call(alice, 'compositor_layer_update', { docId: doc.docId, expectedRevision: cur.revision, operationId: 'm10', layerId, opacity: 0.5 })
      const again = await call(alice, 'compositor_layer_update', { docId: doc.docId, expectedRevision: cur.revision, operationId: 'm10', layerId, opacity: 0.5 })
      assert(first.jobId === again.jobId && again.result.revision === first.result.revision, JSON.stringify([first.jobId, again.jobId]))
      assert((await call(alice, 'compositor_document_get', { docId: doc.docId })).revision === cur.revision + 1, 'applied twice')
      const other = await call(alice, 'compositor_layer_update', { docId: doc.docId, expectedRevision: cur.revision, operationId: 'm10', layerId, opacity: 0.2 })
      assert(other.error?.code === 'INVALID_INPUT' && other.error.details?.reason === 'OPERATION_ID_REUSED', JSON.stringify(other))
      const u = await call(alice, 'compositor_document_undo', { docId: doc.docId, expectedRevision: cur.revision + 1, operationId: 'm10-undo' })
      assert(u.status === 'succeeded' && u.result.revision === cur.revision + 2, JSON.stringify(u.error ?? u))
    })
    // 느린 작업: 2200×2200 중간값(반경 10) — 작업 스레드에서 6초 이상 (기한 2.5초보다 충분히 길게)
    const slowDoc = await call(alice, 'compositor_document_create', { width: 2200, height: 2200, name: 'slow' })
    const slowLayer = (await call(alice, 'compositor_layer_list', { docId: slowDoc.docId })).layers[0].id
    await t('M11 취소: 도는 작업을 취소하면 커밋되지 않고 작업 스레드가 정리된다', async () => {
      const started = await call(alice, 'compositor_filter_apply', {
        docId: slowDoc.docId,
        expectedRevision: 1,
        operationId: 'm11',
        layerId: slowLayer,
        filter: 'median',
        params: { radius: 10 },
        waitMs: 0
      })
      assert(started.status === 'running' || started.status === 'queued', JSON.stringify(started.error ?? started))
      await new Promise((r) => setTimeout(r, 200))
      assert((await health()).workerThreads === 1, JSON.stringify(await health()))
      const c = await call(alice, 'compositor_job_cancel', { jobId: started.jobId })
      assert(c.status === 'cancelled', JSON.stringify(c))
      await new Promise((r) => setTimeout(r, 300))
      const h = await health()
      assert(h.workerThreads === 0 && h.jobsRunning === 0, JSON.stringify(h))
      assert((await call(alice, 'compositor_document_get', { docId: slowDoc.docId })).revision === 1, 'committed after cancel')
      const cancelledAgain = await call(alice, 'compositor_job_cancel', { jobId: started.jobId })
      assert(cancelledAgain.status === 'cancelled', 'cancel not idempotent')
    })
    await t('M12 기한 초과: TIMEOUT 으로 끝나고 스레드 정리·문서 그대로', async () => {
      const started = await call(alice, 'compositor_filter_apply', {
        docId: slowDoc.docId,
        expectedRevision: 1,
        operationId: 'm12',
        layerId: slowLayer,
        filter: 'median',
        params: { radius: 10 },
        waitMs: 0
      })
      const done = await call(alice, 'compositor_job_get', { jobId: started.jobId, waitMs: 15000 })
      assert(done.status === 'failed' && done.error.code === 'TIMEOUT', JSON.stringify(done))
      await new Promise((r) => setTimeout(r, 300))
      const h = await health()
      assert(h.workerThreads === 0 && h.jobsRunning === 0, JSON.stringify(h))
      assert((await call(alice, 'compositor_document_get', { docId: slowDoc.docId })).revision === 1, 'committed after timeout')
    })
    await t('M13 문서 지우기 → 이후 조회 NOT_FOUND', async () => {
      const d = await call(alice, 'compositor_document_delete', { docId: slowDoc.docId })
      assert(d.deleted === true, JSON.stringify(d))
      assert((await call(alice, 'compositor_document_get', { docId: slowDoc.docId })).error?.code === 'NOT_FOUND', 'still there')
    })
    await t('M14 서버 로그: 요청·작업 ID 는 있고 토큰·이미지 원문은 없다', async () => {
      assert(serverLog.includes('"tool":"compositor_image_resize"') && serverLog.includes('"requestId"'), 'no structured log')
      for (const tok of Object.values(TOKENS)) assert(!serverLog.includes(tok), 'token leaked into log')
      assert(!serverLog.includes('iVBOR'), 'image data in log')
    })
  } finally {
    for (const c of clients) await c.close().catch(() => {})
    server.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
    if (server.exitCode === null) server.kill('SIGKILL')
  }

  // stdio (로컬 MCP) — 서버를 띄운 사용자 한 명
  await t('M15 stdio: 생성 → base64 업로드 → import → export → resources/read 로 결과 받기', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(PROJECT, 'out/server/index.mjs'), '--stdio'],
      cwd: PROJECT,
      env: { ...process.env, SHC_STDIO_OWNER: 'me' },
      stderr: 'pipe'
    })
    const client = new Client({ name: 'sc-e2e-stdio', version: '1.0.0' })
    await client.connect(transport)
    try {
      const up = await call(client, 'compositor_asset_upload_base64', { dataBase64: png(30, 20, () => [10, 200, 30, 255]).toString('base64'), name: 'g.png' })
      assert(up.id, JSON.stringify(up.error ?? up))
      const d = await call(client, 'compositor_document_import', { assetId: up.id })
      assert(d.width === 30 && d.height === 20, JSON.stringify(d.error ?? d))
      const ex = await call(client, 'compositor_export', { docId: d.docId, format: 'shcomp' })
      const link = ex.raw.content.find((c) => c.type === 'resource_link')
      assert(link && !ex.downloadUrl, JSON.stringify(ex.raw.content))
      const res = await client.readResource({ uri: link.uri })
      const bytes = Buffer.from(res.contents[0].blob, 'base64')
      assert(bytes[0] === 0x50 && bytes[1] === 0x4b, 'not a zip (.shcomp)')
      const tooBig = await call(client, 'compositor_asset_upload_base64', { dataBase64: Buffer.alloc(5 * 1024 * 1024).toString('base64') })
      assert(tooBig.raw.isError, 'inline upload limit')
    } finally {
      await client.close()
    }
  })

  const fail = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fail.length}/${results.length} passed`)
  for (const f of fail) console.log(`  ✗ ${f.name}: ${f.err}`)
  fs.rmSync(WORK, { recursive: true, force: true })
  process.exit(fail.length ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
