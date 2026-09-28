/** 패스 명령 — 만들기/고치기·지우기·선택으로·채우기·붓으로 선 그리기·레이어 벡터 마스크 */
import type { Doc, Layer } from '../../core/doc/types'
import { updateLayer } from '../../core/doc/ops'
import { newPathId, pathMask, samplePath, pathBounds, type DocPath, type SubPath, type PathAnchor } from '../../core/doc/path'
import { combine, makeSelection, type SelectMode } from '../../core/doc/selection'
import { editPixels } from '../../core/doc/pixels'
import { StrokeCoverage, applyStroke, type BrushSettings } from '../../core/doc/brush'
import { bakeLayer, selWeight } from '../../core/doc/pixels'
import { getLayer } from '../../core/doc/ops'
import { MAX_SIDE } from '../../core/limits'
import { invalid, CommandError } from '../errors'
import { object, onlyKeys, bool, oneOf, str, id, num, type Obj } from '../validate'
import type { DocCommand } from './types'
import { requireLayer, pixelLayer, colorOf } from './types'
import { brushOf, brushSeed } from './pixels'

function ptOf(raw: unknown, what: string): { x: number; y: number } {
  const o = object(raw, what)
  onlyKeys(o, ['x', 'y'], what)
  return { x: num(o, 'x', -MAX_SIDE, MAX_SIDE), y: num(o, 'y', -MAX_SIDE, MAX_SIDE) }
}
/** 서브패스 입력: [{ closed, anchors: [{ x, y, in?, out? }] }] */
export function subpathsOf(o: Obj, key = 'subpaths'): SubPath[] {
  const v = o[key]
  if (!Array.isArray(v) || !v.length || v.length > 256) throw invalid(`${key}는 서브패스 1~256개의 배열이어야 합니다.`, { field: key })
  return v.map((spRaw, i) => {
    const sp = object(spRaw, `${key}[${i}]`)
    onlyKeys(sp, ['closed', 'anchors'], `${key}[${i}]`)
    const anchors = sp.anchors
    if (!Array.isArray(anchors) || anchors.length < 2 || anchors.length > 5000) throw invalid(`${key}[${i}].anchors 는 앵커 2~5000개여야 합니다.`, { field: key })
    return {
      closed: bool(sp, 'closed', true)!,
      anchors: anchors.map((aRaw, k): PathAnchor => {
        const a = object(aRaw, `${key}[${i}].anchors[${k}]`)
        onlyKeys(a, ['x', 'y', 'in', 'out'], `${key}[${i}].anchors[${k}]`)
        const out: PathAnchor = { x: num(a, 'x', -MAX_SIDE, MAX_SIDE), y: num(a, 'y', -MAX_SIDE, MAX_SIDE) }
        if (a.in !== undefined && a.in !== null) out.in = ptOf(a.in, 'in')
        if (a.out !== undefined && a.out !== null) out.out = ptOf(a.out, 'out')
        return out
      })
    }
  })
}
export function requirePath(doc: Doc, pathId: string): DocPath {
  const p = doc.paths?.find((x) => x.id === pathId)
  if (!p) throw new CommandError('NOT_FOUND', '패스를 찾을 수 없습니다.', { pathId })
  return p
}

// ── path.set ──
export interface PathSetInput {
  pathId?: string
  name?: string
  subpaths: SubPath[]
}
export const pathSetCommand: DocCommand<PathSetInput> = {
  name: 'path.set',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['pathId', 'name', 'subpaths'])
    return { pathId: o.pathId === undefined ? undefined : id(o, 'pathId'), name: str(o, 'name', 255, undefined), subpaths: subpathsOf(o) }
  },
  run(doc, i) {
    const paths = doc.paths ?? []
    if (i.pathId) {
      const p = requirePath(doc, i.pathId)
      const next = { ...p, name: i.name ?? p.name, subpaths: i.subpaths }
      return {
        doc: { ...doc, paths: paths.map((x) => (x.id === p.id ? next : x)) },
        label: '패스 고치기',
        summary: `"${next.name}" (${p.id}) 앵커 ${i.subpaths.reduce((a, s) => a + s.anchors.length, 0)}개`,
        warnings: []
      }
    }
    const p: DocPath = { id: newPathId(), name: i.name ?? `패스 ${paths.length + 1}`, subpaths: i.subpaths }
    return { doc: { ...doc, paths: [...paths, p] }, label: '패스', summary: `"${p.name}" (${p.id}) 만듦`, warnings: [] }
  }
}
export const pathDeleteCommand: DocCommand<{ pathId: string }> = {
  name: 'path.delete',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['pathId'])
    return { pathId: id(o, 'pathId') }
  },
  run(doc, i) {
    const p = requirePath(doc, i.pathId)
    const paths = (doc.paths ?? []).filter((x) => x.id !== p.id)
    return { doc: { ...doc, paths: paths.length ? paths : undefined }, label: '패스 삭제', summary: `"${p.name}" 삭제`, warnings: [] }
  }
}

// ── path.toSelection ──
export const pathToSelectionCommand: DocCommand<{ pathId: string; mode: SelectMode }> = {
  name: 'path.toSelection',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['pathId', 'mode'])
    return { pathId: id(o, 'pathId'), mode: oneOf(o, 'mode', ['replace', 'add', 'subtract', 'intersect'] as const, 'replace')! }
  },
  run(doc, i) {
    const p = requirePath(doc, i.pathId)
    const sel = combine(doc.selection, doc.width, doc.height, pathMask(doc.width, doc.height, p.subpaths), i.mode)
    const b = sel?.bounds
    return { doc: { ...doc, selection: sel }, label: '패스를 선택으로', summary: b ? `(${b.x}, ${b.y}) ${b.w}×${b.h}` : '선택 없음', warnings: [] }
  }
}

