/** 보정 명령 — 레벨·커브·색조/채도·노출 등(Adjustments), 빠른 보정(반전·채도 감소·자동), 흑백·색상 균형·활기·포스터화·한계값 */
import { DEFAULT_ADJUST, DEFAULT_TONE, COLOR_RANGES, autoLevelsFor, histogram, hasAdjust, type Adjustments, type CurvePoint, type ChannelTone, type AutoLevelsMode } from '../../core/adjust'
import { DEFAULT_MORE, DEFAULT_BW, DEFAULT_CB, applyMoreAdjust, type MoreAdjust, type MoreAdjustKind } from '../../core/adjust2'
import { getLayer } from '../../core/doc/ops'
import { bakeLayer, adjustLayer, editPixels } from '../../core/doc/pixels'
import { invalid } from '../errors'
import { object, onlyKeys, int, num, bool, oneOf, id, type Obj } from '../validate'
import type { DocCommand } from './types'
import { pixelLayer, colorOf } from './types'

const hex = (c: [number, number, number]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')

function curveOf(o: Obj, key: string, prev: CurvePoint[]): CurvePoint[] {
  const v = o[key]
  if (v === undefined) return prev
  if (!Array.isArray(v) || v.length < 2 || v.length > 32) throw invalid(`${key}는 점 2~32개여야 합니다.`, { field: key })
  const pts = v.map((p, i) => {
    const q = object(p, `${key}[${i}]`)
    onlyKeys(q, ['x', 'y'], `${key}[${i}]`)
    return { x: num(q, 'x', 0, 255), y: num(q, 'y', 0, 255) }
  })
  for (let i = 1; i < pts.length; i++) if (pts[i].x <= pts[i - 1].x) throw invalid(`${key}의 x 는 오름차순이어야 합니다.`, { field: key })
  return pts
}
function toneOf(raw: unknown, prev: ChannelTone, what: string): ChannelTone {
  const o = object(raw, what)
  onlyKeys(o, ['inBlack', 'inWhite', 'midtone', 'outBlack', 'outWhite', 'curve'], what)
  return {
    inBlack: int(o, 'inBlack', 0, 254, prev.inBlack)!,
    inWhite: int(o, 'inWhite', 1, 255, prev.inWhite)!,
    midtone: num(o, 'midtone', 0.1, 9.99, prev.midtone)!,
    outBlack: int(o, 'outBlack', 0, 255, prev.outBlack)!,
    outWhite: int(o, 'outWhite', 0, 255, prev.outWhite)!,
    curve: curveOf(o, 'curve', prev.curve)
  }
}

/** 부분 입력 → 전체 Adjustments (base 위에 덮음). 편집기 조정 대화상자와 같은 범위 */
export function adjustmentsOf(raw: unknown, base: Adjustments): Adjustments {
  const o = object(raw, 'adjustment')
  onlyKeys(
    o,
    [
      'exposure',
      'offset',
      'gamma',
      'inBlack',
      'inWhite',
      'midtone',
      'outBlack',
      'outWhite',
      'curve',
      'hue',
      'saturation',
      'lightness',
      'grain',
      'invert',
      'gradientMap',
      'channels',
      'hueRanges',
      'colorize'
    ],
    'adjustment'
  )
  const a: Adjustments = {
    ...base,
    exposure: num(o, 'exposure', -5, 5, base.exposure)!,
    offset: num(o, 'offset', -0.5, 0.5, base.offset)!,
    gamma: num(o, 'gamma', 0.1, 3, base.gamma)!,
    inBlack: int(o, 'inBlack', 0, 254, base.inBlack)!,
    inWhite: int(o, 'inWhite', 1, 255, base.inWhite)!,
    midtone: num(o, 'midtone', 0.1, 9.99, base.midtone)!,
    outBlack: int(o, 'outBlack', 0, 255, base.outBlack)!,
    outWhite: int(o, 'outWhite', 0, 255, base.outWhite)!,
    curve: curveOf(o, 'curve', base.curve),
    hue: num(o, 'hue', -180, 180, base.hue)!,
    saturation: num(o, 'saturation', -100, 100, base.saturation)!,
    lightness: num(o, 'lightness', -100, 100, base.lightness)!,
    grain: num(o, 'grain', 0, 100, base.grain)!,
    invert: bool(o, 'invert', base.invert)!,
    colorize: bool(o, 'colorize', base.colorize)!
  }
  if (a.inBlack >= a.inWhite) throw invalid('inBlack 은 inWhite 보다 작아야 합니다.', { field: 'inBlack' })
  if (o.gradientMap !== undefined) {
    if (o.gradientMap === null) a.gradientMap = null
    else {
      const g = object(o.gradientMap, 'gradientMap')
      onlyKeys(g, ['shadows', 'highlights', 'reversed'], 'gradientMap')
      a.gradientMap = { shadows: hex(colorOf(g, 'shadows')), highlights: hex(colorOf(g, 'highlights')), reversed: bool(g, 'reversed', false)! }
    }
  }
  if (o.channels !== undefined) {
    const c = object(o.channels, 'channels')
    onlyKeys(c, ['r', 'g', 'b'], 'channels')
    a.channels = { ...base.channels }
    for (const k of ['r', 'g', 'b'] as const) if (c[k] !== undefined) a.channels[k] = toneOf(c[k], base.channels[k] ?? DEFAULT_TONE, `channels.${k}`)
  }
  if (o.hueRanges !== undefined) {
    const h = object(o.hueRanges, 'hueRanges')
    const keys = COLOR_RANGES.map((r) => r.key)
    onlyKeys(h, keys, 'hueRanges')
    a.hueRanges = { ...base.hueRanges }
    for (const k of keys)
      if (h[k] !== undefined) {
        const r = object(h[k], `hueRanges.${k}`)
        onlyKeys(r, ['hue', 'saturation', 'lightness'], `hueRanges.${k}`)
        a.hueRanges[k] = { hue: num(r, 'hue', -180, 180, 0)!, saturation: num(r, 'saturation', -100, 100, 0)!, lightness: num(r, 'lightness', -100, 100, 0)! }
      }
  }
  return a
}

// ── adjust.apply (파괴적, 선택 영역 한정) ──
export const adjustApplyCommand: DocCommand<{ layerId: string; adjustments: Adjustments }> = {
  name: 'adjust.apply',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'adjustment'])
    const adjustments = adjustmentsOf(o.adjustment ?? {}, DEFAULT_ADJUST)
    if (!hasAdjust(adjustments)) throw invalid('바꾸는 값이 없습니다 (기본값과 같음).')
    return { layerId: id(o, 'layerId'), adjustments }
  },
  run(doc, i) {
    const l = pixelLayer(doc, i.layerId, '보정')
    return { doc: adjustLayer(doc, l.id, i.adjustments, null), label: '보정', summary: `"${l.name}" 보정${doc.selection ? ' (선택 영역만)' : ''}`, warnings: [] }
  }
}

