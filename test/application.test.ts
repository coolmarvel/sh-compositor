import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDoc, resizeImage, getLayer } from '../src/core/doc/ops'
import { startHistory, record, historyBytes, undo } from '../src/core/doc/history'
import { adjustLayer } from '../src/core/doc/pixels'
import { encodePng, decodePng } from '../src/core/png'
import { flattenDoc } from '../src/core/doc/render'
import { unpackProject } from '../src/core/doc/project'
import type { Doc } from '../src/core/doc/types'
import {
  resizeCommand,
  filterCommand,
  layerUpdateCommand,
  cropCommand,
  CommandError,
  DocumentService,
  type Principal,
  type JobRunner,
  type Task,
  type TaskResult,
  executeTask,
  stripShared,
  restoreShared
} from '../src/application'
import { WorkerClient, SharedJob, WorkerCancelledError, WorkerTimeoutError } from '../src/renderer/src/util/workerClient'
import { EditorStore } from '../src/renderer/src/editor/store'

const MB = 1024 * 1024
const code = (c: string) => (e: unknown) => e instanceof CommandError && e.code === c
/** 레이어 비트맵만 새로 만든 문서 (한 칸 = 그 비트맵 크기) */
const repaint = (d: Doc): Doc => ({ ...d, layers: d.layers.map((l) => ({ ...l, bitmap: l.bitmap && { ...l.bitmap, data: l.bitmap.data.slice() } })) })

// ── 이력 메모리 예산 ──
test('history budget counts shared bitmaps once and drops the oldest steps first', () => {
  const base = newDoc(512, 512) // 1MB
  let h = startHistory(base)
  const moved = { ...base, resolution: 144 } // 비트맵 공유 → 추가 비용 0
  h = record(h, moved, 'meta')
  assert.equal(historyBytes(h), 1 * MB)
  let d: Doc = moved
  for (let i = 0; i < 5; i++) {
    d = repaint(d)
    h = record(h, d, `paint${i}`, { budgetBytes: 3 * MB })
  }
  assert.ok(historyBytes(h) <= 3 * MB, `${historyBytes(h)} bytes`)
  assert.equal(h.label, 'paint4')
  assert.equal(h.past[h.past.length - 1].label, 'paint3')
  // 예산이 한 단계보다 작아도 직전 한 단계는 되돌릴 수 있다
  const tiny = record(h, repaint(d), 'big', { budgetBytes: 1 })
  assert.equal(tiny.past.length, 1)
  assert.equal(undo(tiny).present, d)
})

// ── Worker 취소·기한 ──
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  sent: Record<string, unknown>[] = []
  terminated = false
  postMessage(m: Record<string, unknown>) {
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
}
test('cancelling one worker request leaves the others running and drops the late reply', async () => {
  const w = new FakeWorker()
  const client = new WorkerClient<string>(() => w as unknown as Worker, 'crash')
  const ac = new AbortController()
  const progress: string[] = []
  const a = client.request<{ v: number }>({}, { signal: ac.signal, progress: (p) => progress.push(p) })
  const b = client.request<{ v: number }>({})
  ac.abort()
  await assert.rejects(a, WorkerCancelledError)
  assert.deepEqual(w.sent[2], { cancel: 1 })
  w.onmessage!({ data: { id: 1, progress: 'late' } })
  w.onmessage!({ data: { id: 1, v: 1 } })
  w.onmessage!({ data: { id: 2, v: 2 } })
  assert.equal((await b).v, 2)
  assert.deepEqual(progress, [])
  assert.equal(client.pendingCount, 0)
  assert.equal(w.terminated, false)
  await assert.rejects(client.request({}, { signal: AbortSignal.abort() }), WorkerCancelledError)
})
test('a timed-out worker request terminates the stuck worker and fails its siblings', async () => {
  const workers: FakeWorker[] = []
  let resets = 0
  const client = new WorkerClient(
    () => {
      const w = new FakeWorker()
      workers.push(w)
      return w as unknown as Worker
    },
    'crash',
    () => resets++
  )
  const slow = client.request({}, { timeoutMs: 20 })
  const other = client.request({})
  await assert.rejects(slow, WorkerTimeoutError)
  await assert.rejects(other, /crash/)
  assert.equal(workers[0].terminated, true)
  assert.equal(resets, 1)
  assert.equal(client.pendingCount, 0)
  const next = client.request<{ ok: boolean }>({})
  workers[1].onmessage!({ data: { id: 3, ok: true } })
  assert.equal((await next).ok, true)
})
test('shared encoding survives one consumer cancelling and stops when all consumers leave', async () => {
  let underlying: AbortSignal | null = null
  let finish!: (v: number) => void
  const job = new SharedJob<number>((signal) => {
    underlying = signal
    return new Promise<number>((r) => (finish = r))
  })
  const a = new AbortController()
  const b = new AbortController()
  const pa = job.join(a.signal)
  const pb = job.join(b.signal)
  a.abort()
  await assert.rejects(pa, WorkerCancelledError)
  assert.equal(underlying!.aborted, false)
  finish(7)
  assert.equal(await pb, 7)
  const lonely = new SharedJob<number>((signal) => {
    underlying = signal
    return new Promise<number>(() => {})
  })
  const c = new AbortController()
  const pc = lonely.join(c.signal)
  c.abort()
  await assert.rejects(pc, WorkerCancelledError)
  assert.equal(underlying!.aborted, true)
  assert.equal(lonely.cancelled, true)
})

