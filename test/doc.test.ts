/**
 * 문서 모델 테스트 — 레이어 조작·실행취소·합성 모드·CPU 합성·선택·브러시·PNG·프로젝트 왕복.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  newDoc,
  addBlankLayer,
  removeLayers,
  duplicateLayers,
  moveLayerBy,
  groupLayers,
  mergeDown,
  updateLayer,
  displayOrder,
  flattenDoc,
  makeLayer,
  insertLayer,
  createBitmap,
  identityTransform,
  startHistory,
  record,
  undo,
  redo,
  canUndo,
  compositePixel,
  blendColor,
  layerMatrix,
  applyAffine,
  invertAffine,
  transformBounds,
  rectMask,
  ellipseMask,
  combine,
  invertSelection,
  growSelection,
  magicWand,
  makeSelection,
  selectionOutline,
  StrokeCoverage,
  applyStroke,
  tipAlpha,
  encodePng,
  decodePng,
  packProject,
  unpackProject,
  resizeCanvas,
  cropDoc,
  flipCanvas,
  rotateCanvas90,
  type Doc
} from '../src/core/index'

const px = (d: Doc, x: number, y: number): number[] => {
  const f = flattenDoc(d)
  return Array.from(f.data.slice((y * d.width + x) * 4, (y * d.width + x) * 4 + 4))
}
const solidLayer = (w: number, h: number, c: [number, number, number, number], x = 0, y = 0) => makeLayer('pixel', 'L', createBitmap(w, h, c), identityTransform(w, h, x, y))

test('새 문서: 흰 배경 레이어 하나, 합성하면 흰색', () => {
  const d = newDoc(4, 3)
  assert.equal(d.layers.length, 1)
  assert.deepEqual(px(d, 2, 1), [255, 255, 255, 255])
})

test('레이어 추가·복제·삭제·순서·폴더·표시 순서', () => {
  let d = newDoc(4, 4)
  d = addBlankLayer(d)
  const a = d.activeId!
  d = duplicateLayers(d, [a])
  assert.equal(d.layers.length, 3)
  assert.match(d.layers[2].name, /복사/)
  d = moveLayerBy(d, d.activeId!, -1)
  assert.equal(d.layers[1].name.endsWith('복사'), true)
  d = groupLayers(d, [d.layers[1].id, d.layers[2].id])
  const order = displayOrder(d)
  assert.equal(order[0].layer.kind, 'group')
  assert.equal(order[1].depth, 1)
  d = removeLayers(d, [order[0].layer.id])
  assert.equal(d.layers.length, 1, '폴더를 지우면 자식도')
})

test('합성 모드: 곱하기·스크린·차이·광도 (W3C 수식)', () => {
  assert.deepEqual(blendColor('multiply', [0.5, 1, 0], [0.5, 0.5, 1]), [0.25, 0.5, 0])
  assert.deepEqual(blendColor('screen', [0.5, 0, 1], [0.5, 1, 0]), [0.75, 1, 1])
  assert.deepEqual(
    blendColor('difference', [0.8, 0.2, 0.5], [0.3, 0.7, 0.5]).map((v) => +v.toFixed(3)),
    [0.5, 0.5, 0]
  )
  const l = blendColor('luminosity', [1, 0, 0], [0.5, 0.5, 0.5])
  assert.ok(Math.abs(0.3 * l[0] + 0.59 * l[1] + 0.11 * l[2] - 0.5) < 1e-6, '광도 = 원본 밝기')
  // 반투명 source-over
  const o = compositePixel('normal', [0, 0, 1], 1, [1, 0, 0], 0.5)
  assert.deepEqual(
    o.map((v) => +v.toFixed(3)),
    [0.5, 0, 0.5, 1]
  )
})

test('CPU 합성: 불투명도·곱하기·숨김·클리핑', () => {
  let d = newDoc(4, 4) // 흰 배경
  d = insertLayer(d, { ...solidLayer(2, 2, [255, 0, 0, 255], 1, 1), blend: 'multiply' })
  assert.deepEqual(px(d, 1, 1), [255, 0, 0, 255])
  assert.deepEqual(px(d, 0, 0), [255, 255, 255, 255])
  d = updateLayer(d, d.activeId!, { opacity: 0.5 })
  assert.deepEqual(
    px(d, 1, 1).map((v) => Math.round(v)),
    [255, 128, 128, 255]
  )
  d = updateLayer(d, d.activeId!, { visible: false })
  assert.deepEqual(px(d, 1, 1), [255, 255, 255, 255])
  // 클리핑: 빨간 사각 위에 파란 전체 레이어를 클리핑 → 사각 안만 파랑
  let c = newDoc(4, 4, null)
  c = insertLayer(c, solidLayer(2, 2, [255, 0, 0, 255], 1, 1))
  c = insertLayer(c, { ...solidLayer(4, 4, [0, 0, 255, 255]), clip: true })
  assert.deepEqual(px(c, 1, 1), [0, 0, 255, 255])
  assert.equal(px(c, 0, 0)[3], 0)
})

test('변형: 행렬 왕복, 90° 회전 경계, 2배 확대 표본', () => {
  const t = { x: 10, y: 20, width: 40, height: 20, rotation: 90, flipH: false, flipV: false }
  const m = layerMatrix(t, 4, 2)
  const p = applyAffine(invertAffine(m), ...(Object.values(applyAffine(m, 1, 1)) as [number, number]))
  assert.ok(Math.abs(p.x - 1) < 1e-9 && Math.abs(p.y - 1) < 1e-9)
  const b = transformBounds(t)
  assert.deepEqual([b.w, b.h], [20, 40])
  let d = newDoc(8, 8, null)
  d = insertLayer(d, makeLayer('pixel', 'x', createBitmap(2, 2, [0, 255, 0, 255]), { x: 2, y: 2, width: 4, height: 4, rotation: 0, flipH: false, flipV: false }))
  assert.deepEqual(px(d, 3, 3), [0, 255, 0, 255])
  assert.equal(px(d, 7, 7)[3], 0)
})

test('실행취소: 기록·되돌리기·다시하기, 새 기록은 미래를 버린다', () => {
  let h = startHistory(newDoc(2, 2))
  const d1 = addBlankLayer(h.present)
  h = record(h, d1, '새 레이어')
  assert.equal(canUndo(h), true)
  h = undo(h)
  assert.equal(h.present.layers.length, 1)
  h = redo(h)
  assert.equal(h.present, d1)
  h = undo(h)
  h = record(h, addBlankLayer(h.present), '또')
  assert.equal(h.future.length, 0)
})

test('병합: 아래로 병합하면 한 장, 보이는 그림은 같다', () => {
  let d = newDoc(4, 4)
  d = insertLayer(d, { ...solidLayer(2, 2, [255, 0, 0, 255], 1, 1), opacity: 0.5 })
  const before = flattenDoc(d)
  d = mergeDown(d, d.activeId!)
  assert.equal(d.layers.length, 1)
  assert.deepEqual(Array.from(flattenDoc(d).data), Array.from(before.data))
})

test('캔버스: 크기·자르기·반전·90° 회전', () => {
  let d = newDoc(4, 2)
  d = insertLayer(d, solidLayer(1, 1, [255, 0, 0, 255], 0, 0))
  const r = resizeCanvas(d, 6, 4, 'c')
  assert.deepEqual(px(r, 1, 1), [255, 0, 0, 255])
  const c = cropDoc(d, { x: 0, y: 0, w: 2, h: 2 })
  assert.equal(c.width, 2)
  const f = flipCanvas(d, true)
  assert.deepEqual(px(f, 3, 0), [255, 0, 0, 255])
  const rot = rotateCanvas90(d, 1)
  assert.deepEqual([rot.width, rot.height], [2, 4])
  assert.deepEqual(px(rot, 1, 0), [255, 0, 0, 255])
})

test('선택: 사각·타원·합치기·반전·확장·마법봉·테두리', () => {
  const W = 10
  const a = makeSelection(W, W, rectMask(W, W, { x: 0, y: 0, w: 5, h: 5 }))!
  assert.deepEqual(a.bounds, { x: 0, y: 0, w: 5, h: 5 })
  const add = combine(a, W, W, rectMask(W, W, { x: 5, y: 5, w: 5, h: 5 }), 'add')!
  assert.equal(add.bounds!.w, 10)
  const sub = combine(a, W, W, rectMask(W, W, { x: 0, y: 0, w: 5, h: 2 }), 'subtract')!
  assert.equal(sub.bounds!.y, 2)
  const inv = invertSelection(a, W, W)!
  assert.equal(inv.mask[0], 0)
  assert.equal(inv.mask[99], 255)
  assert.equal(growSelection(a, 1)!.bounds!.w, 6)
  const e = ellipseMask(20, 20, { x: 0, y: 0, w: 20, h: 20 })
  assert.equal(e[10 * 20 + 10], 255)
  assert.equal(e[0], 0)
  const img = new Uint8ClampedArray(W * W * 4)
  for (let i = 0; i < W * W; i++) img.set(i % W < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
  const wand = magicWand(img, W, W, 1, 1, 10, true)
  assert.equal(wand.filter((v) => v).length, 30)
  assert.ok(selectionOutline(a).length > 0)
})

test('브러시: 팁 경도, 불투명도는 획 전체 상한, 지우개', () => {
  assert.equal(tipAlpha(0, 10, 0.5), 1)
  assert.equal(tipAlpha(10, 10, 0.5), 0)
  const base = createBitmap(20, 20, [255, 255, 255, 255])
  const s = new StrokeCoverage(20, 20, { size: 6, hardness: 1, opacity: 0.5 })
  s.lineTo(10, 10)
  s.lineTo(10, 10.1)
  for (let k = 0; k < 5; k++) s.lineTo(10 + k * 0.01, 10) // 같은 곳을 여러 번
  const out = applyStroke(base, s, [0, 0, 0], 'paint')
  const c = out.data.slice((10 * 20 + 10) * 4, (10 * 20 + 10) * 4 + 4)
  assert.ok(Math.abs(c[0] - 128) <= 2, `상한 0.5 → 회색 ${c[0]}`)
  const er = applyStroke(base, s, [0, 0, 0], 'erase')
  assert.ok(Math.abs(er.data[(10 * 20 + 10) * 4 + 3] - 128) <= 2)
})

test('PNG: 인코딩 → 디코딩 왕복 (필터 포함)', () => {
  const W = 17
  const H = 9
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256
  const png = encodePng(W, H, data, 300)
  const back = decodePng(png)
  assert.deepEqual([back.width, back.height, back.dpi], [W, H, 300])
  assert.deepEqual(Array.from(back.data), Array.from(data))
})

test('프로젝트: .shcomp 왕복 — 레이어·폴더·마스크·클리핑·합성 모드·효과 유지', () => {
  let d = newDoc(6, 6)
  d = insertLayer(d, { ...solidLayer(3, 3, [0, 128, 255, 200], 1, 2), blend: 'screen', opacity: 0.7 })
  d = updateLayer(d, d.activeId!, { mask: { bitmap: createBitmap(3, 3, [128, 128, 128, 255]), enabled: true, linked: true } })
  d = insertLayer(d, { ...solidLayer(6, 6, [255, 0, 0, 255]), clip: true })
  d = groupLayers(d, [d.layers[1].id, d.layers[2].id])
  const back = unpackProject(packProject(d))
  assert.equal(back.layers.length, d.layers.length)
  assert.deepEqual(
    back.layers.map((l) => [l.kind, l.blend, l.clip, !!l.mask]),
    d.layers.map((l) => [l.kind, l.blend, l.clip, !!l.mask])
  )
  assert.deepEqual(Array.from(flattenDoc(back).data), Array.from(flattenDoc(d).data), '합성 결과가 같다')
})
