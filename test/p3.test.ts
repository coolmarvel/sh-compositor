/**
 * v1.1(P3) 순수 로직 — 추가 조정(흑백·색상 균형·활기·포스터화·한계값)과 추가 필터(언샤프·하이 패스·모자이크·중간값).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  blackWhite,
  colorBalance,
  vibrance,
  posterize,
  threshold,
  DEFAULT_BW,
  DEFAULT_CB,
  unsharpMask,
  highPassFilter,
  mosaicFilter,
  medianFilter,
  hasFilters,
  DEFAULT_FILTERS
} from '../src/core/index'

const px = (...c: number[]): Uint8ClampedArray => new Uint8ClampedArray(c)

test('흑백: 포토샵 공식 — 빨강 40% 면 순수 빨강은 102, 흰색은 흰색', () => {
  const p = px(255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 255, 255)
  blackWhite(p, DEFAULT_BW)
  assert.equal(p[0], 102) // 255 × 0.4
  assert.deepEqual([p[4], p[5], p[6]], [255, 255, 255])
  assert.equal(p[8], 51) // 파랑 20%
  // 빨강 가중을 올리면 빨강이 밝아진다
  const q = px(255, 0, 0, 255)
  blackWhite(q, { ...DEFAULT_BW, reds: 100 })
  assert.equal(q[0], 255)
})

test('색상 균형: 중간톤 빨강 쪽 → R 증가, 밝기 유지 켜면 밝기 거의 그대로', () => {
  const p = px(128, 128, 128, 255)
  colorBalance(p, { ...DEFAULT_CB, midtones: [60, 0, 0], preserveLuminosity: false })
  assert.ok(p[0] > 150 && p[1] === 128, String(Array.from(p)))
  const q = px(128, 128, 128, 255)
  colorBalance(q, { ...DEFAULT_CB, midtones: [60, 0, 0], preserveLuminosity: true })
  const l = (Math.max(q[0], q[1], q[2]) + Math.min(q[0], q[1], q[2])) / 2
  assert.ok(Math.abs(l - 128) <= 2 && q[0] > q[1], String(Array.from(q)))
})

test('활기: 흐린 색은 많이, 이미 선명한 색은 조금', () => {
  const dull = px(140, 120, 120, 255)
  const vivid = px(250, 20, 20, 255)
  vibrance(dull, 100, 0)
  vibrance(vivid, 100, 0)
  assert.ok(dull[0] - dull[1] > 30, String(Array.from(dull))) // 20 → 36 가까이
  assert.ok(vivid[0] - vivid[1] <= 255, 'clamped')
})

test('포스터화 4단계 · 한계값 128', () => {
  const p = px(10, 100, 200, 255)
  posterize(p, 4)
  assert.deepEqual([p[0], p[1], p[2]], [0, 85, 170])
  const q = px(200, 200, 200, 255, 50, 50, 50, 255)
  threshold(q, 128)
  assert.deepEqual([q[0], q[4]], [255, 0])
})

test('필터: 언샤프는 경계 대비를 키우고, 하이 패스는 평평한 곳을 128 로', () => {
  const W = 20
  const H = 1
  const src = new Uint8ClampedArray(W * H * 4)
  for (let x = 0; x < W; x++) src.set(x < 10 ? [80, 80, 80, 255] : [160, 160, 160, 255], x * 4)
  const s = unsharpMask(src, W, H, 150, 2, 0)
  assert.ok(s[9 * 4] < 80 && s[10 * 4] > 160, `${s[9 * 4]} ${s[10 * 4]}`)
  const hp = highPassFilter(src, W, H, 2)
  assert.ok(Math.abs(hp[0] - 128) <= 2 && hp[9 * 4] < 128 && hp[10 * 4] > 128)
})

test('필터: 모자이크 칸 평균 · 중간값이 점 잡음 제거', () => {
  const src = new Uint8ClampedArray(4 * 4 * 4)
  for (let i = 0; i < 16; i++) src.set([i < 8 ? 0 : 200, 0, 0, 255], i * 4)
  const m = mosaicFilter(src, 4, 4, 4)
  assert.equal(m[0], 100)
  const noisy = new Uint8ClampedArray(5 * 5 * 4).fill(50)
  noisy.set([255, 255, 255, 255], (2 * 5 + 2) * 4)
  const med = medianFilter(noisy, 5, 5, 1)
  assert.equal(med[(2 * 5 + 2) * 4], 50)
  assert.ok(hasFilters({ ...DEFAULT_FILTERS, median: 1 }) && !hasFilters(DEFAULT_FILTERS))
})
