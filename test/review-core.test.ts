import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDoc, makeLayer, identityTransform, BLEND_MODES, DEFAULT_ADJUST, grayBitmap, type Bitmap } from '../src/core/index'
import { flattenDoc, rasterizeBitmap } from '../src/core/doc/render'
import * as before from './render-reference'
import { polygonMask } from '../src/core/doc/selection'
import { polygonMask as oldPolygon } from './selection-reference'
import { decodePng, encodePng } from '../src/core/png'
let seed = 7919
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
const bitmap = (width: number, height: number): Bitmap => ({ width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, () => Math.floor(random() * 256)) })
test('CPU fast raster and lazy clipping preserve old output across transforms, masks, groups and blend modes', () => {
  for (let trial = 0; trial < 48; trial++) {
    const d = newDoc(29, 23),
      b = bitmap(19, 17)
    const t = identityTransform(19, 17, (trial % 9) - 4, (trial % 7) - 3)
    if (trial % 3 === 0) t.rotation = 13
    if (trial % 4 === 0) t.width = 12
    const source = b.data.slice()
    assert.deepEqual(rasterizeBitmap(b, { transform: t }, 29, 23), before.rasterizeBitmap(b, { transform: t }, 29, 23))
    const group = makeLayer('group', 'group', null)
    const base = makeLayer('pixel', 'base', b, t, { parentId: group.id, visible: trial % 5 !== 0, mask: { bitmap: grayBitmap(19, 17, 173), enabled: true } })
    const clipped = makeLayer('pixel', 'clip', bitmap(29, 23), undefined, { parentId: group.id, clip: trial % 2 === 0, blend: BLEND_MODES[trial % 16].key, opacity: 0.63 })
    const adj = makeLayer('adjustment', 'adjust', null, identityTransform(29, 23), { adjustment: { kind: 'exposure', settings: { ...DEFAULT_ADJUST, exposure: 0.3 } }, clip: trial % 2 === 0 })
    d.layers = [...d.layers, group, base, clipped, adj]
    for (const skip of [undefined, new Set([base.id]), new Set([clipped.id])]) assert.deepEqual(flattenDoc(d, skip), before.flattenDoc(d, skip))
    assert.deepEqual(b.data, source)
  }
})
test('polygon span counting equals old supersampling including fractional/off-canvas edges', () => {
  for (let i = 0; i < 80; i++) {
    const points = Array.from({ length: 3 + (i % 8) }, () => ({ x: random() * 100 - 20, y: random() * 50 - 10 }))
    for (const aa of [false, true]) assert.deepEqual(polygonMask(67, 31, points, aa), oldPolygon(67, 31, points, aa))
  }
})
test('long lasso point lists do not overflow Math.max argument count', () => {
  const points = Array.from({ length: 150000 }, (_, i) => ({ x: i % 2 ? 2 : 1, y: i % 3 ? 2 : 1 }))
  assert.equal(polygonMask(4, 4, points, false).length, 16)
})
test('PNG rejects oversized headers and truncated chunks before pixel allocation', () => {
  const png = encodePng(2, 2, new Uint8ClampedArray(16))
  const huge = png.slice()
  new DataView(huge.buffer).setUint32(16, 30001)
  assert.throws(() => decodePng(huge), /넘을 수 없습니다/)
  assert.throws(() => decodePng(png.subarray(0, png.length - 3)), /잘렸습니다/)
})
