/** 레이어 명령 — 속성·추가·삭제·복제·순서·폴더·병합·마스크·활성·반전·복사해서 새 레이어 */
import type { Doc, Layer, BlendMode, LayerLock, AdjustmentKind, LayerMask } from '../../core/doc/types'
import { BLEND_MODES, ADJUSTMENT_KINDS } from '../../core/doc/types'
import {
  updateLayer,
  addBlankLayer,
  addAdjustmentLayer,
  removeLayers,
  duplicateLayers,
  moveLayerBy,
  moveLayerTo,
  canMoveLayerBy,
  groupLayers,
  ungroup,
  mergeDown,
  mergeLayers,
  insertLayer,
  makeLayer,
  setActive,
  isEffectivelyVisible,
  getLayer
} from '../../core/doc/ops'
import { identityTransform } from '../../core/doc/transform'
import { bakeLayer, editPixels, selWeight, layerViaCopy } from '../../core/doc/pixels'
import { gaussianBlur } from '../../core/filters'
import { DEFAULT_ADJUST, type Adjustments } from '../../core/adjust'
import { DEFAULT_EFFECTS, DEFAULT_GLOW, type LayerEffects } from '../../core/effects'
import { MAX_SIDE } from '../../core/limits'
import { renderShape } from '../../core/shape'
import { invalid, unsupported, CommandError } from '../errors'
import { object, onlyKeys, int, num, bool, str, oneOf, id, type Obj } from '../validate'
import type { DocCommand } from './types'
import { requireLayer, layerIds, colorOf } from './types'
import { adjustmentsOf } from './adjust'

