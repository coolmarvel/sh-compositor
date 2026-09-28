import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { prepareInpaint, finishInpaint, dilate, blurBackground, fillBackground } from '../src/core/inpaint'
import type { Bitmap } from '../src/core/doc/types'

const MODEL = 'resources/sam/inpaint/lama.onnx'

/** 가로 줄무늬(주황·파랑) 위에 빨간 사각형 */
function scene(W: number, H: number, box: { x: number; y: number; w: number; h: number }): { bmp: Bitmap; hole: Uint8Array } {
  const data = new Uint8ClampedArray(W * H * 4)
  const hole = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const inBox = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h
      const c = inBox ? [230, 20, 30] : Math.floor(y / 12) % 2 ? [240, 170, 30] : [30, 70, 200]
      data.set([...c, 255], o)
      if (inBox) hole[y * W + x] = 255
    }
  return { bmp: { width: W, height: H, data }, hole }
}

test('dilate grows a single pixel into a (2r+1) square', () => {
  const bin = new Uint8Array(11 * 11)
  bin[5 * 11 + 5] = 1
  const out = dilate(bin, 11, 11, 2)
  let n = 0
  for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) if (out[y * 11 + x]) n++, assert.ok(Math.abs(x - 5) <= 2 && Math.abs(y - 5) <= 2)
  assert.equal(n, 25)
})

test('prepareInpaint: square crop around the hole, 512 input, mask 1 = erase, weight 1 over the grown hole', () => {
  const { bmp, hole } = scene(800, 600, { x: 380, y: 280, w: 40, h: 30 })
  const job = prepareInpaint(bmp, hole)!
  assert.ok(job)
  const { crop } = job
  assert.ok(crop.x < 380 && crop.y < 280 && crop.x + crop.w > 420 && crop.y + crop.h > 310, JSON.stringify(crop))
  assert.equal(crop.w, crop.h) // 정사각형 (그림 안에 들어가면)
  assert.equal(job.size, 512)
  assert.equal(job.image.length, 3 * 512 * 512)
  // 구멍 가운데: 지울 곳(1)·가중치 1 / 잘라 낸 모서리: 둠(0)·가중치 0
  const at = (x: number, y: number): number => (y - crop.y) * crop.w + (x - crop.x)
  const m = (x: number, y: number): number => job.mask[Math.floor(((y - crop.y) * 512) / crop.h) * 512 + Math.floor(((x - crop.x) * 512) / crop.w)]
  assert.equal(m(400, 295), 1)
  assert.equal(m(crop.x, crop.y), 0)
  assert.equal(job.weight[at(400, 295)], 1)
  assert.equal(job.weight[at(381, 281)], 1) // 가장자리 안쪽도 확실히 덮는다
  assert.equal(job.weight[at(crop.x, crop.y)], 0)
  // RGB 는 CHW 0~1
  const k = Math.floor(((295 - crop.y) * 512) / crop.h) * 512 + Math.floor(((400 - crop.x) * 512) / crop.w)
  assert.ok(Math.abs(job.image[k] - 230 / 255) < 0.01 && Math.abs(job.image[2 * 512 * 512 + k] - 30 / 255) < 0.01)
  assert.equal(prepareInpaint(bmp, new Uint8Array(800 * 600)), null)
})

test('prepareInpaint keeps the crop inside small images (not square) and large holes stay covered', () => {
  const { bmp, hole } = scene(200, 150, { x: 60, y: 35, w: 80, h: 80 })
  const job = prepareInpaint(bmp, hole)!
  assert.deepEqual(job.crop, { x: 0, y: 0, w: 200, h: 150 })
  const big = scene(3000, 2000, { x: 1000, y: 600, w: 900, h: 800 })
  const j2 = prepareInpaint(big.bmp, big.hole)!
  assert.ok(j2.crop.w > 1900 && j2.crop.x >= 0 && j2.crop.x + j2.crop.w <= 3000, JSON.stringify(j2.crop))
  const cx = Math.floor(((1450 - j2.crop.x) * 512) / j2.crop.w)
  const cy = Math.floor(((1000 - j2.crop.y) * 512) / j2.crop.h)
  assert.equal(j2.mask[cy * 512 + cx], 1)
})