// ── 탭에 묶인 커밋 ──
test('late results commit only to the tab and revision they were started from', () => {
  const store = new EditorStore()
  const aid = store.addTab(newDoc(4, 4), 'A')
  const rev = store.revisionOf(aid)!
  const signal = store.tabSignal(aid)
  const base = store.tab!.history.present
  const bid = store.addTab(newDoc(2, 2), 'B')
  // 다른 탭이 활성이어도 원래 탭에 들어간다
  assert.equal(store.commitTo(aid, rev, { ...base, resolution: 300 }, '배경 제거'), 'ok')
  assert.equal(store.state.tabs.find((t) => t.id === aid)!.history.present.resolution, 300)
  assert.equal(store.tab!.id, bid)
  assert.equal(store.tab!.history.present.width, 2)
  // 그사이 문서가 바뀌었으면 버린다
  assert.equal(store.commitTo(aid, rev, base, '늦은 결과'), 'conflict')
  store.closeTab(aid)
  assert.equal(signal.aborted, true)
  assert.equal(store.commitTo(aid, rev + 1, base, '닫힌 탭'), 'closed')
  assert.equal(store.tabSignal(aid).aborted, true)
})

// ── 명령 (UI 와 같은 결과) ──
test('commands validate input strictly and match the direct core edits', () => {
  const d = newDoc(40, 30)
  assert.throws(() => resizeCommand.parse({ width: 10 }), code('INVALID_INPUT'))
  assert.throws(() => resizeCommand.parse({ width: 10, height: 10, extra: 1 }), code('INVALID_INPUT'))
  assert.throws(() => resizeCommand.parse({ width: 10.5, height: 10 }), code('INVALID_INPUT'))
  assert.throws(() => resizeCommand.parse({ width: 30000, height: 30000 }), code('RESOURCE_LIMIT'))
  const r = resizeCommand.run(d, resizeCommand.parse({ width: 20, height: 15 }))
  assert.deepEqual(flattenDoc(r.doc).data, flattenDoc(resizeImage(d, 20, 15)).data)
  const layerId = d.layers[0].id
  const f = filterCommand.run(d, filterCommand.parse({ layerId, filter: 'addNoise', params: { amount: 20 }, seed: 3 }))
  const direct = adjustLayer(d, layerId, null, { blur: 0, motionDistance: 0, motionAngle: 0, noise: 20, noiseGaussian: true, noiseMono: false, lens: 0 }, 3)
  assert.deepEqual(getLayer(f.doc, layerId)!.bitmap!.data, getLayer(direct, layerId)!.bitmap!.data)
  assert.throws(() => filterCommand.parse({ layerId, filter: 'gaussianBlur', params: { radius: 500 } }), code('INVALID_INPUT'))
  assert.throws(() => filterCommand.parse({ layerId, filter: 'bogus' }), code('INVALID_INPUT'))
  assert.throws(() => layerUpdateCommand.parse({ layerId }), code('INVALID_INPUT'))
  const locked = layerUpdateCommand.run(d, layerUpdateCommand.parse({ layerId, lock: { position: true } })).doc
  assert.throws(() => layerUpdateCommand.run(locked, layerUpdateCommand.parse({ layerId, x: 5 })), code('FORBIDDEN'))
  assert.throws(() => layerUpdateCommand.run(d, layerUpdateCommand.parse({ layerId: 'nope', opacity: 0.5 })), code('NOT_FOUND'))
  assert.throws(() => cropCommand.run(d, cropCommand.parse({ x: 30, y: 0, width: 20, height: 10 })), code('INVALID_INPUT'))
  assert.equal(cropCommand.run(d, cropCommand.parse({ x: 10, y: 5, width: 20, height: 10 })).doc.width, 20)
})