const BLEND_KEYS = BLEND_MODES.map((b) => b.key)
const hex = (c: [number, number, number]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

/** 레이어 효과 입력 (부분) → 전체 LayerEffects (있던 값 위에 덮음) */
export function effectsOf(raw: unknown, base: LayerEffects | null): LayerEffects {
  const o = object(raw, 'effects')
  onlyKeys(o, ['stroke', 'shadow', 'innerShadow', 'overlay', 'outerGlow'], 'effects')
  const cur: LayerEffects = { ...DEFAULT_EFFECTS, ...base, outerGlow: base?.outerGlow ?? DEFAULT_GLOW }
  const part = (key: keyof LayerEffects, keys: string[], fn: (p: Obj, prev: Obj) => Obj): void => {
    if (o[key] === undefined) return
    const p = object(o[key], `effects.${key}`)
    onlyKeys(p, keys, `effects.${key}`)
    ;(cur as unknown as Record<string, unknown>)[key] = fn(p, cur[key] as unknown as Obj)
  }
  const color = (p: Obj, prev: Obj): string => (p.color === undefined ? (prev.color as string) : hex(colorOf(p, 'color')))
  part('stroke', ['enabled', 'size', 'color', 'opacity', 'inside'], (p, prev) => ({
    enabled: bool(p, 'enabled', prev.enabled as boolean)!,
    size: num(p, 'size', 0, 200, prev.size as number)!,
    color: color(p, prev),
    opacity: num(p, 'opacity', 0, 1, prev.opacity as number)!,
    inside: bool(p, 'inside', prev.inside as boolean)!
  }))
  for (const k of ['shadow', 'innerShadow'] as const)
    part(k, ['enabled', 'angle', 'distance', 'blur', 'color', 'opacity'], (p, prev) => ({
      enabled: bool(p, 'enabled', prev.enabled as boolean)!,
      angle: num(p, 'angle', -360, 360, prev.angle as number)!,
      distance: num(p, 'distance', 0, 500, prev.distance as number)!,
      blur: num(p, 'blur', 0, 500, prev.blur as number)!,
      color: color(p, prev),
      opacity: num(p, 'opacity', 0, 1, prev.opacity as number)!
    }))
  part('overlay', ['enabled', 'color', 'opacity'], (p, prev) => ({
    enabled: bool(p, 'enabled', prev.enabled as boolean)!,
    color: color(p, prev),
    opacity: num(p, 'opacity', 0, 1, prev.opacity as number)!
  }))
  part('outerGlow', ['enabled', 'size', 'spread', 'color', 'opacity'], (p, prev) => ({
    enabled: bool(p, 'enabled', prev.enabled as boolean)!,
    size: num(p, 'size', 0, 500, prev.size as number)!,
    spread: num(p, 'spread', 0, 100, prev.spread as number)!,
    color: color(p, prev),
    opacity: num(p, 'opacity', 0, 1, prev.opacity as number)!
  }))
  return cur
}

// ── layer.update ──
export interface LayerUpdateInput {
  layerId: string
  name?: string
  visible?: boolean
  opacity?: number
  blend?: BlendMode
  clip?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  flipH?: boolean
  flipV?: boolean
  lock?: LayerLock
  effects?: unknown
  adjustment?: unknown
  shape?: Obj
  maskEnabled?: boolean
  maskLinked?: boolean
}
export const layerUpdateCommand: DocCommand<LayerUpdateInput> = {
  name: 'layer.update',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, [
      'layerId',
      'name',
      'visible',
      'opacity',
      'blend',
      'clip',
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'flipH',
      'flipV',
      'lock',
      'effects',
      'adjustment',
      'shape',
      'maskEnabled',
      'maskLinked'
    ])
    const out: LayerUpdateInput = {
      layerId: id(o, 'layerId'),
      name: str(o, 'name', 255, undefined),
      visible: bool(o, 'visible', undefined),
      opacity: num(o, 'opacity', 0, 1, undefined),
      blend: oneOf(o, 'blend', BLEND_KEYS, undefined),
      clip: bool(o, 'clip', undefined),
      x: num(o, 'x', -MAX_SIDE, MAX_SIDE, undefined),
      y: num(o, 'y', -MAX_SIDE, MAX_SIDE, undefined),
      width: num(o, 'width', 1, MAX_SIDE, undefined),
      height: num(o, 'height', 1, MAX_SIDE, undefined),
      rotation: num(o, 'rotation', -360, 360, undefined),
      flipH: bool(o, 'flipH', undefined),
      flipV: bool(o, 'flipV', undefined),
      maskEnabled: bool(o, 'maskEnabled', undefined),
      maskLinked: bool(o, 'maskLinked', undefined)
    }
    if (out.name !== undefined && !out.name.trim()) throw invalid('name 은 비워 둘 수 없습니다.', { field: 'name' })
    if (o.lock !== undefined) {
      const l = object(o.lock, 'lock')
      onlyKeys(l, ['alpha', 'pixels', 'position'], 'lock')
      out.lock = { alpha: bool(l, 'alpha', undefined), pixels: bool(l, 'pixels', undefined), position: bool(l, 'position', undefined) }
    }
    if (o.effects !== undefined) {
      effectsOf(o.effects, null) // 형식 검사 (실제 병합은 run 에서 있던 값 위에)
      out.effects = o.effects
    }
    if (o.adjustment !== undefined) {
      adjustmentsOf(o.adjustment, DEFAULT_ADJUST)
      out.adjustment = o.adjustment
    }
    if (o.shape !== undefined) {
      const s = object(o.shape, 'shape')
      onlyKeys(s, ['fill', 'stroke', 'strokeWidth', 'radius', 'w', 'h'], 'shape')
      out.shape = s
    }
    const changes = Object.entries(out).filter(([k, v]) => k !== 'layerId' && v !== undefined)
    if (!changes.length) throw invalid('바꿀 속성을 하나 이상 주세요.')
    return out
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    const patch: Partial<Layer> = {}
    const changed: string[] = []
    if (i.name !== undefined) ((patch.name = i.name.trim()), changed.push('이름'))
    if (i.visible !== undefined) ((patch.visible = i.visible), changed.push(i.visible ? '보이기' : '숨기기'))
    if (i.opacity !== undefined) ((patch.opacity = i.opacity), changed.push(`불투명도 ${Math.round(i.opacity * 100)}%`))
    if (i.blend !== undefined) {
      if (l.kind === 'group' && i.blend !== 'normal') throw unsupported('폴더의 혼합 모드는 표준만 지원합니다.')
      ;((patch.blend = i.blend), changed.push(`혼합 ${i.blend}`))
    }
    if (i.clip !== undefined) ((patch.clip = i.clip), changed.push(i.clip ? '클리핑' : '클리핑 해제'))
    const moves = i.x !== undefined || i.y !== undefined || i.width !== undefined || i.height !== undefined || i.rotation !== undefined || i.flipH !== undefined || i.flipV !== undefined
    if (moves) {
      if (l.kind === 'group' || l.kind === 'adjustment') throw invalid('폴더·조정 레이어는 위치·크기가 없습니다.', { layerId: l.id })
      if ((i.lock?.position ?? l.lock?.position) === true) throw new CommandError('FORBIDDEN', `"${l.name}" 레이어는 위치가 잠겨 있습니다.`)
      const t = l.transform
      patch.transform = {
        x: i.x ?? t.x,
        y: i.y ?? t.y,
        width: i.width ?? t.width,
        height: i.height ?? t.height,
        rotation: i.rotation ?? t.rotation,
        flipH: i.flipH ?? t.flipH,
        flipV: i.flipV ?? t.flipV
      }
      changed.push('변형')
    }
    if (i.lock) {
      const lock = { ...l.lock }
      for (const k of ['alpha', 'pixels', 'position'] as const) if (i.lock[k] !== undefined) lock[k] = i.lock[k]
      patch.lock = lock
      changed.push('잠금')
    }
    if (i.effects !== undefined) {
      if (l.kind === 'group' || l.kind === 'adjustment') throw unsupported('레이어 효과는 픽셀·문자 레이어에만 둘 수 있습니다.')
      patch.effects = effectsOf(i.effects, l.effects)
      changed.push('효과')
    }
    if (i.adjustment !== undefined) {
      if (l.kind !== 'adjustment' || !l.adjustment) throw invalid('adjustment 는 조정 레이어에만 줄 수 있습니다.', { layerId: l.id })
      patch.adjustment = { ...l.adjustment, settings: adjustmentsOf(i.adjustment, l.adjustment.settings) }
      changed.push('조정 설정')
    }
    if (i.maskEnabled !== undefined || i.maskLinked !== undefined) {
      if (!l.mask) throw invalid('마스크가 없는 레이어입니다.', { layerId: l.id })
      patch.mask = { ...l.mask, enabled: i.maskEnabled ?? l.mask.enabled, linked: i.maskLinked ?? l.mask.linked }
      changed.push('마스크 설정')
    }
    let next = updateLayer(doc, l.id, patch)
    if (i.shape !== undefined) {
      if (!l.shape) throw invalid('도형 레이어가 아닙니다.', { layerId: l.id })
      const s = i.shape
      const d = {
        ...l.shape,
        fill: s.fill === null ? null : s.fill === undefined ? l.shape.fill : hex(colorOf(s, 'fill')),
        stroke: s.stroke === null ? null : s.stroke === undefined ? l.shape.stroke : hex(colorOf(s, 'stroke')),
        strokeWidth: num(s, 'strokeWidth', 0, 200, l.shape.strokeWidth)!,
        radius: num(s, 'radius', 0, 1000, l.shape.radius)!,
        w: num(s, 'w', 0, MAX_SIDE, l.shape.w)!,
        h: num(s, 'h', 0, MAX_SIDE, l.shape.h)!
      }
      const bmp = renderShape(d)
      const cur = getLayer(next, l.id)!
      const t = cur.transform
      const cx = t.x + t.width / 2
      const cy = t.y + t.height / 2
      next = updateLayer(next, l.id, { shape: d, bitmap: bmp, transform: { ...t, x: cx - bmp.width / 2, y: cy - bmp.height / 2, width: bmp.width, height: bmp.height } })
      changed.push('도형')
    }
    return { doc: next, label: '레이어 속성', summary: `"${l.name}": ${changed.join(', ')}`, warnings: [] }
  }
}

