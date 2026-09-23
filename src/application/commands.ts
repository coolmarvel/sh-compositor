/**
 * 문서 명령 (UI 독립) — 입력 검증 → 새 Doc. 활성 탭·React·window.api·대화상자를 모른다.
 * 데스크톱 편집기(`editor/commandBridge.ts`)와 서버(`service.ts`)가 같은 명령을 부른다 → UI 와 외부 호출의 결과가 같다.
 *
 * 좌표·크기는 문서 픽셀, 원점은 왼쪽 위. 색은 스트레이트 알파 RGBA. 보간은 CPU 합성과 같은 양선형(크게 줄이면 2배씩 먼저 축소).
 * 난수를 쓰는 명령(노이즈)은 seed 를 입력으로 받고 결과 요약에 남긴다.
 */
import type { Doc, Layer, BlendMode, LayerLock } from '../core/doc/types'
import { BLEND_MODES } from '../core/doc/types'
import { getLayer, updateLayer, resizeImage, cropDoc } from '../core/doc/ops'
import { adjustLayer, trimToCanvas } from '../core/doc/pixels'
import { DEFAULT_FILTERS, type Filters } from '../core/filters'
import { checkLimits, MAX_SIDE } from '../core/limits'
import { invalid, limit, unsupported, CommandError } from './errors'
import { object, onlyKeys, int, num, bool, str, oneOf, id, type Obj } from './validate'

export interface CommandOutput {
  doc: Doc
  /** 실행취소 이력 이름 */
  label: string
  /** 사람이 읽을 변경 요약 */
  summary: string
  warnings: string[]
}

export interface DocCommand<I> {
  name: string
  /** 입력을 검사해 명령 입력으로 (문서를 보지 않는 검사) */
  parse(raw: unknown): I
  /** 문서에 적용 (문서에 따른 검사 포함). 입력 doc 을 바꾸지 않는다 */
  run(doc: Doc, input: I): CommandOutput
  /** CPU·메모리를 크게 쓸 수 있는 명령 — 서버는 격리된 작업 실행기로 보낸다 */
  heavy?: boolean
  /** 결과 문서 크기를 계산 전에 알 수 있으면 (서버가 픽셀 한도를 미리 검사) */
  resultSize?(input: I): { width: number; height: number }
}

// ── image.resize ──
export interface ResizeInput {
  width: number
  height: number
  resolution?: number
  resampling: 'bilinear'
}
export const resizeCommand: DocCommand<ResizeInput> = {
  name: 'image.resize',
  // 변형 값만 바꾼다 (픽셀 복사 없음) — 결과 크기는 계산 전에 검사한다
  resultSize: (i) => ({ width: i.width, height: i.height }),
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['width', 'height', 'resolution', 'resampling'])
    const width = int(o, 'width', 1, MAX_SIDE)
    const height = int(o, 'height', 1, MAX_SIDE)
    const lim = checkLimits(width, height)
    if (lim) throw limit(lim, { width, height })
    return { width, height, resolution: num(o, 'resolution', 1, 10000, undefined), resampling: oneOf(o, 'resampling', ['bilinear'] as const, 'bilinear')! }
  },
  run(doc, i) {
    const next = resizeImage(doc, i.width, i.height, i.resolution ?? doc.resolution)
    return { doc: next, label: '이미지 크기', summary: `${doc.width}×${doc.height} → ${i.width}×${i.height}`, warnings: [] }
  }
}

// ── image.crop ──
export interface CropInput {
  x: number
  y: number
  width: number
  height: number
  deleteCropped: boolean
}
export const cropCommand: DocCommand<CropInput> = {
  name: 'image.crop',
  // 잘린 픽셀 삭제는 모든 레이어를 굽는다
  heavy: true,
  resultSize: (i) => ({ width: i.width, height: i.height }),
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['x', 'y', 'width', 'height', 'deleteCropped'])
    return {
      x: int(o, 'x', 0, MAX_SIDE),
      y: int(o, 'y', 0, MAX_SIDE),
      width: int(o, 'width', 1, MAX_SIDE),
      height: int(o, 'height', 1, MAX_SIDE),
      deleteCropped: bool(o, 'deleteCropped', false)!
    }
  },
  run(doc, i) {
    if (i.x + i.width > doc.width || i.y + i.height > doc.height) throw invalid(`자를 영역이 문서(${doc.width}×${doc.height}) 밖으로 나갑니다.`, { width: doc.width, height: doc.height })
    let next: Doc = { ...cropDoc(doc, { x: i.x, y: i.y, w: i.width, h: i.height }), selection: null }
    if (i.deleteCropped) next = trimToCanvas(next)
    return { doc: next, label: '자르기', summary: `(${i.x}, ${i.y}) ${i.width}×${i.height} 로 자름`, warnings: [] }
  }
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
  lock?: LayerLock
}
const BLEND_KEYS = BLEND_MODES.map((b) => b.key)
export const layerUpdateCommand: DocCommand<LayerUpdateInput> = {
  name: 'layer.update',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'name', 'visible', 'opacity', 'blend', 'clip', 'x', 'y', 'lock'])
    const out: LayerUpdateInput = {
      layerId: id(o, 'layerId'),
      name: str(o, 'name', 255, undefined),
      visible: bool(o, 'visible', undefined),
      opacity: num(o, 'opacity', 0, 1, undefined),
      blend: oneOf(o, 'blend', BLEND_KEYS, undefined),
      clip: bool(o, 'clip', undefined),
      x: num(o, 'x', -MAX_SIDE, MAX_SIDE, undefined),
      y: num(o, 'y', -MAX_SIDE, MAX_SIDE, undefined)
    }
    if (out.name !== undefined && !out.name.trim()) throw invalid('name 은 비워 둘 수 없습니다.', { field: 'name' })
    if (o.lock !== undefined) {
      const l = object(o.lock, 'lock')
      onlyKeys(l, ['alpha', 'pixels', 'position'], 'lock')
      out.lock = { alpha: bool(l, 'alpha', undefined), pixels: bool(l, 'pixels', undefined), position: bool(l, 'position', undefined) }
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
    if (i.x !== undefined || i.y !== undefined) {
      if (l.kind === 'group' || l.kind === 'adjustment') throw invalid('폴더·조정 레이어는 위치가 없습니다.', { layerId: l.id })
      if ((i.lock?.position ?? l.lock?.position) === true) throw new CommandError('FORBIDDEN', `"${l.name}" 레이어는 위치가 잠겨 있습니다.`)
      patch.transform = { ...l.transform, x: i.x ?? l.transform.x, y: i.y ?? l.transform.y }
      changed.push('위치')
    }
    if (i.lock) {
      const lock = { ...l.lock }
      for (const k of ['alpha', 'pixels', 'position'] as const) if (i.lock[k] !== undefined) lock[k] = i.lock[k]
      patch.lock = lock
      changed.push('잠금')
    }
    return { doc: updateLayer(doc, l.id, patch), label: '레이어 속성', summary: `"${l.name}": ${changed.join(', ')}`, warnings: [] }
  }
}

