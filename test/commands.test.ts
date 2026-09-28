import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newDoc, getLayer } from '../src/core/doc/ops'
import { flattenDoc } from '../src/core/doc/render'
import { renderShape } from '../src/core/shape'
import { encodePng } from '../src/core/png'
import type { Doc } from '../src/core/doc/types'
import { COMMANDS, COMMAND_NAMES, CommandError, type DocCommand } from '../src/application'
import { TOOL_CATALOG } from '../src/application/catalog'
import { TOOL_NAMES, MUTATION_TOOL_NAMES } from '../src/server/mcp'
import { importDocument, exportDoc } from '../src/application/codecs'

const code = (c: string) => (e: unknown) => e instanceof CommandError && e.code === c
const run = <I>(cmd: DocCommand<I>, doc: Doc, raw: unknown): Doc => cmd.run(doc, cmd.parse(raw)).doc
const px = (d: Doc, x: number, y: number): number[] => {
  const f = flattenDoc(d)
  return Array.from(f.data.slice((y * f.width + x) * 4, (y * f.width + x) * 4 + 4))
}
const C = COMMANDS as Record<string, DocCommand<unknown>>

test('tool catalog, MCP schemas and command registry agree', () => {
  const withCommand = TOOL_CATALOG.filter((t) => t.command)
  assert.deepEqual(new Set(withCommand.map((t) => t.command)), new Set(COMMAND_NAMES), '모든 명령에 도구가 있고 그 반대도')
  assert.deepEqual(new Set(withCommand.map((t) => t.name)), new Set(MUTATION_TOOL_NAMES), '변경 도구마다 zod 스키마')
  assert.equal(new Set(TOOL_NAMES).size, TOOL_NAMES.length, '도구 이름 중복 없음')
  for (const t of TOOL_CATALOG) {
    assert.match(t.name, /^compositor_[a-z0-9_]+$/)
    assert.ok(t.lines.length && t.lines.every((l) => l.endsWith('.')), `${t.name} 설명은 문장`)
    assert.ok(t.mutates === !!t.command || ['compositor_document_undo', 'compositor_document_redo'].includes(t.name), t.name)
  }
  assert.equal(TOOL_CATALOG.length, 58)
})

test('shape rasterizer: fill, stroke, ellipse and line coverage', () => {
  const rect = renderShape({ kind: 'rect', w: 20, h: 10, fill: '#ff0000', stroke: '#0000ff', strokeWidth: 4, radius: 0 })
  const at = (b: typeof rect, x: number, y: number) => Array.from(b.data.slice((y * b.width + x) * 4, (y * b.width + x) * 4 + 4))
  assert.deepEqual(at(rect, rect.width >> 1, rect.height >> 1), [255, 0, 0, 255], '안은 채우기 색')
  assert.deepEqual(at(rect, 4, rect.height >> 1), [0, 0, 255, 255], '테두리는 외곽선 색')
  assert.equal(at(rect, 0, 0)[3], 0, '여백은 투명')
  const ell = renderShape({ kind: 'ellipse', w: 40, h: 20, fill: '#00ff00', stroke: null, strokeWidth: 0, radius: 0 })
  assert.equal(at(ell, 3, 3)[3], 0, '타원 모서리 밖은 투명')
  assert.deepEqual(at(ell, ell.width >> 1, ell.height >> 1), [0, 255, 0, 255])
  const line = renderShape({ kind: 'line', w: 30, h: 30, dir: 1, fill: null, stroke: '#000000', strokeWidth: 3, radius: 0 })
  assert.equal(at(line, line.width >> 1, line.height >> 1)[3], 255, '대각선 가운데')
  assert.equal(at(line, line.width - 3, 2)[3], 0, '반대 모서리는 비어 있음')
})

