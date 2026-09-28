/** node --import tsx test/kernel-bench.ts — TS 기준 vs Rust WASM (계산+전달, 렌더링 제외). 채택 기준: 중앙값 1.5배 이상 빠를 때만 */
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { Kernels, tsKernels } from '../src/core/kernels'
import '../src/core/filters'

const time = (fn: () => void, n = 5): number => {
  const t: number[] = []
  fn()
  for (let i = 0; i < n; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return +t[n >> 1].toFixed(2)
}
async function main(): Promise<void> {
  const wasm = await Kernels.create(readFileSync('src/renderer/src/assets/kernels.wasm'))
  const sizes = process.env.SMALL
    ? [[512, 512]]
    : [
        [2000, 1500],
        [4000, 3000]
      ]
  for (const [w, h] of sizes) {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >>> 10)) & 255
    for (const sigma of [2, 10])
      console.log(
        JSON.stringify({ kernel: 'gaussianBlur', size: `${w}x${h}`, sigma, ts_ms: time(() => tsKernels.gaussianBlur(data, w, h, sigma)), wasm_ms: time(() => wasm.gaussianBlur(data, w, h, sigma)) })
      )
    for (const r of [2, 5])
      console.log(JSON.stringify({ kernel: 'median', size: `${w}x${h}`, r, ts_ms: time(() => tsKernels.median(data, w, h, r), 3), wasm_ms: time(() => wasm.median(data, w, h, r), 3) }))
  }
  wasm.dispose()
}
void main()
