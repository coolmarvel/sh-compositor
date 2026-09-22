/** Serialize outside the UI thread. Concurrent requests for the same immutable snapshot share one job. */
import { packProject, docToPsd, type Doc } from '@core/index'
import { WorkerClient, WorkerUnavailableError } from '../util/workerClient'
const client = new WorkerClient(() => new Worker(new URL('./packWorker.ts', import.meta.url), { type: 'module' }), '저장 일꾼이 멈췄습니다.')
type Format = 'shcomp' | 'psd'
type Result = { bytes: Uint8Array; warnings: string[] }
const pending = new WeakMap<Doc, Map<Format, Promise<Result>>>()
export function packDoc(doc: Doc, op: Format): Promise<Result> {
  let formats = pending.get(doc)
  if (!formats) {
    formats = new Map()
    pending.set(doc, formats)
  }
  const previous = formats.get(op)
  if (previous) return previous
  const d = { ...doc, selection: null }
  const job = client
    .request<Result>({ op, doc: d })
    .catch((error) => {
      if (!(error instanceof WorkerUnavailableError)) throw error
      return op === 'psd' ? docToPsd(d) : { bytes: packProject(d), warnings: [] }
    })
    .finally(() => {
      formats!.delete(op)
    })
  formats.set(op, job)
  return job
}
