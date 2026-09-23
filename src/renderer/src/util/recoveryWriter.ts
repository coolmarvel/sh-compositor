export interface RecoverySnapshot<T> {
  id: string
  name: string
  path: string | null
  doc: T
  dirty: boolean
}
/** Serialize autosave ticks and recheck tab lifetime after every async write. */
export class RecoveryWriter<T extends object> {
  private written = new Map<string, T>()
  private active: Promise<void> | null = null
  private closed = false
  /** 종료하면 돌고 있는 인코딩을 그만 기다린다 (쓰기는 끝까지 기다린다 — 반쯤 쓴 복구본을 남기지 않게) */
  private readonly stop = new AbortController()
  constructor(
    private snapshots: () => RecoverySnapshot<T>[],
    private pack: (doc: T, signal: AbortSignal) => Promise<Uint8Array>,
    private write: (snapshot: RecoverySnapshot<T>, bytes: Uint8Array) => Promise<void>,
    private clear: (id: string) => Promise<void>
  ) {}
  run(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.active) return this.active
    this.active = this.tick().finally(() => {
      this.active = null
    })
    return this.active
  }
  private async remove(id: string): Promise<void> {
    await this.clear(id)
    this.written.delete(id)
  }
  private async tick(): Promise<void> {
    for (const snapshot of this.snapshots()) {
      if (this.closed) break
      try {
        if (!snapshot.dirty) {
          if (this.written.has(snapshot.id)) await this.remove(snapshot.id)
          continue
        }
        if (this.written.get(snapshot.id) === snapshot.doc) continue
        const bytes = await this.pack(snapshot.doc, this.stop.signal)
        const current = this.snapshots().find((t) => t.id === snapshot.id)
        if (this.closed || !current?.dirty) continue
        await this.write(snapshot, bytes)
        this.written.set(snapshot.id, snapshot.doc)
        const after = this.snapshots().find((t) => t.id === snapshot.id)
        if (!after?.dirty) await this.remove(snapshot.id)
      } catch {
        /* Retry unchanged snapshots on the next tick after disk/worker errors. */
      }
    }
    const alive = new Set(this.snapshots().map((t) => t.id))
    for (const id of this.written.keys())
      if (!alive.has(id)) {
        try {
          await this.remove(id)
        } catch {
          /* Retry next tick. */
        }
      }
  }
  async shutdown(): Promise<void> {
    this.closed = true
    this.stop.abort()
    await this.active
    for (const id of this.written.keys()) {
      try {
        await this.remove(id)
      } catch {
        /* Recovery is safer than deleting an unknown file. */
      }
    }
  }
}
