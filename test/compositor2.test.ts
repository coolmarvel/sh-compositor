/**
 * Compositor 이식 2차(v1.5.0) — 필터·레이어 효과·원근 보정·내용 인식 채우기·채널별 톤·색역 색조/채도.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ADJUST, DEFAULT_TONE, applyAdjustments, toneLuts, bandWeight, HUE_BANDS, autoLevelsFor, sampleLevels, histogram, hasAdjust } from '../src/core/adjust'
import { gaussianBlur, motionBlur, addNoise, lensDistort, applyFilters, DEFAULT_FILTERS, hasFilters, filterMargin } from '../src/core/filters'
import { renderEffects, DEFAULT_EFFECTS, effectsMargin, extreme, hasEffects, shadowOffset } from '../src/core/effects'
import { IDENTITY_QUAD, warpQuad, quadOutputSize, rectToQuadHomography, applyHomography, rotateQuad, isIdentityQuad, Quad } from '../src/core/perspective'
import { contentFill } from '../src/core/contentfill'

const solid = (w: number, h: number, px: [number, number, number, number]): Uint8ClampedArray => {
  const a = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < a.length; i += 4) a.set(px, i)
  return a
}
const at = (a: Uint8ClampedArray, w: number, x: number, y: number): number[] => Array.from(a.slice((y * w + x) * 4, (y * w + x) * 4 + 4))

// ── 채널별 톤·색역 ──
test('채널 레벨: 빨강 채널만 입력 흰색 128 → R 만 밝아진다', () => {
  const a = { ...DEFAULT_ADJUST, channels: { ...DEFAULT_ADJUST.channels, r: { ...DEFAULT_TONE, inWhite: 128 } } }
  assert.equal(hasAdjust(a), true)
  const [lr, lg] = toneLuts(a)
  assert.equal(lr[128], 255)
  assert.equal(lg[128], 128)
})

test('색역 밴드 가중: 범위 안 1, 어깨 절반, 밖 0 (빨강은 0° 를 감싼다)', () => {
  assert.equal(bandWeight(HUE_BANDS.reds, 0), 1)
  assert.equal(bandWeight(HUE_BANDS.reds, 330), 0.5)
  assert.equal(bandWeight(HUE_BANDS.reds, 120), 0)
  assert.equal(bandWeight(HUE_BANDS.blues, 240), 1)
})

test('색역 색조/채도: 빨강 계열 채도 −100 이면 빨강만 회색, 파랑은 그대로', () => {
  const px = Uint8ClampedArray.from([220, 30, 30, 255, 30, 30, 220, 255])
  applyAdjustments(px, { ...DEFAULT_ADJUST, hueRanges: { reds: { hue: 0, saturation: -100, lightness: 0 } } })
  assert.equal(px[0], px[1])
  assert.deepEqual([px[4], px[5], px[6]], [30, 30, 220])
})

test('색상화: 모든 픽셀이 지정 색조로', () => {
  const px = Uint8ClampedArray.from([200, 50, 50, 255, 50, 200, 50, 255])
  applyAdjustments(px, { ...DEFAULT_ADJUST, colorize: true, hue: 240, saturation: 50 })
  assert.ok(px[2] > px[0] && px[6] > px[4], '둘 다 파랑 쪽')
})

test('자동 레벨 색상 모드: 채널마다 제 끝점, 스포이트 흰 점', () => {
  const data: number[] = []
  for (let i = 0; i < 100; i++) data.push(50 + i, 20 + i, 10 + i, 255)
  const r = autoLevelsFor(histogram(data), 'color')!
  assert.equal(r.channels.r.inBlack, 50)
  assert.equal(r.channels.g.inBlack, 20)
  const s = sampleLevels(DEFAULT_ADJUST, [200, 180, 160], 'white')
  assert.deepEqual([s.channels.r.inWhite, s.channels.g.inWhite, s.channels.b.inWhite], [200, 180, 160])
})

// ── 필터 ──
test('가우시안 블러: 상수 이미지 내부는 그대로, 점은 퍼진다', () => {
  const W = 21
  const img = solid(W, W, [0, 0, 0, 255])
  img.set([255, 255, 255, 255], (10 * W + 10) * 4)
  const out = gaussianBlur(img, W, W, 2)
  assert.ok(at(out, W, 10, 10)[0] < 255 && at(out, W, 12, 10)[0] > 0)
  const flat = gaussianBlur(solid(W, W, [100, 100, 100, 255]), W, W, 2)
  assert.deepEqual(at(flat, W, 10, 10), [100, 100, 100, 255])
})

test('모션 블러: 가로(0°)면 가로로만 번진다', () => {
  const W = 21
  const img = solid(W, W, [0, 0, 0, 255])
  img.set([255, 255, 255, 255], (10 * W + 10) * 4)
  const out = motionBlur(img, W, W, 8, 0)
  assert.ok(at(out, W, 13, 10)[0] > 0)
  assert.equal(at(out, W, 10, 13)[0], 0)
})

test('노이즈: seed 같으면 같은 무늬, 투명 픽셀은 건드리지 않음', () => {
  const a = solid(8, 8, [128, 128, 128, 255])
  const b = solid(8, 8, [128, 128, 128, 255])
  addNoise(a, 8, 8, 40, true, false, 7)
  addNoise(b, 8, 8, 40, true, false, 7)
  assert.deepEqual(Array.from(a), Array.from(b))
  const t = solid(4, 4, [0, 0, 0, 0])
  addNoise(t, 4, 4, 100, false, true, 1)
  assert.ok(t.every((v) => v === 0))
})

test('렌즈 보정: 중심 픽셀은 제자리, k=0 은 원본', () => {
  const W = 11
  const img = solid(W, W, [10, 20, 30, 255])
  img.set([255, 0, 0, 255], (5 * W + 5) * 4)
  assert.equal(lensDistort(img, W, W, 0), img)
  assert.deepEqual(at(lensDistort(img, W, W, 0.3), W, 5, 5), [255, 0, 0, 255])
  assert.equal(hasFilters(DEFAULT_FILTERS), false)
  assert.equal(filterMargin({ ...DEFAULT_FILTERS, blur: 4 }), 14)
  assert.equal(applyFilters(img, W, W, DEFAULT_FILTERS), img)
})

// ── 레이어 효과 ──
test('효과: 바깥 외곽선은 모양 둘레에만, 여백만큼 넓어진다', () => {
  const W = 10
  const img = solid(W, W, [0, 0, 0, 0])
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) img.set([255, 0, 0, 255], (y * W + x) * 4)
  const e = { ...DEFAULT_EFFECTS, stroke: { ...DEFAULT_EFFECTS.stroke, enabled: true, size: 2, color: '#00ff00' } }
  assert.equal(effectsMargin(e), 4)
  const r = renderEffects(img, W, W, e)
  assert.equal(r.width, W + 8)
  const px = (x: number, y: number): number[] => at(r.data, r.width, x + r.inset, y + r.inset)
  assert.deepEqual(px(4, 4), [255, 0, 0, 255], '원래 픽셀 위')
  assert.deepEqual(px(2, 4), [0, 255, 0, 255], '둘레 = 외곽선 색')
  assert.equal(px(0, 0)[3], 0, '멀리는 투명')
})

test('효과: 그림자 방향(90° = 위에서 빛 → 아래로)·deque 팽창', () => {
  const o = shadowOffset({ angle: 90, distance: 10 })
  assert.ok(Math.abs(o.dx) < 1e-9 && Math.abs(o.dy - 10) < 1e-9)
  const m = extreme(Float32Array.from([0, 0, 1, 0, 0]), 5, 1, 1, false)
  assert.deepEqual(Array.from(m), [0, 1, 1, 1, 0])
  assert.equal(hasEffects(DEFAULT_EFFECTS), false)
})

// ── 원근 보정 ──
test('원근: 호모그래피가 네 모서리를 정확히 보낸다', () => {
  const dst: Quad = [
    { x: 10, y: 5 },
    { x: 90, y: 12 },
    { x: 80, y: 70 },
    { x: 5, y: 60 }
  ]
  const H = rectToQuadHomography(100, 50, dst)
  const c = [applyHomography(H, 0, 0), applyHomography(H, 100, 0), applyHomography(H, 100, 50), applyHomography(H, 0, 50)]
  c.forEach((p, i) => assert.ok(Math.abs(p.x - dst[i].x) < 1e-6 && Math.abs(p.y - dst[i].y) < 1e-6))
})

test('원근: 항등 사각형은 원본 그대로, 크기 계산·회전', () => {
  const W = 6
  const img = new Uint8ClampedArray(W * W * 4)
  for (let i = 0; i < img.length; i += 4) img.set([i % 250, 40, 90, 255], i)
  const out = warpQuad(img, W, W, IDENTITY_QUAD, W, W)
  assert.deepEqual(Array.from(out), Array.from(img))
  assert.deepEqual(quadOutputSize(IDENTITY_QUAD, 400, 300), { width: 400, height: 300 })
  assert.equal(isIdentityQuad(IDENTITY_QUAD), true)
  const r = rotateQuad(IDENTITY_QUAD, 90, 1)
  assert.ok(Math.abs(r[0].x - 1) < 1e-9 && Math.abs(r[0].y - 0) < 1e-9, '90° 회전하면 왼쪽 위가 오른쪽 위로')
})

// ── 내용 인식 채우기 ──
test('내용 인식 채우기: 줄무늬 이미지의 빈칸을 무늬로 메운다', () => {
  const W = 24
  const H = 24
  const img = new Uint8ClampedArray(W * H * 4)
  const color = (x: number): number[] => (x % 4 < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img.set(color(x), (y * W + x) * 4)
  const target = new Uint8Array(W * H)
  for (let y = 18; y < H; y++)
    for (let x = 0; x < W; x++) {
      target[y * W + x] = 1
      img.set([0, 0, 0, 0], (y * W + x) * 4)
    }
  assert.equal(contentFill(img, target, W, H), 1)
  let same = 0
  for (let y = 18; y < H; y++) for (let x = 0; x < W; x++) if (at(img, W, x, y)[0] === color(x)[0]) same++
  assert.ok(same / (6 * W) > 0.9, `무늬 일치 ${same}/${6 * W}`)
})
