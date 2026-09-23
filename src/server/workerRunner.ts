/**
 * worker_threads 실행기 — CPU 계산을 이벤트 루프 밖에서. 취소·기한(service 가 signal 을 abort)이 오면 스레드를 종료한다.
 * 동시 실행 수는 service 의 maxConcurrentJobs 가 정한다 (이 실행기는 요청마다 스레드 하나).
 */
import { Worker } from 'node:worker_threads'
import { restoreShared, type JobRunner, type Task, type TaskResult } from '../application/jobs'
import { CommandError, type ErrorCode } from '../application/errors'

export class WorkerThreadRunner implements JobRunner {
  private live = new Set<Worker>()
  constructor(
    private entry: URL,
    private heapMb: number
  ) {}
  get active(): number {
    return this.live.size
  }
  run(task: Task, signal: AbortSignal): Promise<TaskResult> {
    return new Promise<TaskResult>((resolve, reject) => {
      if (signal.aborted) return reject(new CommandError('CANCELLED', '작업을 취소했습니다.'))
      const worker = new Worker(this.entry, { resourceLimits: { maxOldGenerationSizeMb: this.heapMb } })
      this.live.add(worker)
      let settled = false
      const done = (fn: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        this.live.delete(worker)
        void worker.terminate()
        fn()
      }
      const onAbort = (): void => done(() => reject(new CommandError('CANCELLED', '작업을 취소했습니다.')))
      signal.addEventListener('abort', onAbort, { once: true })
      worker.once('message', (m: { ok: true; result: TaskResult; keptSelection: boolean } | { ok: false; error: { code: ErrorCode; message: string; details?: Record<string, unknown> } }) =>
        done(() => {
          if (!m.ok) return reject(new CommandError(m.error.code, m.error.message, m.error.details))
          const r = m.result
          resolve(r.type === 'command' && task.type === 'command' ? { ...r, doc: restoreShared(task.doc, r.doc, m.keptSelection) } : r)
        })
      )
      // 메모리 초과(ERR_WORKER_OUT_OF_MEMORY)·예외 — 내부 문구는 숨긴다
      worker.once('error', (e: Error & { code?: string }) =>
        done(() => reject(e.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new CommandError('RESOURCE_LIMIT', '작업이 메모리 한도를 넘었습니다.') : new CommandError('INTERNAL', '작업을 처리하지 못했습니다.')))
      )
      worker.once('exit', (code) => done(() => reject(new CommandError('INTERNAL', `작업 스레드가 끝났습니다 (${code}).`))))
      worker.postMessage(task)
    })
  }
  async close(): Promise<void> {
    await Promise.all([...this.live].map((w) => w.terminate()))
    this.live.clear()
  }
}