// ── adjust.quick ──
export const adjustQuickCommand: DocCommand<{ layerId: string; kind: 'invert' | 'desaturate' | AutoLevelsMode }> = {
  name: 'adjust.quick',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'kind'])
    return { layerId: id(o, 'layerId'), kind: oneOf(o, 'kind', ['invert', 'desaturate', 'contrast', 'color', 'neutral'] as const) }
  },
  run(doc, i) {
    const l = pixelLayer(doc, i.layerId, '보정')
    let a: Adjustments
    if (i.kind === 'invert') a = { ...DEFAULT_ADJUST, invert: true }
    else if (i.kind === 'desaturate') a = { ...DEFAULT_ADJUST, saturation: -100 }
    else {
      const baked = getLayer(bakeLayer(doc, l.id), l.id)!
      const auto = autoLevelsFor(histogram(baked.bitmap!.data), i.kind)
      if (!auto) throw invalid('이미 범위를 다 쓰고 있어 바꿀 것이 없습니다.')
      a = { ...DEFAULT_ADJUST, ...auto }
    }
    const label = { invert: '반전', desaturate: '채도 감소', contrast: '자동 대비', color: '자동 색상', neutral: '자동 톤' }[i.kind]
    return { doc: adjustLayer(doc, l.id, a, null), label, summary: `"${l.name}" ${label}`, warnings: [] }
  }
}

// ── adjust.more ──
export const MORE_KINDS: MoreAdjustKind[] = ['blackWhite', 'colorBalance', 'vibrance', 'posterize', 'threshold']
export const adjustMoreCommand: DocCommand<{ layerId: string; more: MoreAdjust }> = {
  name: 'adjust.more',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['layerId', 'kind', 'blackWhite', 'colorBalance', 'vibrance', 'saturation', 'levels', 'threshold'])
    const kind = oneOf(o, 'kind', MORE_KINDS)
    const more: MoreAdjust = { ...DEFAULT_MORE, kind }
    if (kind === 'blackWhite' && o.blackWhite !== undefined) {
      const b = object(o.blackWhite, 'blackWhite')
      const keys = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'] as const
      onlyKeys(b, keys, 'blackWhite')
      more.bw = { ...DEFAULT_BW }
      for (const k of keys) more.bw[k] = num(b, k, -200, 300, DEFAULT_BW[k])!
    }
    if (kind === 'colorBalance' && o.colorBalance !== undefined) {
      const c = object(o.colorBalance, 'colorBalance')
      onlyKeys(c, ['shadows', 'midtones', 'highlights', 'preserveLuminosity'], 'colorBalance')
      more.cb = { ...DEFAULT_CB, preserveLuminosity: bool(c, 'preserveLuminosity', true)! }
      for (const k of ['shadows', 'midtones', 'highlights'] as const)
        if (c[k] !== undefined) {
          const v = c[k]
          if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== 'number' || x < -100 || x > 100))
            throw invalid(`${k}는 -100~100 숫자 3개 [빨강↔청록, 초록↔자홍, 파랑↔노랑] 이어야 합니다.`, { field: k })
          more.cb[k] = [v[0], v[1], v[2]]
        }
    }
    if (kind === 'vibrance') {
      more.vibrance = num(o, 'vibrance', -100, 100, 0)!
      more.saturation = num(o, 'saturation', -100, 100, 0)!
    }
    if (kind === 'posterize') more.levels = int(o, 'levels', 2, 255, 4)!
    if (kind === 'threshold') more.threshold = int(o, 'threshold', 1, 255, 128)!
    return { layerId: id(o, 'layerId'), more }
  },
  run(doc, i) {
    const l = pixelLayer(doc, i.layerId, '보정')
    const label = { blackWhite: '흑백', colorBalance: '색상 균형', vibrance: '활기', posterize: '포스터화', threshold: '한계값' }[i.more.kind]
    return { doc: editPixels(doc, l.id, 'layer', undefined, (px) => applyMoreAdjust(px, i.more)), label, summary: `"${l.name}" ${label}`, warnings: [] }
  }
}
