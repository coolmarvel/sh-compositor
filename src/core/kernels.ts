/**
 * Rust WASM 커널 브리지 (`native/kernels/kernel.rs` → assets/kernels.wasm). 리터칭 dab 은 `retouchWasm.ts`(같은 wasm) 가 쓴다.
 * 여기: 가우시안 블러 · 중간값 (닷지/번/스펀지는 복사 비용 때문에 TS — test/kernel-bench.ts). 재사용 작업 메모리 하나 — 문서·이력 버퍼는 절대 WASM 메모리에 두지 않는다.
 * 실패(메모리 부족·인스턴스 오류)하면 호출측이 TS 기준 경로로 돌아간다 (`filters.ts setNativeKernels`).
 */

interface Exports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  allocate: (bytes: number) => number
  release: (ptr: number, bytes: number) => void
  gaussian_blur: (src: number, out: number, w: number, h: number, sigma: number) => void
  median: (src: number, out: number, w: number, h: number, r: number) => void
}

export interface NativeKernels {
  gaussianBlur(rgba: Uint8ClampedArray, width: number, height: number, sigma: number): Uint8ClampedArray
  median(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray
}

/** 이보다 작은 그림은 WASM 왕복 복사가 더 비싸다 (벤치마크 기준) */
export const NATIVE_MIN_PIXELS = 64 * 64

export class Kernels implements NativeKernels {
  private ptr = 0
  private capacity = 0
  constructor(private k: Exports) {}
  static async create(bytes: BufferSource): Promise<Kernels> {
    const { instance } = await WebAssembly.instantiate(bytes, {})
    return new Kernels(instance.exports as Exports)
  }
  dispose(): void {
    if (this.ptr) this.k.release(this.ptr, this.capacity)
    this.ptr = this.capacity = 0
  }
  private scratch(bytes: number): number {
    if (bytes > this.capacity) {
      this.dispose()
      this.capacity = Math.ceil(bytes / 65536) * 65536
      this.ptr = this.k.allocate(this.capacity)
      if (!this.ptr) {
        this.capacity = 0
        throw new Error('WASM scratch allocation failed')
      }
    }
    return this.ptr
  }
  gaussianBlur(rgba: Uint8ClampedArray, width: number, height: number, sigma: number): Uint8ClampedArray {
    const n = rgba.length
    const p = this.scratch(n * 2)
    // 커널이 Vec 으로 f32 사본 2개를 더 잡는다 (n×8 바이트) — 메모리 증가는 instantiate 된 메모리가 스스로 늘린다
    new Uint8Array(this.k.memory.buffer, p, n).set(rgba)
    this.k.gaussian_blur(p, p + n, width, height, sigma)
    return new Uint8ClampedArray(new Uint8Array(this.k.memory.buffer, p + n, n))
  }
  median(rgba: Uint8ClampedArray, width: number, height: number, radius: number): Uint8ClampedArray {
    const n = rgba.length
    const p = this.scratch(n * 2)
    new Uint8Array(this.k.memory.buffer, p, n).set(rgba)
    this.k.median(p, p + n, width, height, radius)
    return new Uint8ClampedArray(new Uint8Array(this.k.memory.buffer, p + n, n))
  }
}

/** TS 기준 구현으로 같은 인터페이스 (커널이 없을 때·테스트 비교용) */
export const tsKernels: NativeKernels = {
  gaussianBlur: (rgba, w, h, s) => tsGaussian(rgba, w, h, s),
  median: (rgba, w, h, r) => tsMedian(rgba, w, h, r)
}
// filters.ts 가 순환 import 없이 기준 구현을 등록한다
let tsGaussian: NativeKernels['gaussianBlur'] = () => {
  throw new Error('filters not registered')
}
let tsMedian: NativeKernels['median'] = () => {
  throw new Error('filters not registered')
}
export function registerReference(g: NativeKernels['gaussianBlur'], m: NativeKernels['median']): void {
  tsGaussian = g
  tsMedian = m
}