test('every command parses strict input and edits a document (smoke)', () => {
  let d = newDoc(40, 30)
  const bg = d.layers[0].id
  // 레이어
  d = run(C['layer.add'], d, { kind: 'pixel', name: 'top' })
  const top = d.activeId!
  assert.equal(getLayer(d, top)!.name, 'top')
  d = run(C['shape.add'], d, { kind: 'rect', x: 5, y: 5, width: 10, height: 10, fill: '#0000ff' })
  const shape = d.activeId!
  assert.deepEqual(px(d, 10, 10), [0, 0, 255, 255])
  d = run(C['layer.update'], d, { layerId: shape, shape: { fill: '#00ff00' } })
  assert.deepEqual(px(d, 10, 10), [0, 255, 0, 255])
  d = run(C['layer.update'], d, { layerId: shape, opacity: 0.5, effects: { stroke: { enabled: true, size: 2, color: '#ff0000' } } })
  assert.ok(getLayer(d, shape)!.effects!.stroke.enabled)
  assert.throws(() => C['layer.update'].parse({ layerId: shape, effects: { bogus: 1 } }), code('INVALID_INPUT'))
  d = run(C['layer.group'], d, { layerIds: [top, shape], name: 'g' })
  const g = d.layers.find((l) => l.kind === 'group')!.id
  assert.equal(getLayer(d, shape)!.parentId, g)
  d = run(C['layer.reorder'], d, { layerId: shape, targetId: top, where: 'below' })
  assert.ok(d.layers.findIndex((l) => l.id === shape) < d.layers.findIndex((l) => l.id === top))
  d = run(C['layer.ungroup'], d, { layerId: g })
  assert.equal(getLayer(d, shape)!.parentId, null)
  d = run(C['layer.duplicate'], d, { layerIds: [shape] })
  const dup = d.activeId!
  assert.notEqual(dup, shape)
  d = run(C['layer.delete'], d, { layerIds: [dup] })
  d = run(C['layer.add'], d, { kind: 'adjustment', adjustmentKind: 'hueSaturation', name: 'hsl' })
  const adj = d.activeId!
  d = run(C['layer.update'], d, { layerId: adj, adjustment: { saturation: -100 } })
  assert.equal(getLayer(d, adj)!.adjustment!.settings.saturation, -100)
  assert.equal(px(d, 10, 10)[0], px(d, 10, 10)[1], '조정 레이어가 회색으로')
  d = run(C['layer.delete'], d, { layerIds: [adj] })
  d = run(C['layer.setActive'], d, { layerId: bg })
  // 선택·픽셀
  d = run(C['selection.set'], d, { shape: 'rect', x: 0, y: 0, width: 20, height: 30 })
  assert.deepEqual(d.selection!.bounds, { x: 0, y: 0, w: 20, h: 30 })
  d = run(C['pixels.fill'], d, { layerId: bg, color: '#ff0000' })
  assert.deepEqual(px(d, 2, 2), [255, 0, 0, 255])
  assert.deepEqual(px(d, 30, 5), [255, 255, 255, 255], '선택 밖은 그대로')
  d = run(C['selection.set'], d, { shape: 'wand', x: 30, y: 5, layerId: bg, tolerance: 10 })
  assert.equal(d.selection!.bounds!.x, 20)
  d = run(C['selection.modify'], d, { op: 'contract', amount: 2 })
  d = run(C['pixels.erase'], d, { layerId: bg })
  assert.equal(px(d, 30, 15)[3], 0)
  d = run(C['selection.set'], d, { shape: 'invert' })
  d = run(C['selection.set'], d, { shape: 'none' })
  assert.equal(d.selection, null)
  d = run(C['brush.stroke'], d, {
    layerId: top,
    points: [
      { x: 5, y: 25 },
      { x: 35, y: 25 }
    ],
    color: '#000000',
    brush: { size: 6, hardness: 1 }
  })
  assert.deepEqual(px(d, 20, 25).slice(0, 3), [0, 0, 0])
  d = run(C['gradient.apply'], d, { layerId: top, from: { x: 0, y: 0 }, to: { x: 40, y: 0 }, color: '#ffffff', endColor: '#000000' })
  assert.ok(px(d, 2, 2)[0] > px(d, 37, 2)[0], '왼쪽이 밝다')
  d = run(C['retouch.stroke'], d, {
    layerId: top,
    points: [
      { x: 10, y: 25 },
      { x: 30, y: 25 }
    ],
    mode: 'blur',
    brush: { size: 10 },
    strength: 100
  })
  d = run(C['tone.stroke'], d, {
    layerId: top,
    points: [
      { x: 10, y: 25 },
      { x: 30, y: 25 }
    ],
    mode: 'burn',
    range: 'midtones',
    exposure: 80,
    brush: { size: 10 }
  })
  d = run(C['clone.stroke'], d, { layerId: top, points: [{ x: 30, y: 5 }], source: { x: 5, y: 5 }, brush: { size: 6, hardness: 1 } })
  d = run(C['heal.stroke'], d, { layerId: top, points: [{ x: 20, y: 5 }], brush: { size: 4 } })
  d = run(C['selection.set'], d, { shape: 'ellipse', x: 10, y: 10, width: 10, height: 10 })
  d = run(C['pixels.strokeSelection'], d, { layerId: top, width: 2, color: '#00ffff' })
  d = run(C['pixels.contentFill'], d, { layerId: bg })
  d = run(C['layer.viaCopy'], d, { layerId: bg, cut: false })
  assert.equal(d.layers.length, 4)
  d = run(C['layer.delete'], d, { layerIds: [d.activeId!] })
  d = run(C['layer.mask'], d, { layerId: top, op: 'fromSelection' })
  assert.ok(getLayer(d, top)!.mask)
  d = run(C['layer.mask'], d, { layerId: top, op: 'invert' })
  d = run(C['layer.mask'], d, { layerId: top, op: 'feather', radius: 2 })
  d = run(C['layer.update'], d, { layerId: top, maskEnabled: false })
  d = run(C['layer.mask'], d, { layerId: top, op: 'delete', apply: true })
  assert.equal(getLayer(d, top)!.mask, null)
  d = run(C['layer.flip'], d, { layerId: top, axis: 'horizontal' })
  assert.ok(getLayer(d, top)!.transform.flipH)
  // 보정·필터
  d = run(C['adjust.apply'], d, {
    layerId: bg,
    adjustment: {
      exposure: 1,
      curve: [
        { x: 0, y: 0 },
        { x: 255, y: 200 }
      ]
    }
  })
  assert.throws(() => C['adjust.apply'].parse({ layerId: bg, adjustment: {} }), code('INVALID_INPUT'))
  d = run(C['adjust.quick'], d, { layerId: bg, kind: 'invert' })
  d = run(C['adjust.more'], d, { layerId: bg, kind: 'posterize', levels: 2 })
  d = run(C['adjust.more'], d, { layerId: bg, kind: 'colorBalance', colorBalance: { midtones: [50, 0, -50] } })
  d = run(C['filter.apply'], d, { layerId: bg, filter: 'mosaic', params: { cellSize: 4 } })
  // 이미지
  d = run(C['image.canvasSize'], d, { width: 50, height: 40, anchor: 'nw', background: '#123456' })
  assert.equal(d.width, 50)
  assert.deepEqual(px(d, 45, 35), [0x12, 0x34, 0x56, 255])
  d = run(C['image.rotate'], d, { angle: 90 })
  assert.deepEqual([d.width, d.height], [40, 50])
  d = run(C['image.flip'], d, { axis: 'vertical' })
  d = run(C['document.guides'], d, { vertical: [10, 999], horizontal: [5] })
  assert.deepEqual(d.guides, { v: [10], h: [5] })
  d = run(C['image.resize'], d, { width: 20, height: 25 })
  d = run(C['image.crop'], d, { x: 2, y: 2, width: 10, height: 10, deleteCropped: true })
  assert.equal(getLayer(d, bg)!.bitmap!.width, 10)
  d = run(C['layer.add'], d, { kind: 'pixel' })
  d = run(C['image.flatten'], d, {})
  assert.equal(d.layers.length, 1)
  assert.throws(() => run(C['image.flatten'], d, {}), code('INVALID_INPUT'), '한 장이면 병합할 것이 없다')
  d = run(C['layer.add'], d, { kind: 'pixel' })
  d = run(C['layer.merge'], d, { mode: 'visible' })
  assert.equal(d.layers.length, 1)
  assert.throws(() => run(C['image.trim'], d, {}), code('INVALID_INPUT'))
  assert.throws(() => run(C['layer.delete'], d, { layerIds: [d.layers[0].id] }), code('INVALID_INPUT'))
})

