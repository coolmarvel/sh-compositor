/**
 * Compositor 에서 이식한 순수 로직 테스트 — 한도·이미지 크기·보정·DPI·캔버스 크기.
 * (출처별 수식 대조는 각 모듈 머리 주석 참고)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkLimits, fitWithinLimits, MAX_SIDE, MAX_PIXELS } from '../src/core/limits'
import { initialState, setDimension, setDpi, setResample, toDisplay, validate, resultPixels, ImageSizeState } from '../src/core/imagesize'
import { DEFAULT_ADJUST, hasAdjust, toneLut, curveLut, applyAdjustments, histogram, autoLevels, rgbToHsl, hslToRgb } from '../src/core/adjust'
import { embedDpi, readDpi, embedPngDpi, embedJpegDpi } from '../src/core/dpi'
import { anchorOffset, canvasTarget, changesCanvas } from '../src/core/canvassize'

// ── 한도 ──
test('한도: 30,000px/변 · 100MP', () => {
  assert.equal(checkLimits(1920, 1080), null)
  assert.match(checkLimits(MAX_SIDE + 1, 10)!, /30,000/)
  assert.match(checkLimits(20_000, 20_000)!, /메가픽셀/)
  assert.ok(checkLimits(0, 10))
  const f = fitWithinLimits(40_000, 20_000)
  assert.ok(f.width <= MAX_SIDE && f.height <= MAX_SIDE && f.width * f.height <= MAX_PIXELS)
  assert.ok(Math.abs(f.width / f.height - 2) < 0.01, '비율 유지')
})

// ── 이미지 크기 ──
const SRC = { width: 2000, height: 1000 }

test('이미지 크기: 비율 잠금이면 반대 변이 따라온다', () => {
  let s = initialState(SRC, 72)
  s = setDimension(s, 'width', 1000, SRC)
  assert.deepEqual(resultPixels(s), { width: 1000, height: 500 })
  s = { ...s, lock: false }
  s = setDimension(s, 'height', 800, SRC)
  assert.deepEqual(resultPixels(s), { width: 1000, height: 800 })
})

test('이미지 크기: 퍼센트·인치·cm 환산', () => {
  let s: ImageSizeState = { ...initialState(SRC, 100), unit: 'percent' }
  s = setDimension(s, 'width', 50, SRC)
  assert.deepEqual(resultPixels(s), { width: 1000, height: 500 })
  assert.equal(toDisplay(2000, 2000, 'inch', 100), 20)
  assert.ok(Math.abs(toDisplay(2000, 2000, 'cm', 100) - 50.8) < 1e-9)
  s = { ...initialState(SRC, 300), unit: 'inch' }
  s = setDimension(s, 'width', 2, SRC) // 2인치 × 300dpi = 600px
  assert.deepEqual(resultPixels(s), { width: 600, height: 300 })
})

test('이미지 크기: 리샘플 끄면 픽셀 고정, DPI 가 맞바뀐다', () => {
  let s = initialState(SRC, 72)
  s = { ...s, width: 999 } // 바꾼 흔적
  s = setResample(s, false, SRC)
  assert.equal(s.unit, 'inch')
  assert.deepEqual(resultPixels(s), SRC) // 원본으로 복귀
  s = setDimension(s, 'width', 10, SRC) // 2000px 를 10인치에 → 200dpi
  assert.equal(Math.round(s.dpi), 200)
  assert.deepEqual(resultPixels(s), SRC)
  assert.ok(validate(s).ok)
})

test('이미지 크기: 리샘플+인치에서 DPI 를 바꾸면 인쇄 크기 유지하려고 픽셀이 는다', () => {
  let s: ImageSizeState = { ...initialState(SRC, 100), unit: 'inch' }
  s = setDpi(s, 200)
  assert.deepEqual(resultPixels(s), { width: 4000, height: 2000 })
  const px = setDpi({ ...initialState(SRC, 100) }, 200) // 픽셀 단위면 픽셀 그대로
  assert.deepEqual(resultPixels(px), SRC)
})

test('이미지 크기: 한도 위반은 적용 불가 + 이유 문구', () => {
  const s = setDimension(initialState(SRC, 72), 'width', 40_000, SRC)
  const v = validate(s)
  assert.equal(v.ok, false)
  assert.match(v.message, /30,000/)
})

// ── 보정 ──
test('보정: 기본값은 아무것도 안 한다', () => {
  assert.equal(hasAdjust(DEFAULT_ADJUST), false)
  const lut = toneLut(DEFAULT_ADJUST)
  for (let i = 0; i < 256; i++) assert.equal(lut[i], i)
  const px = new Uint8ClampedArray([10, 120, 250, 255])
  applyAdjustments(px, DEFAULT_ADJUST)
  assert.deepEqual([...px], [10, 120, 250, 255])
})

test('보정: 레벨 수식이 Compositor 와 같다 (입력 50~200 → 전 구간)', () => {
  const lut = toneLut({ ...DEFAULT_ADJUST, inBlack: 50, inWhite: 200 })
  assert.equal(lut[50], 0)
  assert.equal(lut[200], 255)
  assert.equal(lut[125], 128) // (125-50)/150 = 0.5 → 127.5
  assert.equal(lut[10], 0)
  const out = toneLut({ ...DEFAULT_ADJUST, outBlack: 20, outWhite: 220 })
  assert.equal(out[0], 20)
  assert.equal(out[255], 220)
})

test('보정: 노출 +1스톱은 선형광 2배 (sRGB 중간 회색이 밝아진다)', () => {
  const lut = toneLut({ ...DEFAULT_ADJUST, exposure: 1 })
  assert.ok(lut[128] > 170 && lut[128] < 185, `got ${lut[128]}`) // 선형 0.2158×2=0.4316 → sRGB ≈ 0.69
  assert.equal(lut[0], 0)
  assert.equal(lut[255], 255)
})

test('보정: 커브는 제어점을 지나고 단조롭다', () => {
  const lut = curveLut([
    { x: 0, y: 0 },
    { x: 64, y: 100 },
    { x: 192, y: 160 },
    { x: 255, y: 255 }
  ])
  assert.equal(lut[64], 100)
  assert.equal(lut[192], 160)
  for (let i = 1; i < 256; i++) assert.ok(lut[i] >= lut[i - 1], `단조성 깨짐 @${i}`)
})

test('보정: 반전·그라데이션 맵·채도', () => {
  const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128])
  applyAdjustments(px, { ...DEFAULT_ADJUST, invert: true })
  assert.deepEqual([...px], [255, 255, 255, 255, 0, 0, 0, 128], '알파 유지')

  const gm = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255])
  applyAdjustments(gm, { ...DEFAULT_ADJUST, gradientMap: { shadows: '#102030', highlights: '#f0e0d0', reversed: false } })
  assert.deepEqual([...gm.slice(0, 3)], [0x10, 0x20, 0x30])
  assert.deepEqual([...gm.slice(4, 7)], [0xf0, 0xe0, 0xd0])

  const red = new Uint8ClampedArray([200, 50, 50, 255])
  applyAdjustments(red, { ...DEFAULT_ADJUST, saturation: -100 })
  assert.equal(red[0], red[1])
  assert.equal(red[1], red[2], '채도 −100 = 회색')
})

test('보정: 그레인은 seed 가 같으면 같은 무늬 (미리보기 = 결과물)', () => {
  const a = new Uint8ClampedArray(400).fill(128)
  const b = new Uint8ClampedArray(400).fill(128)
  applyAdjustments(a, { ...DEFAULT_ADJUST, grain: 50 }, 7)
  applyAdjustments(b, { ...DEFAULT_ADJUST, grain: 50 }, 7)
  assert.deepEqual([...a], [...b])
  assert.ok(
    a.some((v, i) => i % 4 !== 3 && v !== 128),
    '무늬가 생긴다'
  )
})

test('보정: HSL 왕복', () => {
  for (const [r, g, b] of [
    [255, 0, 0],
    [12, 200, 90],
    [128, 128, 128]
  ]) {
    const [h, s, l] = rgbToHsl(r, g, b)
    assert.deepEqual(hslToRgb(h, s, l), [r, g, b])
  }
})

test('자동 레벨: 0.1% 클리핑 끝점, 투명 픽셀 제외', () => {
  const px: number[] = []
  for (let i = 0; i < 1000; i++) px.push(60 + (i % 100), 60 + (i % 100), 60 + (i % 100), 255) // 60~159
  px.push(0, 0, 0, 0) // 투명 검정 — 세지 않아야 함
  const auto = autoLevels(histogram(px))
  assert.ok(auto)
  assert.equal(auto!.inBlack, 60)
  assert.equal(auto!.inWhite, 159)
})

// ── DPI ──
const MIN_PNG = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex'))

test('DPI: PNG pHYs 삽입·교체·읽기', () => {
  const a = embedPngDpi(MIN_PNG, 300)
  assert.equal(readDpi(a), 300)
  const b = embedPngDpi(a, 96) // 교체 — pHYs 가 두 개가 되면 안 된다
  assert.equal(readDpi(b), 96)
  const count = Buffer.from(b).toString('latin1').split('pHYs').length - 1
  assert.equal(count, 1)
  assert.equal(b.length, a.length)
  assert.equal(readDpi(MIN_PNG), null)
})

test('DPI: JPEG JFIF 패치 또는 삽입', () => {
  // SOI + APP0(JFIF, 단위 0) + EOI
  const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9])
  const a = embedJpegDpi(jfif, 300)
  assert.equal(a.length, jfif.length, '제자리 패치')
  assert.equal(readDpi(a), 300)
  // JFIF 없음(EXIF 등) → 삽입
  const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9])
  const b = embedJpegDpi(bare, 150)
  assert.equal(b.length, bare.length + 18)
  assert.equal(readDpi(b), 150)
  assert.deepEqual([...embedDpi(bare, 'webp', 300)], [...bare], 'WebP 는 그대로')
})

// ── 캔버스 크기 ──
test('캔버스 크기: 9방향 앵커 오프셋', () => {
  assert.deepEqual(anchorOffset(100, 50, 200, 100, 'nw'), { dx: 0, dy: 0 })
  assert.deepEqual(anchorOffset(100, 50, 200, 100, 'c'), { dx: 50, dy: 25 })
  assert.deepEqual(anchorOffset(100, 50, 200, 100, 'se'), { dx: 100, dy: 50 })
  assert.deepEqual(anchorOffset(100, 50, 60, 30, 'c'), { dx: -20, dy: -10 }, '줄이면 음수 = 잘림')
})

test('캔버스 크기: 절대·상대·정사각 모드', () => {
  const base = { anchor: 'c' as const, background: '#ffffff' }
  assert.deepEqual(canvasTarget(300, 200, { ...base, mode: 'absolute', width: 500, height: 500 }), { width: 500, height: 500 })
  assert.deepEqual(canvasTarget(300, 200, { ...base, mode: 'relative', width: 40, height: -20 }), { width: 340, height: 180 })
  assert.deepEqual(canvasTarget(300, 200, { ...base, mode: 'square', width: 0, height: 0 }), { width: 300, height: 300 })
  assert.equal(changesCanvas(300, 300, { ...base, mode: 'square', width: 0, height: 0 }), false, '이미 정사각이면 건너뜀')
})

// ── 배경 제거 마스크 다듬기 (GuidedMatte) ──
import { boxMean, guidedFilter, shiftEdge, matteContrast, hasMatteRefine, DEFAULT_MATTE, NO_MATTE } from '../src/core/matte'

test('매트: 상자 평균은 상수 이미지를 보존하고 반경 0 이면 그대로', () => {
  const c = new Float32Array(25).fill(0.4)
  for (const v of boxMean(c, 5, 5, 2)) assert.ok(Math.abs(v - 0.4) < 1e-6)
  assert.deepEqual([...boxMean(c, 5, 5, 0)], [...c])
})

test('매트: 가이드 필터는 가이드의 경계로 마스크를 끌어붙인다', () => {
  // 가이드: 왼쪽 절반 검정 / 오른쪽 절반 흰색. 마스크: 경계가 흐릿한 램프
  const W = 20,
    H = 4
  const guide = new Float32Array(W * H),
    mask = new Float32Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      guide[y * W + x] = x < 10 ? 0 : 1
      mask[y * W + x] = Math.min(1, Math.max(0, (x - 6) / 8))
    }
  const out = guidedFilter(mask, guide, W, H, 3, 1e-4)
  assert.ok(out[2 * W + 8] < mask[2 * W + 8], '경계 왼쪽은 더 투명해진다')
  assert.ok(out[2 * W + 11] > mask[2 * W + 11], '경계 오른쪽은 더 불투명해진다')
})

test('매트: 가장자리 이동·대비', () => {
  const W = 30,
    H = 1
  const m = new Float32Array(W)
  for (let x = 0; x < W; x++) m[x] = x >= 10 && x < 20 ? 1 : 0
  const shrunk = shiftEdge(m, W, H, -6)
  const grown = shiftEdge(m, W, H, 6)
  const sum = (a: Float32Array): number => a.reduce((s, v) => s + v, 0)
  assert.ok(sum(shrunk) < sum(m) && sum(grown) > sum(m))
  const c = matteContrast(Float32Array.from([0.3, 0.5, 0.7]), 100)
  assert.equal(c[0], 0)
  assert.equal(c[2], 1)
  assert.equal(hasMatteRefine(NO_MATTE), false)
  assert.equal(hasMatteRefine(DEFAULT_MATTE), true)
})
