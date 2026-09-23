/** 도형 명령 — 새 도형 레이어 (사각형·둥근 사각형·타원·선). 고치기는 layer.update { shape } */
import type { ShapeData } from '../../core/doc/types'
import { insertLayer, makeLayer } from '../../core/doc/ops'
import { identityTransform } from '../../core/doc/transform'
import { renderShape, shapePad } from '../../core/shape'
import { MAX_SIDE } from '../../core/limits'
import { invalid } from '../errors'
import { object, onlyKeys, num, oneOf, str } from '../validate'
import type { DocCommand } from './types'
import { colorOf } from './types'

const hex = (c: [number, number, number]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

export interface ShapeAddInput {
  kind: ShapeData['kind']
  x: number
  y: number
  width: number
  height: number
  fill: string | null
  stroke: string | null
  strokeWidth: number
  radius: number
  dir: 1 | -1
  name?: string
}
export const shapeAddCommand: DocCommand<ShapeAddInput> = {
  name: 'shape.add',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['kind', 'x', 'y', 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'radius', 'dir', 'name'])
    const kind = oneOf(o, 'kind', ['rect', 'roundRect', 'ellipse', 'line'] as const)
    const fill = o.fill === null || o.fill === undefined ? (kind === 'line' ? null : o.fill === null ? null : '#000000') : hex(colorOf(o, 'fill'))
    const stroke = o.stroke === null || o.stroke === undefined ? (kind === 'line' ? '#000000' : null) : hex(colorOf(o, 'stroke'))
    const out: ShapeAddInput = {
      kind,
      x: num(o, 'x', -MAX_SIDE, MAX_SIDE),
      y: num(o, 'y', -MAX_SIDE, MAX_SIDE),
      width: num(o, 'width', 0, MAX_SIDE),
      height: num(o, 'height', 0, MAX_SIDE),
      fill,
      stroke,
      strokeWidth: num(o, 'strokeWidth', 0, 200, kind === 'line' ? 4 : stroke ? 4 : 0)!,
      radius: num(o, 'radius', 0, 1000, 16)!,
      dir: (num(o, 'dir', -1, 1, 1) === -1 ? -1 : 1) as 1 | -1,
      name: str(o, 'name', 255, undefined)
    }
    if (out.width < 1 && out.height < 1) throw invalid('width 나 height 가 1 이상이어야 합니다.')
    if (!out.fill && !out.stroke) throw invalid('fill 과 stroke 가 둘 다 없으면 아무것도 그려지지 않습니다.')
    return out
  },
  run(doc, i) {
    const data: ShapeData = {
      kind: i.kind,
      w: i.width,
      h: i.height,
      dir: i.kind === 'line' ? i.dir : undefined,
      fill: i.fill,
      stroke: i.stroke,
      strokeWidth: i.stroke || i.kind === 'line' ? i.strokeWidth : 0,
      radius: i.radius
    }
    const bmp = renderShape(data)
    const pad = shapePad(data)
    const name = i.name ?? { rect: '사각형', roundRect: '둥근 사각형', ellipse: '타원', line: '선' }[i.kind]
    const next = insertLayer(doc, makeLayer('pixel', name, bmp, identityTransform(bmp.width, bmp.height, Math.round(i.x - pad), Math.round(i.y - pad)), { shape: data }))
    return { doc: next, label: '도형', summary: `"${name}" (${next.activeId}) ${i.width}×${i.height}`, warnings: [] }
  }
}
