import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as old from './retouch-reference'
import * as cpu from '../src/core/retouch'
import { RetouchWasm, type RetouchMode } from '../src/core/retouchWasm'
const modes: RetouchMode[] = ['blur', 'smudge', 'liquify']
const run = (m: RetouchMode, s: cpu.RetouchSession, a: { x: number; y: number }, b: { x: number; y: number }, ref = cpu) =>
  m === 'blur' ? ref.blurDab(s, b.x, b.y) : m === 'smudge' ? ref.smudgeDab(s, a, b) : ref.pushDab(s, a, b)
for (const mode of modes)
  test(`retouch ${mode}: cropped CPU and Rust match original, edges, selection, repeated dabs`, async () => {
    const wasm = await RetouchWasm.create(readFileSync('src/renderer/src/assets/retouch.wasm'))
    try {
      for (const size of [1, 3, 19, 60])
        for (const hardness of [0, 0.8, 1]) {
          const width = 67,
            height = 49
          const data = new Uint8ClampedArray(width * height * 4)
          let seed = 7919
          for (let i = 0; i < data.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            data[i] = seed >>> 24
          }
          const make = (): cpu.RetouchSession => ({
            live: { width, height, data: data.slice() },
            stroke: { settings: { size, hardness, opacity: 0.73 } },
            limit: (i) => (i % 7 === 0 ? 0 : i % 3 === 0 ? 0.37 : 1)
          })
          const expected = make(),
            actual = make(),
            native = make()
          const points = [
            { x: -3, y: 2 },
            { x: 1.2, y: 0.5 },
            { x: 19, y: 17 },
            { x: 32.7, y: 27.1 },
            { x: 66, y: 48 },
            { x: 72, y: 55 }
          ]
          let from = points[0]
          for (const to of points) {
            const rect = run(mode, expected, from, to, old)
            assert.deepEqual(run(mode, actual, from, to), rect)
            assert.deepEqual(wasm.dab(native, mode, from, to), rect)
            assert.deepEqual(actual.live.data, expected.live.data)
            // hypot implementation may differ by a last bit; allow at most 1 byte rounding difference.
            for (let i = 0; i < data.length; i++)
              assert.ok(Math.abs(native.live.data[i] - expected.live.data[i]) <= 1, `${mode} size ${size} pixel ${i}: ${native.live.data[i]} != ${expected.live.data[i]}`)
            from = to
          }
        }
    } finally {
      wasm.dispose()
    }
  })
test('snapshot copies a bounded patch even in a large document', () => {
  const patch = cpu.snapshot({ width: 4000, height: 3000, data: new Uint8ClampedArray(4000 * 3000 * 4) }, 100, 200, 150, 250)
  assert.equal(patch.data.byteLength, 51 * 51 * 4)
})

test('Rust identity: zero strength or excluded selection never changes pixels', async () => {
  const wasm = await RetouchWasm.create(readFileSync('src/renderer/src/assets/retouch.wasm'))
  try {
    for (const mode of modes)
      for (const excluded of [false, true]) {
        const data = Uint8ClampedArray.from({ length: 32 * 24 * 4 }, (_, i) => (i * 71) & 255)
        const before = data.slice()
        const s: cpu.RetouchSession = {
          live: { width: 32, height: 24, data },
          stroke: { settings: { size: 60, hardness: 1, opacity: excluded ? 1 : 0 } },
          limit: excluded ? () => 0 : undefined
        }
        wasm.dab(s, mode, { x: 30, y: 20 }, { x: 0, y: 0 })
        assert.deepEqual(data, before)
      }
  } finally {
    wasm.dispose()
  }
})
