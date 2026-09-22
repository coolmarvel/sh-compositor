/**
 * PSD 왕복 — 저장한 PSD 를 다시 열면 레이어·폴더·마스크·효과·조정·혼합·클리핑·해상도가 보존되는가.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writePsdUint8Array } from 'ag-psd'
import {
  newDoc,
  makeLayer,
  insertLayer,
  createBitmap,
  identityTransform,
  updateLayer,
  groupLayers,
  addAdjustmentLayer,
  flattenDoc,
  displayOrder,
  docToPsd,
  psdToDoc,
  isPsd,
  DEFAULT_EFFECTS,
  DEFAULT_ADJUST,
  type Doc
} from '../src/core/index'

function sample(): Doc {
  let d = newDoc(64, 48, [255, 255, 255, 255], 150)
  const red = createBitmap(20, 10, [220, 30, 30, 255])
  d = insertLayer(d, makeLayer('pixel', '빨강', red, identityTransform(20, 10, 5, 6), { blend: 'multiply', opacity: 0.5 }))
  const blue = createBitmap(10, 10, [30, 60, 220, 255])
  d = insertLayer(d, makeLayer('pixel', '파랑', blue, identityTransform(10, 10, 30, 20), { clip: true }))
  // 마스크 (왼쪽 절반 가림)
  const m = createBitmap(10, 10, [255, 255, 255, 255])
  for (let y = 0; y < 10; y++) for (let x = 0; x < 5; x++) m.data.set([0, 0, 0, 255], (y * 10 + x) * 4)
  const blueId = d.activeId!
  d = updateLayer(d, blueId, { mask: { bitmap: m, enabled: true, linked: true }, effects: { ...DEFAULT_EFFECTS, stroke: { enabled: true, size: 3, color: '#00ff00', opacity: 0.8, inside: false } } })
  d = groupLayers(d, [blueId])
  d = addAdjustmentLayer(d, 'levels', '레벨')
  d = updateLayer(d, d.activeId!, { adjustment: { kind: 'levels', settings: { ...DEFAULT_ADJUST, inBlack: 20, inWhite: 230, midtone: 1.3 } } })
  return d
}

test('PSD 저장 → 열기: 구조 보존', () => {
  const d = sample()
  const { bytes, warnings } = docToPsd(d)
  assert.ok(isPsd(bytes))
  assert.deepEqual(warnings, [])
  const { doc: r } = psdToDoc(bytes)
  assert.equal(r.width, 64)
  assert.equal(r.height, 48)
  assert.equal(r.resolution, 150)
  // 배열 순서(폴더가 자식 앞/뒤)는 달라도 화면에 보이는 트리 순서가 같아야 한다
  assert.deepEqual(
    displayOrder(r).map((x) => [x.layer.name, x.layer.kind, x.depth]),
    displayOrder(d).map((x) => [x.layer.name, x.layer.kind, x.depth])
  )
  const red = r.layers.find((l) => l.name === '빨강')!
  assert.equal(red.blend, 'multiply')
  assert.ok(Math.abs(red.opacity - 0.5) < 0.01)
  assert.equal(red.transform.x, 5)
  assert.equal(red.transform.y, 6)
  const blue = r.layers.find((l) => l.name === '파랑')!
  assert.equal(blue.clip, true)
  assert.ok(blue.mask && blue.mask.bitmap.data[0] === 0 && blue.mask.bitmap.data[(9 * 10 + 9) * 4] === 255)
  assert.ok(blue.effects?.stroke.enabled && blue.effects.stroke.size === 3 && blue.effects.stroke.color === '#00ff00')
  const grp = r.layers.find((l) => l.kind === 'group')!
  assert.equal(blue.parentId, grp.id)
  const lv = r.layers.find((l) => l.kind === 'adjustment')!
  assert.equal(lv.adjustment?.kind, 'levels')
  assert.equal(lv.adjustment?.settings.inBlack, 20)
  assert.equal(lv.adjustment?.settings.inWhite, 230)
})

test('PSD 왕복 후 합성 결과가 같다', () => {
  const d = sample()
  const r = psdToDoc(docToPsd(d).bytes).doc
  const a = flattenDoc(d)
  const b = flattenDoc(r)
  let worst = 0
  for (let i = 0; i < a.data.length; i++) worst = Math.max(worst, Math.abs(a.data[i] - b.data[i]))
  assert.ok(worst <= 2, `max diff ${worst}`)
})

test('변형(회전)된 레이어는 굽혀서 저장, 문자 레이어는 픽셀로 + 안내', () => {
  let d = newDoc(40, 40, null)
  d = insertLayer(d, makeLayer('pixel', '돌림', createBitmap(10, 10, [0, 0, 255, 255]), { ...identityTransform(10, 10, 15, 15), rotation: 45 }))
  d = insertLayer(
    d,
    makeLayer('text', '글자', createBitmap(8, 8, [0, 0, 0, 255]), identityTransform(8, 8, 1, 1), {
      text: { text: '가', font: 'Malgun Gothic', size: 8, color: '#000000', bold: false, italic: false, align: 'left', lineHeight: 1.2, tracking: 0, boxWidth: 8, boxHeight: 8 }
    })
  )
  const { bytes, warnings } = docToPsd(d)
  assert.ok(warnings.some((w) => w.includes('문자')))
  const r = psdToDoc(bytes).doc
  const rot = r.layers.find((l) => l.name === '돌림')!
  assert.equal(rot.transform.rotation, 0)
  assert.ok(rot.bitmap!.width > 10) // 45° 회전으로 넓어짐
})

test('Photoshop 전용 혼합 모드는 가까운 모드 + 안내, 합성 이미지만 있는 PSD 도 연다', () => {
  const layerPx = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) }
  const bytes = writePsdUint8Array({ width: 2, height: 2, children: [{ name: 'x', left: 0, top: 0, right: 2, bottom: 2, blendMode: 'linear dodge', imageData: layerPx }] })
  const r = psdToDoc(bytes)
  assert.equal(r.doc.layers[0].blend, 'screen')
  assert.ok(r.warnings.some((w) => w.includes('linear dodge')))
  const flatOnly = writePsdUint8Array({ width: 3, height: 3, imageData: { width: 3, height: 3, data: new Uint8ClampedArray(36).fill(255) } })
  const f = psdToDoc(flatOnly, '병합')
  assert.equal(f.doc.layers.length, 1)
  assert.equal(f.doc.layers[0].bitmap!.width, 3)
})

test('너무 큰 PSD 는 픽셀을 풀기 전에 거절', () => {
  const bytes = writePsdUint8Array({ width: 40000, height: 10, children: [] }, { psb: true })
  assert.throws(() => psdToDoc(bytes), /너무 큽니다/)
})