// ── layer.add ──
export interface LayerAddInput {
  kind: 'pixel' | 'adjustment' | 'group' | 'image'
  name?: string
  adjustmentKind?: AdjustmentKind
  assetId?: string
  x?: number
  y?: number
  /** 이 레이어 위에 (없으면 활성 레이어 위) */
  aboveId?: string
}
export const layerAddCommand: DocCommand<LayerAddInput> = {
  name: 'layer.add',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['kind', 'name', 'adjustmentKind', 'assetId', 'x', 'y', 'aboveId'])
    const kind = oneOf(o, 'kind', ['pixel', 'adjustment', 'group', 'image'] as const)
    const out: LayerAddInput = { kind, name: str(o, 'name', 255, undefined), aboveId: o.aboveId === undefined ? undefined : id(o, 'aboveId') }
    if (kind === 'adjustment')
      out.adjustmentKind = oneOf(
        o,
        'adjustmentKind',
        ADJUSTMENT_KINDS.map((k) => k.key)
      )
    if (kind === 'image') {
      out.assetId = id(o, 'assetId')
      out.x = num(o, 'x', -MAX_SIDE, MAX_SIDE, undefined)
      out.y = num(o, 'y', -MAX_SIDE, MAX_SIDE, undefined)
    }
    return out
  },
  run(doc, i, ctx) {
    if (i.aboveId) requireLayer(doc, i.aboveId)
    const base = i.aboveId ? { ...doc, activeId: i.aboveId } : doc
    let next: Doc
    let label: string
    if (i.kind === 'pixel') {
      next = addBlankLayer(base, i.name)
      label = '새 레이어'
    } else if (i.kind === 'group') {
      next = insertLayer(base, makeLayer('group', i.name ?? '그룹', null, identityTransform(doc.width, doc.height)))
      label = '새 폴더'
    } else if (i.kind === 'adjustment') {
      const kl = ADJUSTMENT_KINDS.find((k) => k.key === i.adjustmentKind)!.label
      next = addAdjustmentLayer(base, i.adjustmentKind!, i.name ?? kl)
      label = `${kl} 조정 레이어`
    } else {
      if (!ctx?.loadImage) throw unsupported('이 실행 환경에서는 업로드한 그림을 레이어로 넣을 수 없습니다.')
      const { bitmap, name } = ctx.loadImage(i.assetId!)
      const x = i.x ?? Math.round((doc.width - bitmap.width) / 2)
      const y = i.y ?? Math.round((doc.height - bitmap.height) / 2)
      next = insertLayer(base, makeLayer('pixel', i.name ?? name, bitmap, identityTransform(bitmap.width, bitmap.height, x, y)))
      label = '가져오기'
    }
    const added = next.layers.find((l) => !doc.layers.some((k) => k.id === l.id))!
    return { doc: next, label, summary: `"${added.name}" (${added.id}) 추가`, warnings: [] }
  }
}

