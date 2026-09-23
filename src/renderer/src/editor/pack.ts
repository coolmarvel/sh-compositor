/** Serialize outside the UI thread. Concurrent requests for the same immutable snapshot share one job. */
import { packProject, docToPsd, type Doc } from '@core/index'
import { WorkerClient, WorkerUnavailableError, SharedJob } from '../util/workerClient'
const client = new WorkerClient(() => new Worker(new URL('./packWorker.ts', import.meta.url), { type: 'module' }), '저장 일꾼이 멈췄습니다.')
type Format = 'shcomp' | 'psd'
type Result = { bytes: Uint8Array; warnings: string[] }
const pending = new WeakMap<Doc, Map<Format, SharedJob<Result>>>()
/**
 * 문서를 .shcomp·PSD 바이트로. `signal` 로 이 호출만 그만 기다릴 수 있다 (같은 문서를 기다리는 다른 저장은 계속).
 * 모두가 취소하면 일꾼 요청도 취소한다. 일꾼을 못 쓰면 화면 스레드에서 만든다.
 */
export function packDoc(doc: Doc, op: Format, signal?: AbortSignal): Promise<Result> {
  // 이미 취소된 요청으로 소비자 없는 작업을 시작하지 않는다
  if (signal?.aborted) return new SharedJob<Result>(() => new Promise(() => {})).join(signal)
  let formats = pending.get(doc)
  if (!formats) {
    formats = new Map()
    pending.set(doc, formats)
  }
  let job = formats.get(op)
  if (!job || job.cancelled) {
    const d = { ...doc, selection: null }
    const shared = new SharedJob<Result>((jobSignal) =>
      client
        .request<Result>({ op, doc: d }, { signal: jobSignal })
        .catch((error) => {
          if (!(error instanceof WorkerUnavailableError)) throw error
          return op === 'psd' ? docToPsd(d) : { bytes: packProject(d), warnings: [] }
        })
        .finally(() => {
          if (formats!.get(op) === shared) formats!.delete(op)
        })
    )
    job = shared
    formats.set(op, job)
  }
  return job.join(signal)
}
