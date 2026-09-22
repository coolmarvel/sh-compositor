import wasmUrl from '../assets/retouch.wasm?url'
import { RetouchWasm, type RetouchMode } from '@core/retouchWasm'
import type { RetouchSession } from '@core/retouch'
let engine: RetouchWasm | null = null
export const retouchReady = fetch(wasmUrl)
  .then((r) => {
    if (!r.ok) throw new Error(`Retouch WASM: ${r.status}`)
    return r.arrayBuffer()
  })
  .then((bytes) => RetouchWasm.create(bytes))
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