test('codecs round-trip PNG, PSD and .shcomp documents', () => {
  let d = newDoc(16, 8, [10, 20, 30, 255])
  d = run(C['layer.add'], d, { kind: 'pixel', name: 'L2' })
  d = run(C['layer.update'], d, { layerId: d.activeId!, opacity: 0.4, blend: 'multiply' })
  for (const format of ['shcomp', 'psd'] as const) {
    const out = exportDoc(d, format)
    const back = importDocument(out.bytes, 'back', 1e6)
    assert.equal(back.doc.layers.length, 2, format)
    assert.equal(back.doc.layers[1].opacity, 0.4, format)
    assert.equal(back.doc.layers[1].blend, 'multiply', format)
  }
  const png = importDocument(encodePng(4, 4, new Uint8Array(64).fill(200)), 'p', 1e6)
  assert.deepEqual([png.doc.width, png.doc.height], [4, 4])
  assert.throws(() => importDocument(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), 'x', 1e6), code('UNSUPPORTED_CAPABILITY'))
})

test('extra adjustment layers (black & white etc.) are non-destructive and match the destructive result', () => {
  let d = newDoc(12, 8, [200, 60, 30, 255])
  const bg = d.layers[0].id
  d = run(C['layer.add'], d, { kind: 'adjustment', adjustmentKind: 'colorBalance', name: 'cb' })
  const adj = d.activeId!
  assert.equal(getLayer(d, adj)!.adjustment!.more!.kind, 'colorBalance')
  d = run(C['layer.update'], d, { layerId: adj, more: { colorBalance: { midtones: [-60, 0, 40] } } })
  const viaLayer = px(d, 5, 4)
  let e = newDoc(12, 8, [200, 60, 30, 255])
  e = run(C['adjust.more'], e, { layerId: e.layers[0].id, kind: 'colorBalance', colorBalance: { midtones: [-60, 0, 40] } })
  assert.deepEqual(viaLayer, px(e, 5, 4))
  assert.deepEqual(getLayer(d, bg)!.bitmap!.data.slice(0, 4), new Uint8ClampedArray([200, 60, 30, 255]), '원본은 그대로')
  d = run(C['layer.update'], d, { layerId: adj, more: { kind: 'threshold', threshold: 100 } })
  assert.ok([0, 255].includes(px(d, 5, 4)[0]))
  assert.throws(() => run(C['layer.update'], d, { layerId: bg, more: { kind: 'posterize' } }), code('INVALID_INPUT'))
  // PSD 왕복에서 조정 레이어 종류·값이 남는다
  const back = importDocument(exportDoc(d, 'psd').bytes, 'x', 1e6).doc
  const a = back.layers.find((l) => l.kind === 'adjustment')!.adjustment!
  assert.equal(a.kind, 'threshold')
  assert.equal(a.more!.threshold, 100)
})

