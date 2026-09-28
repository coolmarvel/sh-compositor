/** kernels.wasm 하나를 리터칭 dab 과 필터 커널이 나눠 쓴다. 못 받으면 둘 다 TS 기준 경로 */
import wasmUrl from '../assets/kernels.wasm?url'
import { RetouchWasm, type RetouchMode } from '@core/retouchWasm'
import { Kernels } from '@core/kernels'
import { setNativeKernels } from '@core/filters'
import { setNativeRetouch } from '@core/retouch'
import type { RetouchSession } from '@core/retouch'
let engine: RetouchWasm | null = null
export let kernels: Kernels | null = null
export const retouchReady = fetch(wasmUrl)
  .then((r) => {
    if (!r.ok) throw new Error(`Kernels WASM: ${r.status}`)
    return r.arrayBuffer()
  })
  .then(async (bytes) => {
    const value = await RetouchWasm.create(bytes)
    kernels = await Kernels.create(bytes)
    setNativeKernels(kernels)
    setNativeRetouch((s, mode, a, b) => nativeRetouch(s, mode, a, b))
    return value
  })
  .then((value) => {
    engine = value
    return true
  })
  .catch((error) => {
    console.warn('Retouch WASM unavailable; using CPU reference', error)
    return false
  })
export function nativeRetouch(s: RetouchSession, mode: RetouchMode, from: { x: number; y: number }, to: { x: number; y: number }) {
  if (!engine) return undefined
  try {
    return engine.dab(s, mode, from, to)
  } catch (error) {
    engine.dispose()
    engine = null
    console.warn('Retouch WASM failed; using CPU reference', error)
    return undefined
  }
}
