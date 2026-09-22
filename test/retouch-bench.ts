/** npm exec tsx test/retouch-bench.ts; compute + transfer only, excludes rendering. */
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import * as old from './retouch-reference'
import * as cpu from '../src/core/retouch'
import { RetouchWasm, type RetouchMode } from '../src/core/retouchWasm'
async function main() {
  const wasm = await RetouchWasm.create(readFileSync('src/renderer/src/assets/retouch.wasm'))
  try {
    const width = 4000,
      height = 3000,
      data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i++) data[i] = (i * 17 + (i >>> 12)) & 255
    for (const mode of ['blur', 'smudge', 'liquify'] as RetouchMode[]) {
      const row: Record<string, number | string> = { mode }
      for (const backend of ['original', 'cropped-ts', 'rust-wasm']) {
        const s: cpu.RetouchSession = { live: { width, height, data: data.slice() }, stroke: { settings: { size: 120, hardness: 0.8, opacity: 0.7 } } }
        const ref = backend === 'original' ? old : cpu
        const times: number[] = []
        for (let i = 0; i < 45; i++) {
          const a = { x: 500 + i * 3, y: 500 + i * 2 },
            b = { x: a.x + 3, y: a.y + 2 },
            start = performance.now()
          if (backend === 'rust-wasm') wasm.dab(s, mode, a, b)
          else if (mode === 'blur') ref.blurDab(s, b.x, b.y)
          else if (mode === 'smudge') ref.smudgeDab(s, a, b)
          else ref.pushDab(s, a, b)
          if (i >= 5) times.push(performance.now() - start)
        }
        times.sort((a, b) => a - b)
        row[backend + ' median ms'] = +times[20].toFixed(3)
        row[backend + ' p95 ms'] = +times[38].toFixed(3)
      }
      console.log(JSON.stringify(row))
    }
  } finally {
    wasm.dispose()
  }
}
void main()