// ── path.fill ──
export const pathFillCommand: DocCommand<{ pathId: string; layerId: string; color: [number, number, number]; opacity: number }> = {
  name: 'path.fill',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['pathId', 'layerId', 'color', 'opacity'])
    return { pathId: id(o, 'pathId'), layerId: id(o, 'layerId'), color: colorOf(o, 'color'), opacity: num(o, 'opacity', 0, 1, 1)! }
  },
  run(doc, i) {
    const p = requirePath(doc, i.pathId)
    const l = pixelLayer(doc, i.layerId, '패스 채우기')
    const mask = pathMask(doc.width, doc.height, p.subpaths)
    const b = pathBounds(p.subpaths)
    if (!b) throw invalid('빈 패스입니다.')
    const out = editPixels(doc, l.id, 'layer', b, (px, w, h, ox, oy) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const dx = x + ox
          const dy = y + oy
          if (dx < 0 || dy < 0 || dx >= doc.width || dy >= doc.height) continue
          const a = (mask[dy * doc.width + dx] / 255) * i.opacity
          if (a <= 0) continue
          const k = (y * w + x) * 4
          const da = px[k + 3] / 255
          const oa = a + da * (1 - a)
          for (let c = 0; c < 3; c++) px[k + c] = (i.color[c] * a + px[k + c] * da * (1 - a)) / oa
          px[k + 3] = oa * 255
        }
    })
    return { doc: out, label: '패스 채우기', summary: `"${p.name}" 을 "${l.name}" 에 채움`, warnings: [] }
  }
}

// ── path.stroke (붓으로 선) ──
export interface PathStrokeInput {
  pathId: string
  layerId: string
  color: [number, number, number]
  brush: BrushSettings
  seed: number
  mode: 'paint' | 'erase'
}
export const pathStrokeCommand: DocCommand<PathStrokeInput> = {
  name: 'path.stroke',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['pathId', 'layerId', 'color', 'brush', 'mode'])
    return {
      pathId: id(o, 'pathId'),
      layerId: id(o, 'layerId'),
      color: colorOf(o, 'color', '#000000'),
      brush: brushOf(o),
      seed: brushSeed(o),
      mode: oneOf(o, 'mode', ['paint', 'erase'] as const, 'paint')!
    }
  },
  run(doc, i) {
    const p = requirePath(doc, i.pathId)
    const l = pixelLayer(doc, i.layerId, '패스 선 그리기')
    const base = bakeLayer(doc, l.id, { x: 0, y: 0, w: doc.width, h: doc.height })
    const bl = getLayer(base, l.id)!
    const bmp = bl.bitmap!
    const ox = Math.round(bl.transform.x)
    const oy = Math.round(bl.transform.y)
    const stroke = new StrokeCoverage(bmp.width, bmp.height, i.brush, i.seed)
    for (const line of samplePath(p.subpaths, Math.max(0.5, i.brush.size * 0.02))) for (const q of line) stroke.lineTo(q.x - ox, q.y - oy)
    const limit = base.selection ? (k: number) => selWeight(base, (k % bmp.width) + ox, ((k / bmp.width) | 0) + oy) : undefined
    const out = applyStroke(bmp, stroke, i.color, i.mode, limit)
    if (bl.lock?.alpha) for (let k = 3; k < out.data.length; k += 4) out.data[k] = bmp.data[k]
    return { doc: updateLayer(base, l.id, { bitmap: out, shape: undefined }), label: '패스 선 그리기', summary: `"${p.name}" 을 "${l.name}" 에 붓으로`, warnings: [] }
  }
}

// ── layer.vectorMask ──
export const layerVectorMaskCommand: DocCommand<{ layerId: string; pathId: string | null; inverted: boolean; enabled: boolean }> = {
  name: 'layer.vectorMask',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'pathId', 'inverted', 'enabled'])
    return { layerId: id(o, 'layerId'), pathId: o.pathId === null ? null : id(o, 'pathId'), inverted: bool(o, 'inverted', false)!, enabled: bool(o, 'enabled', true)! }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (i.pathId === null) {
      if (!l.vectorMask) throw invalid('벡터 마스크가 없는 레이어입니다.', { layerId: l.id })
      const next: Layer = { ...l }
      delete next.vectorMask
      return { doc: { ...doc, layers: doc.layers.map((x) => (x.id === l.id ? next : x)) }, label: '벡터 마스크 삭제', summary: `"${l.name}" 벡터 마스크 삭제`, warnings: [] }
    }
    const p = requirePath(doc, i.pathId)
    // 패스의 복사본을 붙인다 (패스를 나중에 고쳐도 마스크는 그대로 — 포토샵도 패스 패널의 '벡터 마스크 패스'는 별개)
    const vectorMask = { subpaths: JSON.parse(JSON.stringify(p.subpaths)) as SubPath[], enabled: i.enabled, inverted: i.inverted || undefined }
    return { doc: updateLayer(doc, l.id, { vectorMask }), label: '벡터 마스크', summary: `"${l.name}" 에 "${p.name}" 벡터 마스크`, warnings: [] }
  }
}

export { makeSelection }