test('gradient overlay and bevel effects render and survive PSD round-trip', () => {
  let d = newDoc(40, 30, null)
  d = run(C['shape.add'], d, { kind: 'rect', x: 5, y: 5, width: 30, height: 20, fill: '#808080' })
  const id = d.activeId!
  const plain = px(d, 20, 15)
  d = run(C['layer.update'], d, { layerId: id, effects: { gradientOverlay: { enabled: true, colors: ['#ff0000', '#0000ff'], angle: 0 } } })
  const left = px(d, 8, 15)
  const right = px(d, 32, 15)
  assert.ok(left[0] > 150 && right[2] > 150, `gradient ${left} ${right}`)
  d = run(C['layer.update'], d, { layerId: id, effects: { gradientOverlay: { enabled: false }, bevel: { enabled: true, style: 'inner', size: 4, depth: 200 } } })
  const top = px(d, 20, 7)
  const bottom = px(d, 20, 23)
  assert.ok(top[0] > plain[0] && bottom[0] < plain[0], `bevel top ${top} bottom ${bottom} plain ${plain}`)
  assert.throws(() => C['layer.update'].parse({ layerId: id, effects: { bevel: { style: 'fancy' } } }), code('INVALID_INPUT'))
  d = run(C['layer.update'], d, { layerId: id, effects: { gradientOverlay: { enabled: true } } })
  const back = importDocument(exportDoc(d, 'psd').bytes, 'x', 1e6).doc
  const fx = back.layers[1].effects!
  assert.equal(fx.bevel!.enabled, true)
  assert.equal(fx.bevel!.size, 4)
  assert.equal(fx.bevel!.depth, 200)
  assert.deepEqual(fx.gradientOverlay!.colors, ['#ff0000', '#0000ff'])
})

