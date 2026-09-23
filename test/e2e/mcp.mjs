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
/** PNG(8비트 RGBA, 비인터레이스) 디코더 — 결과 픽셀 검사용 (필터 0~4) */
function decodePng(buf) {
  let off = 8
  const idat = []
  let w = 0
  let h = 0
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.subarray(off + 4, off + 8).toString('ascii')
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error('test decoder: 8bit RGBA only')
    } else if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const out = new Uint8Array(w * h * 4)
  const paeth = (a, b, c) => {
    const p = a + b - c
    const pa = Math.abs(p - a)
    const pb = Math.abs(p - b)
    const pc = Math.abs(p - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[dst + i - 4] : 0
      const b = y > 0 ? out[dst - stride + i] : 0
      const c = y > 0 && i >= 4 ? out[dst - stride + i - 4] : 0
      const x = raw[src + i]
      out[dst + i] = f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)
    }
  }
  return { w, h, px: (x, y) => Array.from(out.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)) }
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
    await t('M3 초기화·tools/list: 도구 51개와 입력 스키마, 프로토콜 버전 고정', async () => {
      const { tools } = await alice.listTools()
      const names = tools.map((x) => x.name).sort()
      assert(names.length === 51, names.join(','))
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
    // ── M16~ 모든 도구 (51개) — 실제 SDK 클라이언트로 한 번씩, 결과 PNG 픽셀로 확인 ──
    const called = new Set()
    const tool = async (name, args) => {
      called.add(name)
      const r = await call(alice, name, args)
      if (r.error) throw new Error(`${name}: ${JSON.stringify(r.error)}`)
      if (r.status && r.status !== 'succeeded') throw new Error(`${name}: ${JSON.stringify(r.error ?? r.status)}`)
      return r
    }
    let rev = 0
    let opSeq = 0
    /** 변경 도구: expectedRevision 자동, 결과 revision 갱신 */
    const mut = async (name, docId, args) => {
      const r = await tool(name, { docId, expectedRevision: rev, operationId: `all-${++opSeq}`, ...args })
      rev = r.result.revision
      return r
    }
    const pixels = async (docId) => {
      const ex = await tool('compositor_export', { docId, format: 'png' })
      const buf = Buffer.from(await (await fetch(ex.downloadUrl, { headers: { Authorization: `Bearer ${TOKENS.alice}` } })).arrayBuffer())
      return decodePng(buf)
    }
    const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol)
    let D, bgL
    await t('M16 문서 만들기·목록·이름·정보·기능 목록', async () => {
      const caps = await tool('compositor_capabilities', {})
      assert(caps.commands.length === 36 && caps.importFormats.includes('psd') && caps.exportFormats.includes('psd'), JSON.stringify(caps.commands.length))
      const d = await tool('compositor_document_create', { width: 60, height: 40, background: 'white', name: 'all' })
      D = d.docId
      rev = d.revision
      const renamed = await tool('compositor_document_rename', { docId: D, name: 'all-tools' })
      assert(renamed.name === 'all-tools' && renamed.revision === rev, 'rename bumped revision')
      const list = await tool('compositor_document_list', {})
      assert(
        list.documents.some((x) => x.docId === D),
        'not listed'
      )
      bgL = (await tool('compositor_layer_list', { docId: D })).layers[0].id
      const info = await tool('compositor_document_get', { docId: D })
      assert(info.selection === null && info.layerCount === 1, JSON.stringify(info))
    })
    await t('M17 레이어: 추가·속성·복제·순서·그룹·해제·활성·반전·병합·삭제', async () => {
      const top = (await mut('compositor_layer_add', D, { kind: 'pixel', name: 'top' })).result.summary
      const topId = /\(([^)]+)\)/.exec(top)[1]
      await mut('compositor_layer_update', D, { layerId: topId, opacity: 0.5, blend: 'multiply', lock: { position: true } })
      const l = (await tool('compositor_layer_list', { docId: D })).layers.find((x) => x.id === topId)
      assert(l.opacity === 0.5 && l.blend === 'multiply' && l.lock.position, JSON.stringify(l))
      const locked = await call(alice, 'compositor_layer_update', { docId: D, expectedRevision: rev, operationId: 'lockmove', layerId: topId, x: 5 })
      assert(locked.error?.code === 'FORBIDDEN', JSON.stringify(locked))
      await mut('compositor_layer_update', D, { layerId: topId, lock: { position: false }, x: 3, y: 4, effects: { shadow: { enabled: true, distance: 2 } } })
      await mut('compositor_layer_duplicate', D, { layerIds: [topId] })
      const dupId = (await tool('compositor_layer_list', { docId: D })).layers.at(-1).id
      await mut('compositor_layer_reorder', D, { layerId: dupId, by: -1 })
      await mut('compositor_layer_group', D, { layerIds: [topId, dupId], name: 'G' })
      const gId = (await tool('compositor_layer_list', { docId: D })).layers.find((x) => x.kind === 'group').id
      await mut('compositor_layer_ungroup', D, { layerId: gId })
      await mut('compositor_layer_set_active', D, { layerId: bgL })
      await mut('compositor_layer_flip', D, { layerId: topId, axis: 'vertical' })
      await mut('compositor_layer_merge', D, { mode: 'layers', layerIds: [topId, dupId], name: 'merged' })
      const layers = (await tool('compositor_layer_list', { docId: D })).layers
      assert(layers.length === 2 && layers.some((x) => x.name === 'merged'), JSON.stringify(layers.map((x) => x.name)))
      await mut('compositor_layer_delete', D, { layerIds: [layers.find((x) => x.name === 'merged').id] })
      assert((await tool('compositor_layer_list', { docId: D })).layers.length === 1, 'delete')
      await mut('compositor_layer_add', D, { kind: 'adjustment', adjustmentKind: 'levels', name: 'lv' })
      const adjId = (await tool('compositor_layer_list', { docId: D })).layers.at(-1).id
      await mut('compositor_layer_update', D, { layerId: adjId, adjustment: { inBlack: 100 } })
      await mut('compositor_layer_delete', D, { layerIds: [adjId] })
      await mut('compositor_layer_add', D, { kind: 'group', name: 'folder' })
      await mut('compositor_layer_delete', D, { layerIds: [(await tool('compositor_layer_list', { docId: D })).layers.at(-1).id] })
    })
    await t('M18 선택·채우기·지우기·선 그리기·내용 인식·복사해서 새 레이어·마스크', async () => {
      await mut('compositor_selection_set', D, { shape: 'rect', x: 0, y: 0, width: 30, height: 40 })
      assert((await tool('compositor_document_get', { docId: D })).selection.w === 30, 'selection bounds')
      await mut('compositor_pixels_fill', D, { layerId: bgL, color: '#ff0000' })
      let p = await pixels(D)
      assert(near(p.px(10, 10), [255, 0, 0, 255]) && near(p.px(45, 10), [255, 255, 255, 255]), `fill ${p.px(10, 10)} ${p.px(45, 10)}`)
      await mut('compositor_selection_set', D, { shape: 'wand', x: 45, y: 10, layerId: bgL, tolerance: 8 })
      await mut('compositor_selection_modify', D, { op: 'contract', amount: 3 })
      await mut('compositor_pixels_erase', D, { layerId: bgL })
      p = await pixels(D)
      assert(p.px(45, 20)[3] === 0 && p.px(31, 20)[3] === 255, `erase ${p.px(45, 20)} ${p.px(31, 20)}`)
      await mut('compositor_selection_set', D, { shape: 'invert' })
      await mut('compositor_selection_modify', D, { op: 'move', dx: 1, dy: 0 })
      await mut('compositor_selection_set', D, { shape: 'ellipse', x: 5, y: 5, width: 20, height: 20 })
      await mut('compositor_pixels_stroke_selection', D, { layerId: bgL, width: 3, color: '#0000ff' })
      p = await pixels(D)
      assert(near(p.px(15, 5), [0, 0, 255, 255], 40), `stroke ${p.px(15, 5)}`)
      await mut('compositor_selection_set', D, {
        shape: 'polygon',
        points: [
          { x: 32, y: 2 },
          { x: 40, y: 2 },
          { x: 36, y: 10 }
        ]
      })
      await mut('compositor_selection_modify', D, { op: 'expand', amount: 1 })
      await mut('compositor_selection_modify', D, { op: 'feather', amount: 1 })
      await mut('compositor_selection_modify', D, { op: 'smooth', amount: 1 })
      await mut('compositor_selection_set', D, { shape: 'rect', x: 0, y: 30, width: 10, height: 5 })
      await mut('compositor_pixels_content_fill', D, { layerId: bgL })
      await mut('compositor_layer_via_copy', D, { layerId: bgL, cut: true })
      const copyId = (await tool('compositor_layer_list', { docId: D })).layers.at(-1).id
      await mut('compositor_layer_mask', D, { layerId: copyId, op: 'add', initial: 'reveal' })
      await mut('compositor_layer_mask', D, { layerId: copyId, op: 'invert' })
      await mut('compositor_layer_mask', D, { layerId: copyId, op: 'feather', radius: 1 })
      await mut('compositor_layer_update', D, { layerId: copyId, maskEnabled: false })
      await mut('compositor_layer_mask', D, { layerId: copyId, op: 'delete', apply: false })
      await mut('compositor_selection_set', D, { shape: 'layerAlpha', layerId: copyId })
      await mut('compositor_layer_mask', D, { layerId: copyId, op: 'fromSelection' })
      await mut('compositor_layer_mask', D, { layerId: copyId, op: 'delete', apply: true })
      await mut('compositor_layer_delete', D, { layerIds: [copyId] })
      await mut('compositor_selection_set', D, { shape: 'all' })
      await mut('compositor_selection_set', D, { shape: 'none' })
      assert((await tool('compositor_document_get', { docId: D })).selection === null, 'deselect')
    })
    await t('M19 붓·그라데이션·리터칭·복제 도장·스팟 복구·도형', async () => {
      await mut('compositor_pixels_fill', D, { layerId: bgL, color: '#ffffff' })
      await mut('compositor_brush_stroke', D, {
        layerId: bgL,
        points: [
          { x: 5, y: 20 },
          { x: 55, y: 20, pressure: 1 }
        ],
        color: '#000000',
        brush: { size: 6, hardness: 1 }
      })
      let p = await pixels(D)
      assert(near(p.px(30, 20), [0, 0, 0, 255]), `brush ${p.px(30, 20)}`)
      await mut('compositor_brush_stroke', D, { layerId: bgL, points: [{ x: 30, y: 20 }], mode: 'erase', brush: { size: 4, hardness: 1 } })
      p = await pixels(D)
      assert(p.px(30, 20)[3] < 255, `erase brush ${p.px(30, 20)}`)
      await mut('compositor_gradient_apply', D, { layerId: bgL, from: { x: 0, y: 0 }, to: { x: 60, y: 0 }, color: '#ffffff', endColor: '#000000' })
      p = await pixels(D)
      assert(p.px(2, 2)[0] > 200 && p.px(57, 2)[0] < 60, `gradient ${p.px(2, 2)} ${p.px(57, 2)}`)
      await mut('compositor_retouch_stroke', D, {
        layerId: bgL,
        points: [
          { x: 20, y: 10 },
          { x: 40, y: 10 }
        ],
        mode: 'blur',
        brush: { size: 12 },
        strength: 100
      })
      await mut('compositor_retouch_stroke', D, {
        layerId: bgL,
        points: [
          { x: 20, y: 30 },
          { x: 40, y: 30 }
        ],
        mode: 'smudge',
        brush: { size: 12 },
        strength: 80
      })
      await mut('compositor_retouch_stroke', D, {
        layerId: bgL,
        points: [
          { x: 20, y: 35 },
          { x: 40, y: 35 }
        ],
        mode: 'liquify',
        brush: { size: 12 },
        strength: 80
      })
      await mut('compositor_clone_stroke', D, { layerId: bgL, points: [{ x: 50, y: 30 }], source: { x: 5, y: 5 }, brush: { size: 8, hardness: 1 } })
      p = await pixels(D)
      assert(p.px(50, 30)[0] > 150, `clone ${p.px(50, 30)}`)
      await mut('compositor_heal_stroke', D, { layerId: bgL, points: [{ x: 50, y: 30 }], brush: { size: 6 } })
      const sh = await mut('compositor_shape_add', D, { kind: 'ellipse', x: 10, y: 10, width: 20, height: 12, fill: '#00ff00', stroke: '#0000ff', strokeWidth: 2 })
      const shId = /\(([^)]+)\)/.exec(sh.result.summary)[1]
      p = await pixels(D)
      assert(near(p.px(20, 16), [0, 255, 0, 255]), `shape ${p.px(20, 16)}`)
      await mut('compositor_layer_update', D, { layerId: shId, shape: { fill: '#ff00ff', w: 30 } })
      p = await pixels(D)
      assert(near(p.px(20, 16), [255, 0, 255, 255]), `reshape ${p.px(20, 16)}`)
      await mut('compositor_shape_add', D, { kind: 'line', x: 0, y: 39, width: 59, height: 0, stroke: '#000000', strokeWidth: 2 })
      await mut('compositor_layer_merge', D, { mode: 'visible' })
    })
    await t('M20 보정·빠른 보정·흑백 등·필터·히스토그램', async () => {
      const l = (await tool('compositor_layer_list', { docId: D })).layers[0].id
      await mut('compositor_pixels_fill', D, { layerId: l, color: '#8040c0' })
      await mut('compositor_adjust_apply', D, {
        layerId: l,
        adjustment: {
          exposure: 0.5,
          hue: 30,
          curve: [
            { x: 0, y: 0 },
            { x: 128, y: 100 },
            { x: 255, y: 255 }
          ],
          channels: { r: { inBlack: 10 } },
          hueRanges: { blues: { saturation: -20 } }
        }
      })
      const before = (await pixels(D)).px(30, 20)
      await mut('compositor_adjust_quick', D, { layerId: l, kind: 'invert' })
      const inv = (await pixels(D)).px(30, 20)
      assert(inv[0] === 255 - before[0] && inv[1] === 255 - before[1], `invert ${before} → ${inv}`)
      await mut('compositor_adjust_quick', D, { layerId: l, kind: 'desaturate' })
      const gray = (await pixels(D)).px(30, 20)
      assert(Math.abs(gray[0] - gray[1]) <= 1 && Math.abs(gray[1] - gray[2]) <= 1, `desaturate ${gray}`)
      await mut('compositor_adjust_more', D, { layerId: l, kind: 'colorBalance', colorBalance: { midtones: [60, 0, 0] } })
      await mut('compositor_adjust_more', D, { layerId: l, kind: 'vibrance', vibrance: 50 })
      await mut('compositor_adjust_more', D, { layerId: l, kind: 'blackWhite', blackWhite: { reds: 100 } })
      await mut('compositor_adjust_more', D, { layerId: l, kind: 'posterize', levels: 3 })
      await mut('compositor_adjust_more', D, { layerId: l, kind: 'threshold', threshold: 128 })
      const th = (await pixels(D)).px(30, 20)
      assert(th[0] === 0 || th[0] === 255, `threshold ${th}`)
      for (const [filter, params] of [
        ['gaussianBlur', { radius: 1 }],
        ['motionBlur', { distance: 3, angle: 45 }],
        ['addNoise', { amount: 20 }],
        ['lensCorrection', { amount: 30 }],
        ['unsharpMask', { amount: 100, radius: 1 }],
        ['highPass', { radius: 2 }],
        ['mosaic', { cellSize: 4 }],
        ['median', { radius: 1 }]
      ])
        await mut('compositor_filter_apply', D, { layerId: l, filter, params, seed: 1 })
      const h = await tool('compositor_histogram', { docId: D, layerId: l })
      assert(h.histogram && h.revision === rev, 'histogram')
      const auto = await call(alice, 'compositor_adjust_quick', { docId: D, expectedRevision: rev, operationId: 'auto', layerId: l, kind: 'contrast' })
      assert(auto.status === 'succeeded' || auto.error?.code === 'INVALID_INPUT', JSON.stringify(auto.error ?? auto.status))
      if (auto.status === 'succeeded') rev = auto.result.revision
    })
    await t('M21 캔버스 크기·회전·반전·투명 여백·안내선·크기·자르기·병합·실행 취소/다시 실행', async () => {
      await mut('compositor_image_canvas_size', D, { width: 80, height: 50, anchor: 'nw', background: '#123456' })
      let p = await pixels(D)
      assert(p.w === 80 && near(p.px(75, 45), [0x12, 0x34, 0x56, 255]), `canvas ${p.w} ${p.px(75, 45)}`)
      await mut('compositor_image_canvas_size', D, { width: 90, height: 60, anchor: 'c', background: null })
      p = await pixels(D)
      assert(p.px(1, 1)[3] === 0, `transparent margin ${p.px(1, 1)}`)
      await mut('compositor_image_trim', D, {})
      assert((await tool('compositor_document_get', { docId: D })).width === 80, 'trim')
      await mut('compositor_image_rotate', D, { angle: 90 })
      assert((await tool('compositor_document_get', { docId: D })).width === 50, 'rotate')
      await mut('compositor_image_flip', D, { axis: 'horizontal' })
      await mut('compositor_document_guides', D, { vertical: [10, 20], horizontal: [5] })
      const g = (await tool('compositor_document_get', { docId: D })).guides
      assert(g.vertical.length === 2 && g.horizontal.length === 1, JSON.stringify(g))
      await mut('compositor_image_resize', D, { width: 25, height: 40, resolution: 300 })
      assert((await tool('compositor_document_get', { docId: D })).resolution === 300, 'dpi')
      await mut('compositor_image_crop', D, { x: 2, y: 2, width: 20, height: 30, deleteCropped: true })
      await mut('compositor_layer_add', D, { kind: 'pixel' })
      await mut('compositor_image_flatten', D, {})
      assert((await tool('compositor_layer_list', { docId: D })).layers.length === 1, 'flatten')
      const before = rev
      const u = await tool('compositor_document_undo', { docId: D, expectedRevision: rev, operationId: 'u1' })
      rev = u.result.revision
      assert((await tool('compositor_layer_list', { docId: D })).layers.length === 2, 'undo')
      const r = await tool('compositor_document_redo', { docId: D, expectedRevision: rev, operationId: 'r1' })
      rev = r.result.revision
      assert(rev === before + 2 && (await tool('compositor_layer_list', { docId: D })).layers.length === 1, 'redo')
    })
    await t('M22 PSD·.shcomp 내보내기 → 다시 가져오기, PNG 를 레이어로 넣기', async () => {
      await mut('compositor_layer_add', D, { kind: 'pixel', name: 'extra' })
      for (const format of ['psd', 'shcomp']) {
        const ex = await tool('compositor_export', { docId: D, format })
        const bytes = Buffer.from(await (await fetch(ex.downloadUrl, { headers: { Authorization: `Bearer ${TOKENS.alice}` } })).arrayBuffer())
        const up = await fetch(`${BASE}/v1/assets`, { method: 'POST', headers: { Authorization: `Bearer ${TOKENS.alice}`, 'Content-Type': 'image/png', 'X-Filename': `a.${format}` }, body: bytes })
        assert(up.status === 201, `${format} upload ${up.status}`)
        const back = await tool('compositor_document_import', { assetId: (await up.json()).id })
        assert(back.layerCount === 2, `${format} layers ${back.layerCount}`)
        await tool('compositor_document_delete', { docId: back.docId })
      }
      const img = await upload(
        'alice',
        png(8, 8, () => [0, 0, 255, 255]),
        'blue.png'
      )
      await mut('compositor_layer_add', D, { kind: 'image', assetId: (await img.json()).id, x: 0, y: 0 })
      const p = await pixels(D)
      assert(near(p.px(2, 2), [0, 0, 255, 255]), `image layer ${p.px(2, 2)}`)
      const stdioOnly = await tool('compositor_asset_upload_base64', { dataBase64: png(4, 4, () => [1, 2, 3, 255]).toString('base64'), name: 'tiny.png' })
      assert(stdioOnly.id, 'base64 upload')
      const curL = (await tool('compositor_layer_list', { docId: D })).layers[0].id
      const jobs = await tool('compositor_job_get', { jobId: (await mut('compositor_pixels_fill', D, { layerId: curL, color: '#000000' })).jobId })
      assert(jobs.status === 'succeeded', 'job get')
      const c = await tool('compositor_job_cancel', { jobId: jobs.jobId })
      assert(c.status === 'succeeded', 'cancel of finished job keeps status')
      await tool('compositor_document_delete', { docId: D })
    })
    await t('M23 도구 51개를 모두 불렀다', async () => {
      const { tools } = await alice.listTools()
      const missing = tools.map((x) => x.name).filter((n) => !called.has(n))
      assert(tools.length === 51 && missing.length === 0, `${tools.length} tools, uncalled: ${missing.join(', ')}`)
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
