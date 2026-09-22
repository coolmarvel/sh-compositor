import { snapshot, type RetouchSession } from './retouch'
type Pt = { x: number; y: number }
export type RetouchMode = 'blur' | 'smudge' | 'liquify'
interface Kernel extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  allocate: (bytes: number) => number
  release: (ptr: number, bytes: number) => void
  dab: (...args: number[]) => void
}
/** One reusable, bounded scratch allocation; JS document/history never use WASM memory. */
export class RetouchWasm {
  private ptr = 0
  private capacity = 0
  constructor(private kernel: Kernel) {}
  static async create(bytes: BufferSource): Promise<RetouchWasm> {
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return new RetouchWasm(instance.exports as Kernel)
  }
  dispose(): void {
    if (this.ptr) this.kernel.release(this.ptr, this.capacity)
    this.ptr = this.capacity = 0
  }
  dab(s: RetouchSession, mode: RetouchMode, from: Pt, to: Pt) {
    const {
      live,
      stroke: { settings }
    } = s
    const R = mode === 'blur' ? settings.size / 2 : Math.max(1, settings.size / 2)
    const x0 = Math.max(0, Math.floor(to.x - R)),
      y0 = Math.max(0, Math.floor(to.y - R))
    const x1 = Math.min(live.width - 1, Math.ceil(to.x + R)),
      y1 = Math.min(live.height - 1, Math.ceil(to.y + R))
    if (x1 < x0 || y1 < y0) return null
    const dx = to.x - from.x,
      dy = to.y - from.y
    const k = Math.max(1, Math.round(R / 6))
    const patch =
      mode === 'blur' ? snapshot(live, x0 - k, y0 - k, x1 + k, y1 + k) : snapshot(live, x0 - Math.max(0, dx) - 1, y0 - Math.max(0, dy) - 1, x1 - Math.min(0, dx) + 1, y1 - Math.min(0, dy) + 1)
    const w = x1 - x0 + 1,
      h = y1 - y0 + 1,
      count = w * h
    const outOffset = patch.data.length
    const weightOffset = Math.ceil((outOffset + count * 4) / 8) * 8
    const bytes = weightOffset + count * 8
    if (bytes > this.capacity) {
      this.dispose()
      this.capacity = Math.ceil(bytes / 65536) * 65536
      this.ptr = this.kernel.allocate(this.capacity)
      if (!this.ptr) {
        this.capacity = 0
        throw new Error('Retouch scratch allocation failed')
      }
    }
    const mem = this.kernel.memory.buffer
    new Uint8Array(mem, this.ptr, patch.data.length).set(patch.data)
    const weights = new Float64Array(mem, this.ptr + weightOffset, count)
    if (s.limit) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) weights[y * w + x] = s.limit((y0 + y) * live.width + x0 + x)
    } else weights.fill(1)
    this.kernel.dab(
      this.ptr,
      this.ptr + outOffset,
      this.ptr + weightOffset,
      patch.width,
      patch.height,
      patch.x,
      patch.y,
      x0,
      y0,
      w,
      h,
      mode === 'blur' ? 0 : mode === 'smudge' ? 1 : 2,
      to.x,
      to.y,
      dx,
      dy,
      R,
      settings.hardness,
      settings.opacity
    )
    const output = new Uint8Array(mem, this.ptr + outOffset, count * 4)
    for (let y = 0; y < h; y++) live.data.set(output.subarray(y * w * 4, (y + 1) * w * 4), ((y0 + y) * live.width + x0) * 4)
    return { x: x0, y: y0, w, h }
  }
}