// ── layer.delete / duplicate / setActive / flip / viaCopy ──
export const layerDeleteCommand: DocCommand<{ layerIds: string[] }> = {
  name: 'layer.delete',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerIds'])
    return { layerIds: layerIds(o) }
  },
  run(doc, i) {
    for (const x of i.layerIds) requireLayer(doc, x)
    const next = removeLayers(doc, i.layerIds)
    if (!next.layers.length) throw invalid('마지막 레이어는 지울 수 없습니다.')
    return { doc: next, label: '레이어 삭제', summary: `${doc.layers.length - next.layers.length}장 삭제`, warnings: [] }
  }
}
export const layerDuplicateCommand: DocCommand<{ layerIds: string[] }> = {
  name: 'layer.duplicate',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerIds'])
    return { layerIds: layerIds(o) }
  },
  run(doc, i) {
    for (const x of i.layerIds) requireLayer(doc, x)
    const next = duplicateLayers(doc, i.layerIds)
    const added = next.layers.filter((l) => !doc.layers.some((k) => k.id === l.id)).map((l) => l.id)
    return { doc: next, label: '레이어 복제', summary: `복제: ${added.join(', ')}`, warnings: [] }
  }
}
export const layerSetActiveCommand: DocCommand<{ layerId: string }> = {
  name: 'layer.setActive',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId'])
    return { layerId: id(o, 'layerId') }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    return { doc: setActive(doc, l.id), label: '활성 레이어', summary: `"${l.name}" 활성`, warnings: [] }
  }
}
export const layerFlipCommand: DocCommand<{ layerId: string; axis: 'horizontal' | 'vertical' }> = {
  name: 'layer.flip',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'axis'])
    return { layerId: id(o, 'layerId'), axis: oneOf(o, 'axis', ['horizontal', 'vertical'] as const) }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (!l.bitmap) throw invalid('픽셀이 없는 레이어입니다.', { layerId: l.id })
    if (l.lock?.position) throw new CommandError('FORBIDDEN', `"${l.name}" 레이어는 위치가 잠겨 있습니다.`)
    const key = i.axis === 'horizontal' ? 'flipH' : 'flipV'
    return { doc: updateLayer(doc, l.id, { transform: { ...l.transform, [key]: !l.transform[key] } }), label: '레이어 반전', summary: `"${l.name}" ${i.axis} 반전`, warnings: [] }
  }
}
export const layerViaCopyCommand: DocCommand<{ layerId: string; cut: boolean }> = {
  name: 'layer.viaCopy',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'cut'])
    return { layerId: id(o, 'layerId'), cut: bool(o, 'cut', false)! }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (!l.bitmap) throw invalid('픽셀이 없는 레이어입니다.', { layerId: l.id })
    if (!doc.selection?.bounds) throw invalid('먼저 선택 영역을 만드세요 (selection.set).')
    if (i.cut && l.lock?.pixels) throw new CommandError('FORBIDDEN', `"${l.name}" 레이어는 픽셀이 잠겨 있습니다.`)
    const next = layerViaCopy({ ...doc, activeId: l.id }, i.cut)
    return { doc: next, label: i.cut ? '잘라서 새 레이어' : '복사해서 새 레이어', summary: `"${next.layers.find((x) => x.id === next.activeId)?.name}" 만듦`, warnings: [] }
  }
}