// ── 서비스 계약 ──
const alice: Principal = { owner: 'alice', scopes: ['documents:read', 'documents:write'] }
const bob: Principal = { owner: 'bob', scopes: ['documents:read', 'documents:write'] }
const reader: Principal = { owner: 'alice', scopes: ['documents:read'] }
const done = async (svc: DocumentService, p: Principal, job: { jobId: string }) => svc.waitJob(p, job.jobId, 5000)

test('service commits by revision, isolates owners and replays operationIds', async () => {
  const svc = new DocumentService()
  const doc = svc.createDocument(alice, { width: 64, height: 48, name: 'poster' })
  assert.equal(doc.revision, 1)
  const job = await done(svc, alice, svc.startCommand(alice, 'image.resize', { docId: doc.docId, expectedRevision: 1, operationId: 'op-1', width: 32, height: 24 }))
  assert.equal(job.status, 'succeeded')
  assert.equal(job.result!.revision, 2)
  assert.equal(svc.getDocument(alice, { docId: doc.docId }).width, 32)
  // 같은 operationId + 같은 입력 = 같은 작업 (키 순서 무관)
  const again = svc.startCommand(alice, 'image.resize', { height: 24, width: 32, operationId: 'op-1', expectedRevision: 1, docId: doc.docId })
  assert.equal(again.jobId, job.jobId)
  assert.equal(again.result!.revision, 2)
  assert.equal(svc.getDocument(alice, { docId: doc.docId }).revision, 2)
  // 다른 입력으로 재사용하면 오류
  assert.throws(() => svc.startCommand(alice, 'image.resize', { docId: doc.docId, expectedRevision: 1, operationId: 'op-1', width: 10, height: 10 }), code('INVALID_INPUT'))
  // 낡은 revision
  assert.throws(() => svc.startCommand(alice, 'image.resize', { docId: doc.docId, expectedRevision: 1, operationId: 'op-2', width: 10, height: 10 }), code('REVISION_CONFLICT'))
  // 다른 사용자는 존재조차 모른다
  assert.throws(() => svc.getDocument(bob, { docId: doc.docId }), code('NOT_FOUND'))
  assert.throws(() => svc.startCommand(bob, 'image.resize', { docId: doc.docId, expectedRevision: 2, operationId: 'op-b', width: 10, height: 10 }), code('NOT_FOUND'))
  assert.throws(() => svc.getJob(bob, { jobId: job.jobId }), code('NOT_FOUND'))
  // 읽기 권한만으로는 바꿀 수 없다
  assert.throws(() => svc.startCommand(reader, 'image.resize', { docId: doc.docId, expectedRevision: 2, operationId: 'op-r', width: 10, height: 10 }), code('FORBIDDEN'))
  assert.equal(svc.getDocument(reader, { docId: doc.docId }).revision, 2)
  // 실행취소도 revision 을 올리는 변경
  const u = await done(svc, alice, svc.startHistoryStep(alice, 'undo', { docId: doc.docId, expectedRevision: 2, operationId: 'op-u' }))
  assert.equal(u.result!.revision, 3)
  assert.equal(svc.getDocument(alice, { docId: doc.docId }).width, 64)
  await svc.close()
})