test('text runs: apply, split, merge and shift with edits', async () => {
  const { applyRun, shiftRuns, segments, normalize } = await import('../src/core/doc/textruns')
  let runs = applyRun(undefined, 2, 6, { bold: true }, 10)
  assert.deepEqual(runs, [{ start: 2, end: 6, bold: true }])
  runs = applyRun(runs, 4, 8, { color: '#ff0000' }, 10)
  assert.deepEqual(runs, [
    { start: 2, end: 4, bold: true },
    { start: 4, end: 6, bold: true, color: '#ff0000' },
    { start: 6, end: 8, color: '#ff0000' }
  ])
  runs = applyRun(runs, 0, 10, { bold: undefined }, 10)
  assert.deepEqual(runs, [{ start: 4, end: 8, color: '#ff0000' }])
  // 앞에 글자 2개 넣기 → 구간이 밀린다, 구간 안에서 1글자 지우기 → 줄어든다
  assert.deepEqual(shiftRuns(runs, 0, 0, 2), [{ start: 6, end: 10, color: '#ff0000' }])
  assert.deepEqual(shiftRuns(runs, 5, 1, 0), [{ start: 4, end: 7, color: '#ff0000' }])
  assert.equal(normalize([{ start: 3, end: 3, bold: true }]), undefined)
  assert.deepEqual(
    segments('0123456789', runs, 0, 10).map((s) => [s.start, s.end, !!s.style.color]),
    [
      [0, 4, false],
      [4, 8, true],
      [8, 10, false]
    ]
  )
})

test('paths: bezier flattening, path mask, vector mask compositing and commands', async () => {
  const { flattenSubPath, pathMask, effectiveMask } = await import('../src/core/doc/path')
  const circleish = {
    closed: true,
    anchors: [
      { x: 20, y: 5, out: { x: 28, y: 5 }, in: { x: 12, y: 5 } },
      { x: 35, y: 20, out: { x: 35, y: 28 }, in: { x: 35, y: 12 } },
      { x: 20, y: 35, out: { x: 12, y: 35 }, in: { x: 28, y: 35 } },
      { x: 5, y: 20, out: { x: 5, y: 12 }, in: { x: 5, y: 28 } }
    ]
  }
  const pts = flattenSubPath(circleish)
  assert.ok(pts.length > 20, '곡선은 여러 점으로')
  const m = pathMask(40, 40, [circleish])
  assert.equal(m[20 * 40 + 20], 255, '가운데는 안')
  assert.equal(m[2 * 40 + 2], 0, '모서리는 밖')
  let d = newDoc(40, 40, [255, 0, 0, 255])
  const bg = d.layers[0].id
  d = run(C['path.set'], d, { name: 'c', subpaths: [circleish] })
  const pathId = d.paths![0].id
  d = run(C['layer.vectorMask'], d, { layerId: bg, pathId })
  assert.equal(px(d, 20, 20)[3], 255)
  assert.equal(px(d, 2, 2)[3], 0, '벡터 마스크 밖은 투명')
  const em = effectiveMask(getLayer(d, bg)!, 40, 40)!
  assert.equal(em.bitmap.data[(20 * 40 + 20) * 4], 255)
  d = run(C['layer.update'], d, { layerId: bg, x: 10 })
  assert.equal(px(d, 30, 20)[3], 255, '레이어를 옮겨도 벡터 마스크는 문서 좌표에 그대로')
  assert.equal(px(d, 2, 2)[3], 0)
  d = run(C['layer.vectorMask'], d, { layerId: bg, pathId: null })
  assert.equal(px(d, 12, 2)[3], 255)
  d = run(C['path.toSelection'], d, { pathId })
  assert.ok(d.selection!.bounds!.w >= 28 && d.selection!.bounds!.w <= 32, JSON.stringify(d.selection!.bounds))
  d = run(C['selection.set'], d, { shape: 'none' })
  d = run(C['layer.add'], d, { kind: 'pixel' })
  const top = d.activeId!
  d = run(C['path.fill'], d, { pathId, layerId: top, color: '#00ff00' })
  assert.deepEqual(px(d, 20, 20), [0, 255, 0, 255])
  d = run(C['path.stroke'], d, { pathId, layerId: top, color: '#0000ff', brush: { size: 4, hardness: 1 } })
  assert.deepEqual(px(d, 20, 5).slice(0, 3), [0, 0, 255], `stroke ${px(d, 20, 5)}`)
  d = run(C['path.set'], d, {
    pathId,
    name: 'renamed',
    subpaths: [
      {
        closed: false,
        anchors: [
          { x: 0, y: 0 },
          { x: 10, y: 10 }
        ]
      }
    ]
  })
  assert.equal(d.paths![0].name, 'renamed')
  const back = importDocument(exportDoc(d, 'shcomp').bytes, 'x', 1e6).doc
  assert.equal(back.paths![0].id, pathId, '.shcomp 에 패스가 남는다')
  d = run(C['path.delete'], d, { pathId })
  assert.equal(d.paths, undefined)
  assert.throws(() => run(C['path.fill'], d, { pathId, layerId: top, color: '#000000' }), code('NOT_FOUND'))
})