// ── layer.reorder ──
export interface ReorderInput {
  layerId: string
  by?: 1 | -1
  targetId?: string
  where?: 'above' | 'below' | 'inside'
}
export const layerReorderCommand: DocCommand<ReorderInput> = {
  name: 'layer.reorder',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'by', 'targetId', 'where'])
    const out: ReorderInput = { layerId: id(o, 'layerId') }
    if (o.by !== undefined) {
      const by = int(o, 'by', -1, 1)
      if (by === 0) throw invalid('by 는 1(앞으로) 또는 -1(뒤로) 이어야 합니다.', { field: 'by' })
      out.by = by as 1 | -1
    } else {
      out.targetId = id(o, 'targetId')
      out.where = oneOf(o, 'where', ['above', 'below', 'inside'] as const)
    }
    return out
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (i.by) {
      if (!canMoveLayerBy(doc, l.id, i.by)) throw invalid(i.by > 0 ? '이미 맨 앞입니다.' : '이미 맨 뒤입니다.')
      return { doc: moveLayerBy(doc, l.id, i.by), label: i.by > 0 ? '앞으로 가져오기' : '뒤로 보내기', summary: `"${l.name}" ${i.by > 0 ? '앞으로' : '뒤로'}`, warnings: [] }
    }
    const t = requireLayer(doc, i.targetId!)
    if (i.where === 'inside' && t.kind !== 'group') throw invalid('inside 는 폴더에만 쓸 수 있습니다.', { targetId: t.id })
    const next = moveLayerTo(doc, l.id, t.id, i.where!)
    if (next === doc) throw invalid('그 위치로는 옮길 수 없습니다 (자기 자신·자기 폴더 안).')
    return { doc: next, label: '레이어 순서', summary: `"${l.name}" → "${t.name}" ${i.where}`, warnings: [] }
  }
}

