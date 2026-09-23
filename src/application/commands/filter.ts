/** 필터 명령 — 가우시안·모션 블러·노이즈·렌즈 보정·언샤프 마스크·하이 패스·모자이크·중간값 */
import { adjustLayer } from '../../core/doc/pixels'
import { DEFAULT_FILTERS, type Filters } from '../../core/filters'
import { invalid } from '../errors'
import { object, onlyKeys, int, num, bool, oneOf, id, type Obj } from '../validate'
import type { DocCommand } from './types'
import { pixelLayer } from './types'

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
    const l = pixelLayer(doc, i.layerId, '필터')
    const next = adjustLayer(doc, l.id, null, i.filters, i.seed)
    return { doc: next, label: '필터', summary: `"${l.name}"에 ${i.filter} 적용${i.filter === 'addNoise' ? ` (seed ${i.seed})` : ''}${doc.selection ? ' (선택 영역만)' : ''}`, warnings: [] }
  }
}
