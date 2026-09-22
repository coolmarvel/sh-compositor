/** node --import tsx test/review-bench.ts — CPU only, median of 5 measured runs after one warmup. */
import { performance } from 'node:perf_hooks'
import { newDoc, makeLayer } from '../src/core/doc/ops'
import { flattenDoc } from '../src/core/doc/render'
import { flattenDoc as oldFlatten } from './render-reference'
import { polygonMask } from '../src/core/doc/selection'
import { polygonMask as oldPolygon } from './selection-reference'
const measure = (fn: () => unknown): number => {
  fn()
  const times: number[] = []
  for (let i = 0; i < 5; i++) {
    const start = performance.now()
    fn()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return +times[2].toFixed(2)
}
const doc = newDoc(2000, 1500)
for (let l = 0; l < 4; l++) {
  const data = Uint8ClampedArray.from({ length: 2000 * 1500 * 4 }, (_, i) => (i * 17 + l * 31) & 255)
  doc.layers.push(makeLayer('pixel', String(l), { width: 2000, height: 1500, data }, undefined, { opacity: 0.7 }))
}
console.log('CPU 2000x1500 5 layers ms', { before: measure(() => oldFlatten(doc)), after: measure(() => flattenDoc(doc)) })
const points = [
  { x: 7800, y: 200 },
  { x: 7830, y: 200 },
  { x: 7830, y: 700 },
  { x: 7800, y: 700 }
]
console.log('Lasso 8000x1000 right 30x500 ms', { before: measure(() => oldPolygon(8000, 1000, points)), after: measure(() => polygonMask(8000, 1000, points)) })