// ── filter.apply ──
export const FILTER_KINDS = ['gaussianBlur', 'motionBlur', 'addNoise', 'lensCorrection', 'unsharpMask', 'highPass', 'mosaic', 'median'] as const
export type FilterKind = (typeof FILTER_KINDS)[number]
export interface FilterInput {
  layerId: string
  filter: FilterKind
  filters: Filters
  seed: number
}
/** 필터별 매개변수 → core Filters (범위는 편집기 필터 대화상자와 같다) */
function filterParams(kind: FilterKind, p: Obj): Filters {
  const f: Filters = { ...DEFAULT_FILTERS }
  const keys: Record<FilterKind, string[]> = {
    gaussianBlur: ['radius'],
    motionBlur: ['distance', 'angle'],
    addNoise: ['amount', 'gaussian', 'mono'],
    lensCorrection: ['amount'],
    unsharpMask: ['amount', 'radius', 'threshold'],
    highPass: ['radius'],
    mosaic: ['cellSize'],
    median: ['radius']
  }
  onlyKeys(p, keys[kind], 'params')
  switch (kind) {
    case 'gaussianBlur':
      f.blur = num(p, 'radius', 0.5, 100)
      break
    case 'motionBlur':
      f.motionDistance = num(p, 'distance', 1, 200)
      f.motionAngle = num(p, 'angle', -180, 180, 0)!
      break
    case 'addNoise':
      f.noise = num(p, 'amount', 1, 100)
      f.noiseGaussian = bool(p, 'gaussian', true)!
      f.noiseMono = bool(p, 'mono', false)!
      break
    case 'lensCorrection':
      f.lens = num(p, 'amount', -100, 100)
      if (f.lens === 0) throw invalid('amount 는 0 이 아니어야 합니다.', { field: 'amount' })
      break
    case 'unsharpMask':
      f.sharpenAmount = num(p, 'amount', 1, 500)
      f.sharpenRadius = num(p, 'radius', 0.3, 20, 1)!
      f.sharpenThreshold = int(p, 'threshold', 0, 255, 0)!
      break
    case 'highPass':
      f.highPass = num(p, 'radius', 0.5, 50)
      break
    case 'mosaic':
      f.mosaic = int(p, 'cellSize', 2, 100)
      break
    case 'median':
      f.median = int(p, 'radius', 1, 10)
      break
  }
  return f
}
export const filterCommand: DocCommand<FilterInput> = {
  name: 'filter.apply',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'filter', 'params', 'seed'])
    const filter = oneOf(o, 'filter', FILTER_KINDS)
    const params = o.params === undefined ? {} : object(o.params, 'params')
    return { layerId: id(o, 'layerId'), filter, filters: filterParams(filter, params), seed: int(o, 'seed', 0, 0xffffffff, 7)! }
  },
  run(doc, i) {
    const l = requireLayer(doc, i.layerId)
    if (l.kind !== 'pixel') throw unsupported(l.kind === 'text' ? '문자 레이어에는 필터를 바로 걸 수 없습니다. 먼저 래스터화하세요.' : '필터는 픽셀 레이어에만 걸 수 있습니다.')
    if (l.lock?.pixels) throw new CommandError('FORBIDDEN', `"${l.name}" 레이어는 픽셀이 잠겨 있습니다.`)
    if (!l.bitmap) throw invalid('빈 레이어입니다.', { layerId: l.id })
    const next = adjustLayer(doc, l.id, null, i.filters, i.seed)
    return { doc: next, label: '필터', summary: `"${l.name}"에 ${i.filter} 적용${i.filter === 'addNoise' ? ` (seed ${i.seed})` : ''}`, warnings: [] }
  }
}

export function requireLayer(doc: Doc, layerId: string): Layer {
  const l = getLayer(doc, layerId)
  if (!l) throw new CommandError('NOT_FOUND', '레이어를 찾을 수 없습니다.', { layerId })
  return l
}

/** 이름 → 명령 (서버 작업 실행기가 이름으로 찾는다) */
export const COMMANDS = {
  [resizeCommand.name]: resizeCommand,
  [cropCommand.name]: cropCommand,
  [layerUpdateCommand.name]: layerUpdateCommand,
  [filterCommand.name]: filterCommand
} as Record<string, DocCommand<unknown>>

export type CommandName = 'image.resize' | 'image.crop' | 'layer.update' | 'filter.apply'
