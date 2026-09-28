import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Kernels, tsKernels } from '../src/core/kernels'
import { gaussianBlur, medianFilter, setNativeKernels, hasNativeKernels } from '../src/core/filters'

const W = 97
const H = 61
const data = new Uint8ClampedArray(W * H * 4)
for (let i = 0; i < data.length; i++) data[i] = (i * 131 + (i >>> 7) * 17) & 255
for (let i = 3; i < data.length; i += 8) data[i] = i & 255 // 투명도 섞기
const maxDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

test('Rust kernels match the TypeScript reference within 1 byte (blur, median)', async () => {
  const wasm = await Kernels.create(readFileSync('src/renderer/src/assets/kernels.wasm'))
  try {
    for (const sigma of [1, 3.5, 12]) assert.ok(maxDiff(tsKernels.gaussianBlur(data, W, H, sigma), wasm.gaussianBlur(data, W, H, sigma)) <= 1, `blur σ=${sigma}`)
    for (const r of [1, 3]) assert.equal(maxDiff(tsKernels.median(data, W, H, r), wasm.median(data, W, H, r)), 0, `median r=${r}`)
    // filters.ts 가 커널을 쓰고, 실패하면 TS 로 되돌아간다
    setNativeKernels(wasm)
    assert.ok(hasNativeKernels())
    assert.ok(maxDiff(gaussianBlur(data, W, H, 2), tsKernels.gaussianBlur(data, W, H, 2)) <= 1)
    assert.equal(maxDiff(medianFilter(data, W, H, 2), tsKernels.median(data, W, H, 2)), 0)
    setNativeKernels({
      gaussianBlur: () => {
        throw new Error('boom')
      },
      median: () => {
        throw new Error('boom')
      }
    })
    assert.equal(maxDiff(gaussianBlur(data, W, H, 2), tsKernels.gaussianBlur(data, W, H, 2)), 0)
    assert.ok(!hasNativeKernels(), '깨진 커널은 버린다')
  } finally {
    setNativeKernels(null)
    wasm.dispose()
  }
})
