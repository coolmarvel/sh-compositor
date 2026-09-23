/** 선택 명령 — 만들기(전체·없음·반전·사각·타원·다각형·마법봉·레이어 픽셀)와 다듬기(확장·축소·페더·매끄럽게·이동) */
import type { Doc } from '../../core/doc/types'
import {
  selectAll,
  invertSelection,
  rectMask,
  ellipseMask,
  polygonMask,
  magicWand,
  combine,
  growSelection,
  featherSelection,
  smoothSelection,
  moveSelection,
  makeSelection,
  type SelectMode
} from '../../core/doc/selection'
import { flattenDoc, rasterizeLayer } from '../../core/doc/render'
import { MAX_SIDE } from '../../core/limits'
import { invalid } from '../errors'
import { object, onlyKeys, int, num, bool, oneOf, id } from '../validate'
import type { DocCommand } from './types'
import { requireLayer, points } from './types'

export interface SelectionSetInput {
  shape: 'all' | 'none' | 'invert' | 'rect' | 'ellipse' | 'polygon' | 'wand' | 'layerAlpha'
  mode: SelectMode
  x?: number
  y?: number
  width?: number
  height?: number
  points?: { x: number; y: number }[]
  tolerance?: number
  contiguous?: boolean
  sampleAll?: boolean
  layerId?: string
  antialias?: boolean
}
export const selectionSetCommand: DocCommand<SelectionSetInput> = {
  name: 'selection.set',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['shape', 'mode', 'x', 'y', 'width', 'height', 'points', 'tolerance', 'contiguous', 'sampleAll', 'layerId', 'antialias'])
    const shape = oneOf(o, 'shape', ['all', 'none', 'invert', 'rect', 'ellipse', 'polygon', 'wand', 'layerAlpha'] as const)
    const out: SelectionSetInput = { shape, mode: oneOf(o, 'mode', ['replace', 'add', 'subtract', 'intersect'] as const, 'replace')! }
    if (shape === 'rect' || shape === 'ellipse') {
      out.x = num(o, 'x', -MAX_SIDE, MAX_SIDE)
      out.y = num(o, 'y', -MAX_SIDE, MAX_SIDE)
      out.width = num(o, 'width', 1, MAX_SIDE)
      out.height = num(o, 'height', 1, MAX_SIDE)
    }
    if (shape === 'polygon') {
      out.points = points(o, 'points', 3)
      out.antialias = bool(o, 'antialias', true)
    }
    if (shape === 'wand') {
      out.x = num(o, 'x', 0, MAX_SIDE)
      out.y = num(o, 'y', 0, MAX_SIDE)
      out.tolerance = int(o, 'tolerance', 0, 255, 32)
      out.contiguous = bool(o, 'contiguous', true)
      out.sampleAll = bool(o, 'sampleAll', false)
      if (!out.sampleAll) out.layerId = id(o, 'layerId')
    }
    if (shape === 'layerAlpha') out.layerId = id(o, 'layerId')
    return out
  },
  run(doc, i) {
    const W = doc.width
    const H = doc.height
    let sel: Doc['selection']
    let summary: string
    if (i.shape === 'all') ((sel = selectAll(W, H)), (summary = '전체 선택'))
    else if (i.shape === 'none') ((sel = null), (summary = '선택 해제'))
    else if (i.shape === 'invert') ((sel = invertSelection(doc.selection, W, H)), (summary = '선택 반전'))
    else {
      let mask: Uint8Array
      if (i.shape === 'rect') mask = rectMask(W, H, { x: i.x!, y: i.y!, w: i.width!, h: i.height! })
      else if (i.shape === 'ellipse') mask = ellipseMask(W, H, { x: i.x!, y: i.y!, w: i.width!, h: i.height! })
      else if (i.shape === 'polygon') mask = polygonMask(W, H, i.points!, i.antialias)
      else if (i.shape === 'wand') {
        if (i.x! >= W || i.y! >= H) throw invalid('마법봉 점이 문서 밖입니다.')
        let rgba: Uint8ClampedArray
        if (i.sampleAll) rgba = flattenDoc(doc).data
        else {
          const l = requireLayer(doc, i.layerId!)
          rgba = flattenDoc({ ...doc, selection: null, layers: [{ ...l, parentId: null, clip: false, visible: true, blend: 'normal', opacity: 1 }] }).data
        }
        mask = magicWand(rgba, W, H, i.x!, i.y!, i.tolerance!, i.contiguous!, 1)
      } else {
        const l = requireLayer(doc, i.layerId!)
        const r = rasterizeLayer({ ...l, visible: true, opacity: 1 }, W, H)
        mask = new Uint8Array(W * H)
        if (r)
          for (let y = 0; y < r.height; y++)
            for (let x = 0; x < r.width; x++) {
              const dx = r.x + x
              const dy = r.y + y
              if (dx < 0 || dy < 0 || dx >= W || dy >= H) continue
              mask[dy * W + dx] = r.data[(y * r.width + x) * 4 + 3]
            }
      }
      sel = combine(doc.selection, W, H, mask, i.mode)
      summary = `${i.shape} 선택 (${i.mode})`
    }
    const b = sel?.bounds
    return { doc: { ...doc, selection: sel }, label: '선택', summary: b ? `${summary}: (${b.x}, ${b.y}) ${b.w}×${b.h}` : `${summary}: 선택 없음`, warnings: [] }
  }
}

export interface SelectionModifyInput {
  op: 'expand' | 'contract' | 'feather' | 'smooth' | 'move'
  amount?: number
  dx?: number
  dy?: number
}
export const selectionModifyCommand: DocCommand<SelectionModifyInput> = {
  name: 'selection.modify',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['op', 'amount', 'dx', 'dy'])
    const op = oneOf(o, 'op', ['expand', 'contract', 'feather', 'smooth', 'move'] as const)
    if (op === 'move') return { op, dx: int(o, 'dx', -MAX_SIDE, MAX_SIDE, 0)!, dy: int(o, 'dy', -MAX_SIDE, MAX_SIDE, 0)! }
    return { op, amount: num(o, 'amount', 0.5, 500) }
  },
  run(doc, i) {
    const s = doc.selection
    if (!s) throw invalid('선택 영역이 없습니다.')
    const next =
      i.op === 'expand'
        ? growSelection(s, i.amount!)
        : i.op === 'contract'
          ? growSelection(s, -i.amount!)
          : i.op === 'feather'
            ? featherSelection(s, i.amount!)
            : i.op === 'smooth'
              ? smoothSelection(s, i.amount!)
              : moveSelection(s, i.dx!, i.dy!)
    const label = { expand: '선택 확장', contract: '선택 축소', feather: '선택 페더', smooth: '선택 매끄럽게', move: '선택 이동' }[i.op]
    const b = next?.bounds
    return { doc: { ...doc, selection: next }, label, summary: b ? `${label}: (${b.x}, ${b.y}) ${b.w}×${b.h}` : `${label}: 선택이 비었습니다`, warnings: [] }
  }
}

export { makeSelection }