// ── layer.group / ungroup / merge ──
export const layerGroupCommand: DocCommand<{ layerIds: string[]; name?: string }> = {
  name: 'layer.group',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerIds', 'name'])
    return { layerIds: layerIds(o), name: str(o, 'name', 255, undefined) }
  },
  run(doc, i) {
    for (const x of i.layerIds) requireLayer(doc, x)
    let next = groupLayers(doc, i.layerIds)
    const g = next.layers.find((l) => !doc.layers.some((k) => k.id === l.id))!
    if (i.name) next = updateLayer(next, g.id, { name: i.name })
    return { doc: next, label: '그룹 만들기', summary: `폴더 ${g.id} 에 ${i.layerIds.length}장`, warnings: [] }
  }
}
export const layerUngroupCommand: DocCommand<{ layerId: string }> = {
  name: 'layer.ungroup',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId'])
    return { layerId: id(o, 'layerId') }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (l.kind !== 'group') throw invalid('폴더가 아닙니다.', { layerId: l.id })
    return { doc: ungroup(doc, l.id), label: '그룹 해제', summary: `"${l.name}" 해제`, warnings: [] }
  }
}
export interface MergeInput {
  mode: 'down' | 'layers' | 'visible'
  layerId?: string
  layerIds?: string[]
  name?: string
}
export const layerMergeCommand: DocCommand<MergeInput> = {
  name: 'layer.merge',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['mode', 'layerId', 'layerIds', 'name'])
    const mode = oneOf(o, 'mode', ['down', 'layers', 'visible'] as const)
    const out: MergeInput = { mode, name: str(o, 'name', 255, undefined) }
    if (mode === 'down') out.layerId = id(o, 'layerId')
    if (mode === 'layers') out.layerIds = layerIds(o)
    return out
  },
  run(doc, i) {
    if (i.mode === 'down') {
      const l = requireLayer(doc, i.layerId!)
      const next = mergeDown(doc, l.id)
      if (next === doc) throw invalid('아래에 병합할 레이어가 없습니다.', { layerId: l.id })
      return { doc: next, label: '아래 레이어와 병합', summary: `"${l.name}" 아래와 병합`, warnings: [] }
    }
    const ids = i.mode === 'layers' ? i.layerIds! : doc.layers.filter((l) => !l.parentId && isEffectivelyVisible(doc, l.id)).map((l) => l.id)
    for (const x of ids) requireLayer(doc, x)
    if (ids.length < 2) throw invalid('병합할 레이어가 2장 이상이어야 합니다.')
    const next = mergeLayers(doc, ids, i.name ?? (i.mode === 'visible' ? '병합됨' : undefined))
    return { doc: next, label: i.mode === 'visible' ? '보이는 레이어 병합' : '레이어 병합', summary: `${ids.length}장 병합`, warnings: [] }
  }
}