test('finishInpaint changes only weighted pixels and keeps alpha', () => {
  const { bmp, hole } = scene(300, 260, { x: 140, y: 120, w: 20, h: 20 })
  bmp.data[3] = 77 // 구석 알파
  const job = prepareInpaint(bmp, hole)!
  const green = new Float32Array(3 * 512 * 512)
  green.fill(200, 512 * 512, 2 * 512 * 512) // G 채널만 200
  const out = finishInpaint(bmp, job, green)
  const o = (130 * 300 + 150) * 4
  assert.deepEqual([...out.slice(o, o + 4)], [0, 200, 0, 255])
  for (let y = 0; y < 260; y++)
    for (let x = 0; x < 300; x++) {
      const inCrop = x >= job.crop.x && x < job.crop.x + job.crop.w && y >= job.crop.y && y < job.crop.y + job.crop.h
      const w = inCrop ? job.weight[(y - job.crop.y) * job.crop.w + x - job.crop.x] : 0
      if (w > 0) continue
      const i = (y * 300 + x) * 4
      assert.deepEqual([...out.slice(i, i + 4)], [...bmp.data.slice(i, i + 4)], `(${x},${y}) changed`)
    }
  assert.equal(out[3], 77)
})

test('blurBackground keeps the subject and does not bleed subject color into the background', () => {
  const W = 120
  const H = 80
  const data = new Uint8ClampedArray(W * H * 4)
  const subject = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      const inside = x >= 40 && x < 80
      data.set(inside ? [255, 0, 0, 255] : x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], o)
      if (inside) subject[y * W + x] = 255
    }
  const out = blurBackground({ width: W, height: H, data }, subject, 8)
  const px = (x: number, y: number): number[] => [...out.slice((y * W + x) * 4, (y * W + x) * 4 + 3)]
  assert.deepEqual(px(60, 40), [255, 0, 0]) // 피사체 그대로
  const bg = px(20, 40)
  assert.ok(Math.abs(bg[0] - 128) < 20 && Math.abs(bg[2] - 128) < 20, `blurred ${bg}`) // 줄무늬가 회색으로
  const edge = px(37, 40)
  assert.ok(edge[0] - edge[2] < 12, `red bled into background ${edge}`)
})

test('fillBackground puts an opaque color outside the subject', () => {
  const data = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 0])
  const out = fillBackground({ width: 2, height: 1, data }, new Uint8Array([0, 255]), [255, 255, 255])
  assert.deepEqual([...out], [255, 255, 255, 255, 255, 255, 255, 255])
})

test('LaMa model erases a red box so it blends with the stripes (onnxruntime-node)', { skip: !existsSync(MODEL) && 'npm run models 로 모델을 받으면 실행' }, async () => {
  const ort = createRequire(import.meta.url)('onnxruntime-node')
  const session = await ort.InferenceSession.create(MODEL)
  const { bmp, hole } = scene(320, 240, { x: 140, y: 100, w: 36, h: 30 })
  const job = prepareInpaint(bmp, hole)!
  const r = await session.run({ image: new ort.Tensor('float32', job.image, [1, 3, 512, 512]), mask: new ort.Tensor('float32', job.mask, [1, 1, 512, 512]) })
  const out = finishInpaint(bmp, job, r[session.outputNames[0]].data as Float32Array)
  // 빨간 사각형 자리에 빨강(R 높고 G·B 낮음)이 남지 않고, 줄무늬 색(주황·파랑)으로 채워진다
  let red = 0
  for (let y = 100; y < 130; y++)
    for (let x = 140; x < 176; x++) {
      const o = (y * 320 + x) * 4
      if (out[o] > 180 && out[o + 1] < 90 && out[o + 2] < 90) red++
    }
  assert.ok(red < 36 * 30 * 0.02, `red pixels left: ${red}`)
  // 바깥은 그대로
  assert.deepEqual([...out.slice(0, 4)], [...bmp.data.slice(0, 4)])
})
