import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportDoc, importDocument, importBitmap, inspectUpload, sniff, jpegSize } from '../src/application/codecs'
import { docFromBitmap } from '../src/core/doc/ops'
import type { Bitmap } from '../src/core/doc/types'

function grad(w: number, h: number, alpha = 255): Bitmap {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4
      data[k] = (x * 255) / (w - 1)
      data[k + 1] = (y * 255) / (h - 1)
      data[k + 2] = 128
      data[k + 3] = alpha
    }
  return { width: w, height: h, data }
}

test('JPEG 내보내기·가져오기 왕복 (서버 코덱, jpeg-js)', () => {
  const doc = docFromBitmap(grad(64, 48), 'g', 72)
  const out = exportDoc(doc, 'jpeg')
  assert.equal(out.mediaType, 'image/jpeg')
  assert.equal(sniff(out.bytes), 'jpeg')
  assert.deepEqual(jpegSize(out.bytes), { width: 64, height: 48 })
  assert.equal(inspectUpload(out.bytes).format, 'jpeg')
  const back = importDocument(out.bytes, 'g.jpg', 1e7)
  assert.equal(back.doc.width, 64)
  assert.equal(back.doc.height, 48)
  const b = back.doc.layers[0].bitmap!
  // 품질 90 손실 압축: 가운데 픽셀이 원본과 8 이내
  const k = (24 * 64 + 32) * 4
  const src = doc.layers[0].bitmap!.data
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(b.data[k + c] - src[k + c]) <= 8, `채널 ${c}: ${b.data[k + c]} vs ${src[k + c]}`)
  assert.equal(b.data[k + 3], 255)
  const bm = importBitmap(out.bytes, 1e7)
  assert.equal(bm.width * bm.height * 4, bm.data.length)
})

test('JPEG 투명은 흰 배경 위에 합성된다', () => {
  const doc = docFromBitmap(grad(16, 16, 0), 't', 72)
  const out = exportDoc(doc, 'jpeg')
  const back = importBitmap(out.bytes, 1e6)
  assert.ok(back.data[0] > 245 && back.data[1] > 245 && back.data[2] > 245)
})

test('JPEG 픽셀 한도는 디코딩 전에 막는다', () => {
  const out = exportDoc(docFromBitmap(grad(40, 40), 'l', 72), 'jpeg')
  assert.throws(() => importBitmap(out.bytes, 100), /한도/)
})