// ── layer.mask ──
export interface MaskInput {
  layerId: string
  op: 'add' | 'delete' | 'invert' | 'feather' | 'fromSelection'
  /** add: reveal(전부 보임)·hide(전부 가림)·selection(선택 영역만 보임) */
  initial?: 'reveal' | 'hide' | 'selection'
  /** delete: 적용하고 지울지 */
  apply?: boolean
  radius?: number
}
function newMask(doc: Doc, l: Layer, initial: 'reveal' | 'hide' | 'selection'): { doc: Doc; mask: LayerMask } {
  let base = doc
  let w = doc.width
  let h = doc.height
  let ox = 0
  let oy = 0
  if (l.bitmap) {
    base = bakeLayer(doc, l.id)
    const b = getLayer(base, l.id)!
    w = b.bitmap!.width
    h = b.bitmap!.height
    ox = Math.round(b.transform.x)
    oy = Math.round(b.transform.y)
  }
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = initial === 'hide' ? 0 : initial === 'selection' ? Math.round(selWeight(doc, x + ox, y + oy) * 255) : 255
      const o = (y * w + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }
  return { doc: base, mask: { bitmap: { width: w, height: h, data }, enabled: true, linked: true } }
}
export const layerMaskCommand: DocCommand<MaskInput> = {
  name: 'layer.mask',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'op', 'initial', 'apply', 'radius'])
    const op = oneOf(o, 'op', ['add', 'delete', 'invert', 'feather', 'fromSelection'] as const)
    return {
      layerId: id(o, 'layerId'),
      op,
      initial: oneOf(o, 'initial', ['reveal', 'hide', 'selection'] as const, 'reveal'),
      apply: bool(o, 'apply', false),
      radius: num(o, 'radius', 0.5, 200, undefined)
    }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (i.op === 'add') {
      if (l.mask) throw invalid('이미 마스크가 있습니다. 바꾸려면 fromSelection 또는 delete 를 쓰세요.', { layerId: l.id })
      if (i.initial === 'selection' && !doc.selection) throw invalid('선택 영역이 없습니다.')
      const { doc: base, mask } = newMask(doc, l, i.initial!)
      return { doc: updateLayer({ ...base, selection: null }, l.id, { mask }), label: '레이어 마스크 추가', summary: `"${l.name}" 마스크 (${i.initial})`, warnings: [] }
    }
    if (i.op === 'fromSelection') {
      if (!doc.selection) throw invalid('선택 영역이 없습니다.')
      const { doc: base, mask } = newMask(doc, l, 'selection')
      return { doc: updateLayer({ ...base, selection: null }, l.id, { mask }), label: '레이어 마스크 추가', summary: `"${l.name}" 마스크를 선택 영역으로`, warnings: [] }
    }
    if (!l.mask) throw invalid('마스크가 없는 레이어입니다.', { layerId: l.id })
    if (i.op === 'delete') {
      if (i.apply && l.bitmap) {
        const baked = bakeLayer(doc, l.id)
        const b = getLayer(baked, l.id)!
        const px = b.bitmap!.data.slice()
        const m = b.mask!.bitmap.data
        for (let k = 3; k < px.length; k += 4) px[k] = (px[k] * m[k - 3]) / 255
        return { doc: updateLayer(baked, l.id, { bitmap: { ...b.bitmap!, data: px }, mask: null }), label: '마스크 적용', summary: `"${l.name}" 마스크 적용`, warnings: [] }
      }
      return { doc: updateLayer(doc, l.id, { mask: null }), label: '마스크 삭제', summary: `"${l.name}" 마스크 삭제`, warnings: [] }
    }
    if (i.op === 'invert')
      return {
        doc: editPixels(doc, l.id, 'mask', undefined, (px) => {
          for (let k = 0; k < px.length; k += 4) px[k] = px[k + 1] = px[k + 2] = 255 - px[k]
        }),
        label: '마스크 반전',
        summary: `"${l.name}" 마스크 반전`,
        warnings: []
      }
    if (i.radius === undefined) throw invalid('feather 에는 radius 가 필요합니다.', { field: 'radius' })
    const r = i.radius
    return {
      doc: editPixels(doc, l.id, 'mask', undefined, (px, w, h) => {
        const blurred = gaussianBlur(px, w, h, r / 2)
        for (let k = 0; k < px.length; k += 4) px[k] = px[k + 1] = px[k + 2] = blurred[k]
      }),
      label: '마스크 페더',
      summary: `"${l.name}" 마스크 페더 ${r}px`,
      warnings: []
    }
  }
}

export type { Adjustments }
