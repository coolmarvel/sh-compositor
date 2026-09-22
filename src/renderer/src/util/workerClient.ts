/** Request/reply lifecycle shared by encoding and AI workers. Document buffers remain owned by callers. */
export class WorkerUnavailableError extends Error {}
interface Reply<P> {
  id: number
  error?: string
  progress?: P
}
export class WorkerClient<P = never> {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; progress?: (value: P) => void }>()
  constructor(
    private create: () => Worker,
    private failure: string,
    private onReset?: () => void
  ) {}
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
      this.pending.delete(message.id)
      if (message.error !== undefined) job.reject(new Error(message.error))
      else job.resolve(message)
    }
    worker.onerror = () => this.dispose(new Error(this.failure))
    worker.onmessageerror = () => this.dispose(new Error(this.failure))
    return worker
  }
  request<T>(message: object, progress?: (value: P) => void, transfer: Transferable[] = []): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const worker = this.getWorker(),
        id = ++this.seq
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, progress })
      try {
        worker.postMessage({ ...message, id }, transfer)
      } catch (error) {
        this.pending.delete(id)
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
    for (const job of this.pending.values()) job.reject(error)
    this.pending.clear()
    this.onReset?.()
  }
}