test('service imports PNG uploads, exports any retained revision and enforces limits', async () => {
  const svc = new DocumentService({ limits: { maxUploadBytes: 64 * 1024, maxPixels: 100_000, maxDocsPerOwner: 2 } })
  const px = new Uint8ClampedArray(20 * 10 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256))
  const up = svc.uploadAsset(alice, encodePng(20, 10, px), { name: 'in.png' })
  assert.throws(() => svc.readAsset(bob, up.id), code('NOT_FOUND'))
  const doc = svc.importDocument(alice, { assetId: up.id })
  assert.deepEqual([doc.width, doc.height, doc.name], [20, 10, 'in'])
  const layerId = svc.listLayers(alice, { docId: doc.docId }).layers[0].id
  await done(svc, alice, svc.startCommand(alice, 'layer.update', { docId: doc.docId, expectedRevision: 1, operationId: 'o1', layerId, opacity: 0.5 }))
  const v1 = await done(svc, alice, svc.startExport(alice, { docId: doc.docId, revision: 1, format: 'png' }))
  const v2 = await done(svc, alice, svc.startExport(alice, { docId: doc.docId, format: 'png' }))
  const png1 = decodePng(svc.readAsset(alice, v1.result!.artifact!.id).bytes)
  const png2 = decodePng(svc.readAsset(alice, v2.result!.artifact!.id).bytes)
  assert.deepEqual(png1.data, px)
  assert.equal(png2.data[3], 128)
  assert.equal(v2.result!.revision, 2)
  const proj = await done(svc, alice, svc.startExport(alice, { docId: doc.docId, format: 'shcomp' }))
  assert.equal(unpackProject(svc.readAsset(alice, proj.result!.artifact!.id).bytes).layers[0].opacity, 0.5)
  // 한도: 업로드 바이트·디코딩 픽셀·문서 수·형식
  assert.throws(() => svc.uploadAsset(alice, new Uint8Array(65 * 1024), {}), code('RESOURCE_LIMIT'))
  assert.throws(() => svc.uploadAsset(alice, new TextEncoder().encode('GIF89a...'), {}), code('INVALID_INPUT'))
  const huge = svc.uploadAsset(alice, encodePng(1000, 200, new Uint8Array(1000 * 200 * 4)), {})
  assert.throws(() => svc.importDocument(alice, { assetId: huge.id }), code('RESOURCE_LIMIT'))
  svc.createDocument(alice, { width: 2, height: 2 })
  assert.throws(() => svc.createDocument(alice, { width: 2, height: 2 }), code('RESOURCE_LIMIT'))
  assert.throws(() => svc.createDocument(bob, { width: 1000, height: 1000 }), code('RESOURCE_LIMIT'))
  await svc.close()
})

/** 계산을 붙잡아 두는 실행기 — 취소·기한·동시 편집을 재현한다 */
class GatedRunner implements JobRunner {
  gates: (() => void)[] = []
  async run(task: Task, signal: AbortSignal): Promise<TaskResult> {
    await new Promise<void>((r) => this.gates.push(r))
    if (signal.aborted) throw Object.assign(new Error('x'), { code: 'CANCELLED' })
    return executeTask(task)
  }
  release(): void {
    for (const g of this.gates.splice(0)) g()
  }
}

