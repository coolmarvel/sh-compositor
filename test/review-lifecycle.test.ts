import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RecoveryWriter, type RecoverySnapshot } from '../src/renderer/src/util/recoveryWriter'
import { WorkerClient, WorkerUnavailableError } from '../src/renderer/src/util/workerClient'
import { EditorStore } from '../src/renderer/src/editor/store'
import { newDoc } from '../src/core/doc/ops'
const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const snapshot = (): RecoverySnapshot<object> => ({ id: 'a', name: 'a', path: null, doc: {}, dirty: true })
test('autosave coalesces overlapping ticks and ignores tabs closed during encoding', async () => {
  let tabs = [snapshot()],
    packs = 0,
    writes = 0
  const gate = deferred<Uint8Array>()
  const writer = new RecoveryWriter(
    () => tabs,
    () => {
      packs++
      return gate.promise
    },
    async () => {
      writes++
    },
    async () => {}
  )
  const first = writer.run()
  assert.equal(writer.run(), first)
  tabs = []
  gate.resolve(new Uint8Array(1))
  await first
  assert.equal(packs, 1)
  assert.equal(writes, 0)
})
test('autosave keeps dirty newer edits and waits for writes before shutdown cleanup', async () => {
  const first = snapshot()
  let tabs = [first],
    writes = 0,
    clears = 0
  const gate = deferred<void>()
  const writer = new RecoveryWriter(
    () => tabs,
    async () => new Uint8Array(1),
    async () => {
      writes++
      await gate.promise
    },
    async () => {
      clears++
    }
  )
  const run = writer.run()
  await Promise.resolve()
  await Promise.resolve()
  tabs = [{ ...first, doc: {} }]
  gate.resolve()
  await run
  await writer.run()
  assert.equal(writes, 2)
  await writer.shutdown()
  assert.equal(clears, 1)
  await writer.run()
  assert.equal(writes, 2)
})
test('autosave shutdown cannot leave a late recovery write behind', async () => {
  const tabs = [snapshot()],
    gate = deferred<void>()
  const events: string[] = []
  const writer = new RecoveryWriter(
    () => tabs,
    async () => new Uint8Array(1),
    async () => {
      events.push('write-start')
      await gate.promise
      events.push('write-end')
    },
    async () => {
      events.push('clear')
    }
  )
  const run = writer.run()
  await Promise.resolve()
  await Promise.resolve()
  const end = writer.shutdown()
  gate.resolve()
  await Promise.all([run, end])
  assert.deepEqual(events, ['write-start', 'write-end', 'clear'])
})
test('save marks the captured revision in the original tab, retaining unsaved later edits', () => {
  const store = new EditorStore()
  const a = newDoc(3, 3)
  store.addTab(a, 'A')
  const aid = store.tab!.id
  const changed = { ...a, resolution: 144 }
  store.commit(changed, 'change')
  store.addTab(newDoc(2, 2), 'B')
  const bid = store.tab!.id
  store.markSaved(aid, a, 'a.shcomp', 'A')
  const tab = store.state.tabs.find((t) => t.id === aid)!
  assert.equal(tab.saved, a)
  assert.equal(tab.history.present, changed)
  assert.equal(store.isDirty(tab), true)
  assert.equal(store.tab!.id, bid)
  assert.equal(store.tab!.path, null)
  store.closeTab(aid)
  store.markSaved(aid, a, 'late.shcomp', 'late')
  assert.equal(store.state.tabs.length, 1)
})
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  sent: { id: number }[] = []
  terminated = false
  failSend = false
  postMessage(m: { id: number }) {
    if (this.failSend) throw new Error('clone')
    this.sent.push(m)
  }
  terminate() {
    this.terminated = true
  }
}
test('worker routes out-of-order replies, progress and resets all requests after a crash', async () => {
  const workers: FakeWorker[] = []
  const client = new WorkerClient<string>(() => {
    const w = new FakeWorker()
    workers.push(w)
    return w as unknown as Worker
  }, 'crash')
  const progress: string[] = []
  const a = client.request<{ value: number }>({}, (p) => progress.push(p)),
    b = client.request<{ value: number }>({})
  workers[0].onmessage!({ data: { id: 1, progress: 'loading' } })
  workers[0].onmessage!({ data: { id: 2, value: 2 } })
  workers[0].onmessage!({ data: { id: 1, value: 1 } })
  assert.equal((await a).value, 1)
  assert.equal((await b).value, 2)
  assert.deepEqual(progress, ['loading'])
  const c = client.request({}),
    d = client.request({})
  const failures = [assert.rejects(c, /crash/), assert.rejects(d, /crash/)]
  workers[0].onerror!()
  await Promise.all(failures)
  assert.equal(workers[0].terminated, true)
  const e = client.request({})
  assert.equal(workers.length, 2)
  workers[1].onmessage!({ data: { id: 5 } })
  await e
  workers[1].failSend = true
  await assert.rejects(client.request({}), /clone/)
  client.dispose()
})
test('worker factory failure is distinguishable from processing errors', async () => {
  const client = new WorkerClient(() => {
    throw new Error('unavailable')
  }, 'crash')
  await assert.rejects(client.request({}), WorkerUnavailableError)
})
