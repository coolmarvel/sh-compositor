/** 서버(메인·작업 스레드)에서 Rust 커널 로드 — 번들 옆의 kernels.wasm. 없으면 TS 기준 경로 (성능만 다르고 결과는 같다) */
import { readFileSync } from 'node:fs'
import { Kernels } from '../core/kernels'
import { RetouchWasm } from '../core/retouchWasm'
import { setNativeKernels } from '../core/filters'
import { setNativeRetouch } from '../core/retouch'

export function loadKernels(): boolean {
  try {
    const bytes = readFileSync(new URL('./kernels.wasm', import.meta.url))
    // WebAssembly.Module 동기 컴파일 — 시작 시 한 번, 25KB
    const module = new WebAssembly.Module(bytes)
    const k = new Kernels(new WebAssembly.Instance(module, {}).exports as never)
    const r = new RetouchWasm(new WebAssembly.Instance(module, {}).exports as never)
    setNativeKernels(k)
    setNativeRetouch((s, mode, a, b) => r.dab(s, mode, a, b))
    return true
  } catch {
    return false
  }
}