test('service rejects a late result after a concurrent edit and supports cancel and timeout', async () => {
  const runner = new GatedRunner()
  const svc = new DocumentService({ runner, limits: { jobTimeoutMs: 200, maxConcurrentJobs: 2 } })
  const doc = svc.createDocument(alice, { width: 16, height: 16 })
  const layerId = svc.listLayers(alice, { docId: doc.docId }).layers[0].id
  const slow = svc.startCommand(alice, 'filter.apply', { docId: doc.docId, expectedRevision: 1, operationId: 'f1', layerId, filter: 'gaussianBlur', params: { radius: 2 } })
  const fast = svc.startCommand(alice, 'layer.update', { docId: doc.docId, expectedRevision: 1, operationId: 'l1', layerId, name: 'bg' })
  await new Promise((r) => setTimeout(r, 5))
  // 두 작업 모두 revision 1 에서 출발 — 먼저 끝난 쪽만 반영된다
  runner.gates.pop()!()
  assert.equal((await done(svc, alice, fast)).status, 'succeeded')
  runner.release()
  const late = await done(svc, alice, slow)
  assert.equal(late.status, 'failed')
  assert.equal(late.error!.code, 'REVISION_CONFLICT')
  assert.equal(svc.getDocument(alice, { docId: doc.docId }).revision, 2)
  // 커밋 전 취소
  const c = svc.startCommand(alice, 'filter.apply', { docId: doc.docId, expectedRevision: 2, operationId: 'f2', layerId, filter: 'mosaic', params: { cellSize: 4 } })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(svc.cancelJob(alice, { jobId: c.jobId }).status, 'cancelled')
  runner.release()
  assert.equal((await done(svc, alice, c)).status, 'cancelled')
  // 기한 초과
  const t = svc.startCommand(alice, 'filter.apply', { docId: doc.docId, expectedRevision: 2, operationId: 'f3', layerId, filter: 'mosaic', params: { cellSize: 4 } })
  const timedOut = await done(svc, alice, t)
  assert.equal(timedOut.error!.code, 'TIMEOUT')
  runner.release()
  assert.equal(svc.getDocument(alice, { docId: doc.docId }).revision, 2)
  await svc.close()
})

// ── 검토 반영 (v1.1.0) ──
test('worker boundary keeps unchanged bitmaps shared with the input document', () => {
  const d = newDoc(8, 8)
  const withTop = { ...d, layers: [...d.layers, { ...d.layers[0], id: 'top', bitmap: { ...d.layers[0].bitmap!, data: d.layers[0].bitmap!.data.slice() } }] }
  const out = filterCommand.run(withTop, filterCommand.parse({ layerId: 'top', filter: 'mosaic', params: { cellSize: 2 } })).doc
  // 구조적 복제를 흉내 — 모든 버퍼가 새로 생긴다
  const cloned = structuredClone(stripShared(withTop, out))
  const back = restoreShared(withTop, cloned, false)
  assert.equal(back.layers[0].bitmap, withTop.layers[0].bitmap)
  assert.notEqual(back.layers[1].bitmap, withTop.layers[1].bitmap)
  assert.deepEqual(back.layers[1].bitmap!.data, out.layers[1].bitmap!.data)
})
test('service rejects oversized results before computing and drops queued jobs of deleted documents', async () => {
  const runner = new GatedRunner()
  const svc = new DocumentService({ runner, limits: { maxPixels: 10_000, maxConcurrentJobs: 1 } })
  const doc = svc.createDocument(alice, { width: 50, height: 50 })
  assert.throws(() => svc.startCommand(alice, 'image.resize', { docId: doc.docId, expectedRevision: 1, operationId: 'big', width: 200, height: 200 }), code('RESOURCE_LIMIT'))
  const layerId = svc.listLayers(alice, { docId: doc.docId }).layers[0].id
  const a = svc.startCommand(alice, 'filter.apply', { docId: doc.docId, expectedRevision: 1, operationId: 'q1', layerId, filter: 'mosaic', params: { cellSize: 2 } })
  const b = svc.startCommand(alice, 'filter.apply', { docId: doc.docId, expectedRevision: 1, operationId: 'q2', layerId, filter: 'mosaic', params: { cellSize: 3 } })
  assert.equal(svc.getJob(alice, { jobId: b.jobId }).status, 'queued')
  svc.deleteDocument(alice, { docId: doc.docId })
  assert.equal(svc.getJob(alice, { jobId: a.jobId }).status, 'cancelled')
  assert.equal(svc.getJob(alice, { jobId: b.jobId }).status, 'cancelled')
  assert.deepEqual(svc.stats().jobsQueued, 0)
  runner.release()
  await svc.close()
})
test('quiet editor changes (active layer) do not invalidate long-running results', () => {
  const store = new EditorStore()
  const id = store.addTab(newDoc(4, 4), 'A')
  const rev = store.revisionOf(id)!
  store.quiet({ ...store.doc!, activeId: null })
  assert.equal(store.revisionOf(id), rev)
  store.commit({ ...store.doc!, resolution: 99 }, 'x')
  assert.equal(store.revisionOf(id), rev + 1)
})
