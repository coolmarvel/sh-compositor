/**
 * Request/reply lifecycle shared by encoding and AI workers. Document buffers remain owned by callers.
 *
 * - `signal` 취소는 그 요청만 끝낸다(soft): 일꾼에 `{ cancel: id }` 를 알리고 늦게 온 답·진행은 버린다. 다른 요청은 계속 돈다.
 * - `timeoutMs` 기한을 넘기면 일꾼이 멈춘 것으로 보고 끝낸다(hard): 일꾼을 종료하고 대기 중인 요청을 모두 실패시킨다.
 *   (한 스레드 일꾼은 돌고 있는 계산을 중간에 멈출 방법이 종료뿐이다. 다음 요청은 새 일꾼으로)
 */
export class WorkerUnavailableError extends Error {}
/** 호출측이 취소한 요청 */
export class WorkerCancelledError extends Error {
  readonly code = 'CANCELLED'
  constructor(message = '작업을 취소했습니다.') {
    super(message)
  }
}
/** 기한을 넘긴 요청 */
export class WorkerTimeoutError extends Error {
  readonly code = 'TIMEOUT'
  constructor(message = '작업 시간이 너무 오래 걸려 멈췄습니다.') {
    super(message)
  }
}
export interface RequestOptions<P> {
  progress?: (value: P) => void
  transfer?: Transferable[]
  signal?: AbortSignal
  timeoutMs?: number
}
interface Reply<P> {
  id: number
  error?: string
  progress?: P
}
interface Pending<P> {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  progress?: (value: P) => void
  cleanup: () => void
}
export class WorkerClient<P = never> {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending<P>>()
  constructor(
    private create: () => Worker,
    private failure: string,
    private onReset?: () => void
  ) {}
  /** 답을 기다리는 요청 수 (테스트·진단용) */
  get pendingCount(): number {
    return this.pending.size
  }
  private getWorker(): Worker {
    if (this.worker) return this.worker
    let worker: Worker
    try {
      worker = this.create()
    } catch (error) {
      throw new WorkerUnavailableError(error instanceof Error ? error.message : this.failure)
    }
    this.worker = worker
    worker.onmessage = (event: MessageEvent<Reply<P>>) => {
      const message = event.data,
        job = this.pending.get(message.id)
      if (!job) return
      if (message.progress !== undefined) {
        job.progress?.(message.progress)
        return
      }
      this.settle(message.id)
      if (message.error !== undefined) job.reject(new Error(message.error))
      else job.resolve(message)
    }
    worker.onerror = () => this.dispose(new Error(this.failure))
    worker.onmessageerror = () => this.dispose(new Error(this.failure))
    return worker
  }
  private settle(id: number): void {
    const job = this.pending.get(id)
    if (!job) return
    this.pending.delete(id)
    job.cleanup()
  }
  request<T>(message: object, options: RequestOptions<P> = {}): Promise<T> {
    const { progress, transfer = [], signal, timeoutMs } = options
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) return reject(new WorkerCancelledError())
      let worker: Worker
      try {
        worker = this.getWorker()
      } catch (error) {
        return reject(error)
      }
      const id = ++this.seq
      let timer: ReturnType<typeof setTimeout> | null = null
      const onAbort = (): void => {
        if (!this.pending.has(id)) return
        this.settle(id)
        try {
          this.worker?.postMessage({ cancel: id })
        } catch {
          /* 일꾼이 이미 사라짐 */
        }
        reject(new WorkerCancelledError())
      }
      const cleanup = (): void => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, progress, cleanup })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (timeoutMs !== undefined && timeoutMs > 0)
        timer = setTimeout(() => {
          const job = this.pending.get(id)
          if (!job) return
          this.settle(id)
          job.reject(new WorkerTimeoutError())
          // 멈춘 계산을 끝낼 방법은 종료뿐 — 같은 일꾼의 다른 요청도 실패로 정리된다
          this.dispose(new Error(this.failure))
        }, timeoutMs)
      try {
        worker.postMessage({ ...message, id }, transfer)
      } catch (error) {
        this.settle(id)
        reject(error)
      }
    })
  }
  dispose(error = new Error(this.failure)): void {
    const worker = this.worker
    this.worker = null
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    }
    const jobs = [...this.pending.values()]
    this.pending.clear()
    for (const job of jobs) {
      job.cleanup()
      job.reject(error)
    }
    this.onReset?.()
  }
}

/**
 * 여러 소비자가 나눠 쓰는 작업 하나 — 한 소비자의 취소는 그 소비자만 끝낸다.
 * 모든 소비자가 취소하면 밑의 작업도 취소한다 (아무도 결과를 기다리지 않으므로).
 */
export class SharedJob<T> {
  private readonly controller = new AbortController()
  private consumers = 0
  readonly promise: Promise<T>
  constructor(start: (signal: AbortSignal) => Promise<T>) {
    this.promise = start(this.controller.signal)
    // 소비자가 모두 떠난 뒤의 실패는 아무도 보지 않는다
    this.promise.catch(() => {})
  }
  /** 모든 소비자가 떠나 취소된 작업 — 새 소비자는 새 작업을 시작해야 한다 */
  get cancelled(): boolean {
    return this.controller.signal.aborted
  }
  join(signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new WorkerCancelledError())
    this.consumers++
    if (!signal) return this.promise
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        this.leave()
        reject(new WorkerCancelledError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.promise.then(
        (v) => {
          signal.removeEventListener('abort', onAbort)
          resolve(v)
        },
        (e) => {
          signal.removeEventListener('abort', onAbort)
          reject(e)
        }
      )
    })
  }
  private leave(): void {
    this.consumers--
    if (this.consumers <= 0) this.controller.abort()
  }
}
