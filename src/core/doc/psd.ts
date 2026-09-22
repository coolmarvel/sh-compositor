/**
 * PSD 열기·저장 (순수 TS — ag-psd, MIT). Photoshop 과 레이어째로 주고받는다.
 *
 * 옮기는 것: 레이어(픽셀·문자·폴더·조정), 위치, 불투명도, 숨김, 혼합 모드, 클리핑, 레이어·폴더 마스크,
 * 효과(외곽선·그림자·안쪽 그림자·색 덮기), 조정 레이어(레벨·커브·색조/채도·노출·반전·그라데이션 맵), 해상도.
 * 못 옮기는 것은 warnings 로 돌려주고(열기·저장 후 사용자에게 안내), 가능한 가까운 것으로 바꾼다:
 *  - 우리에게 없는 혼합 모드(선형 번·비비드 라이트 …) → 가까운 모드
 *  - 문자 레이어 저장 → 픽셀로 (Photoshop 문자 엔진 데이터를 온전히 쓰지 못함 — ag-psd 한계)
 *  - 16비트·CMYK 등 → ag-psd 가 RGB 8비트로 바꿔 읽는다. 32비트는 거절
 *  - 그레인·색상화 조정 → PSD 에 대응 없음, 빠짐
 */
import {
  readPsd,
  writePsdUint8Array,
  initializeCanvas,
  type Psd,
  type Layer as PsdLayer,
  type BlendMode as PsdBlend,
  type LayerEffectsInfo,
  type Color as PsdColor,
  type PixelData,
  type AdjustmentLayer
} from 'ag-psd'
import type { Doc, Layer, Bitmap, BlendMode, TextData } from './types'
import { newId } from './types'
import { identityTransform, isIdentityPlacement } from './transform'
import { rasterizeBitmap, flattenDoc } from './render'
import { DEFAULT_ADJUST, DEFAULT_TONE, HUE_BANDS, type Adjustments, type CurvePoint, type ChannelTone, type ColorRange } from '../adjust'
import { DEFAULT_EFFECTS, hasEffects, type LayerEffects } from '../effects'
import { MAX_SIDE, MAX_PIXELS } from '../limits'

// ag-psd 는 픽셀 버퍼를 만들 때 캔버스 함수를 부른다. 브라우저 밖(테스트)에서는 평범한 배열로 대신한다 (캔버스 자체는 쓰지 않는다: useImageData)
if (typeof document === 'undefined')
  initializeCanvas(
    () => {
      throw new Error('캔버스 없음')
    },
    (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), colorSpace: 'srgb' }) as unknown as ImageData
  )

const TO_PSD: Record<BlendMode, PsdBlend> = {
  normal: 'normal',
  darken: 'darken',
  multiply: 'multiply',
  colorBurn: 'color burn',
  lighten: 'lighten',
  screen: 'screen',
  colorDodge: 'color dodge',
  overlay: 'overlay',
  softLight: 'soft light',
  hardLight: 'hard light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity'
}
const FROM_PSD: Partial<Record<PsdBlend, BlendMode>> = Object.fromEntries(Object.entries(TO_PSD).map(([k, v]) => [v, k as BlendMode]))
/** 우리에게 없는 모드 → 가장 가까운 모드 */
const NEAREST: Partial<Record<PsdBlend, BlendMode>> = {
  'pass through': 'normal',
  dissolve: 'normal',
  'linear burn': 'colorBurn',
  'darker color': 'darken',
  'linear dodge': 'screen',
  'lighter color': 'lighten',
  'vivid light': 'hardLight',
  'linear light': 'hardLight',
  'pin light': 'hardLight',
  'hard mix': 'hardLight',
  subtract: 'difference',
  subtraction: 'difference',
  divide: 'screen'
}

export interface PsdResult {
  doc: Doc
  warnings: string[]
}

// ── 공용 ──────────────────────────────────────────────────────────────────

const hex2 = (v: number): string =>
  Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, '0')
function colorToHex(c: PsdColor | undefined, fallback = '#000000'): string {
  if (!c) return fallback
  if ('r' in c) {
    // FRGB(0~1) 과 RGB(0~255) 구별
    const f = (c as { r: number }).r <= 1 && (c as { g: number }).g <= 1 && (c as { b: number }).b <= 1 && !Number.isInteger((c as { r: number }).r)
    const k = f ? 255 : 1
    return `#${hex2(c.r * k)}${hex2(c.g * k)}${hex2(c.b * k)}`
  }
  if ('k' in c && 'c' in c) {
    const cc = c as { c: number; m: number; y: number; k: number }
    const r = 255 * (1 - cc.c / 255) * (1 - cc.k / 255)
    return `#${hex2(r)}${hex2(255 * (1 - cc.m / 255) * (1 - cc.k / 255))}${hex2(255 * (1 - cc.y / 255) * (1 - cc.k / 255))}`
  }
  if ('k' in c) {
    const g = 255 - (c as { k: number }).k
    return `#${hex2(g)}${hex2(g)}${hex2(g)}`
  }
  return fallback
}
function hexToColor(h: string): { r: number; g: number; b: number } {
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }
}
const px = (v: { value: number } | undefined, d: number): number => (v && Number.isFinite(v.value) ? v.value : d)
const units = (value: number): { units: 'Pixels'; value: number } => ({ units: 'Pixels', value })

/** ag-psd 픽셀 → 우리 비트맵 (16·32비트는 8비트로) */
function toBitmap(p: PixelData | undefined): Bitmap | null {
  if (!p || p.width <= 0 || p.height <= 0) return null
  const n = p.width * p.height * 4
  const src = p.data
  let data: Uint8ClampedArray
  if (src instanceof Uint8ClampedArray) data = src.length === n ? src : src.slice(0, n)
  else if (src instanceof Uint8Array) data = new Uint8ClampedArray(src.buffer, src.byteOffset, n).slice()
  else if (src instanceof Uint16Array) {
    data = new Uint8ClampedArray(n)
    for (let i = 0; i < n; i++) data[i] = src[i] >> 8
  } else {
    data = new Uint8ClampedArray(n)
    for (let i = 0; i < n; i++) data[i] = (src as Float32Array)[i] * 255
  }
  return { width: p.width, height: p.height, data }
}

// ── 열기 ──────────────────────────────────────────────────────────────────

/** 레이어 수·크기를 먼저 확인한다 (악성·거대 파일이 메모리를 다 먹지 않게 — ag-psd 권고) */
function checkStructure(bytes: Uint8Array): void {
  const s = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, useRawThumbnail: true })
  if (s.width > MAX_SIDE || s.height > MAX_SIDE || s.width * s.height > MAX_PIXELS) throw new Error(`PSD 가 너무 큽니다 (${s.width}×${s.height}). 한 변 ${MAX_SIDE}px, 1억 픽셀까지 엽니다.`)
  if ((s.bitsPerChannel ?? 8) > 16) throw new Error('32비트 PSD 는 열 수 없습니다. Photoshop 에서 8비트로 바꿔 저장하세요.')
  let count = 0
  let pixels = 0
  const walk = (ls: PsdLayer[] | undefined): void => {
    for (const l of ls ?? []) {
      if (++count > 2000) throw new Error('레이어가 너무 많습니다 (2,000장까지).')
      const w = (l.right ?? 0) - (l.left ?? 0)
      const h = (l.bottom ?? 0) - (l.top ?? 0)
      if (w > MAX_SIDE || h > MAX_SIDE) throw new Error(`레이어 "${l.name ?? ''}" 가 너무 큽니다.`)
      pixels += Math.max(0, w) * Math.max(0, h)
      walk(l.children)
    }
  }
  walk(s.children)
  if (pixels > MAX_PIXELS * 8) throw new Error('PSD 의 레이어 픽셀이 너무 많아 열 수 없습니다.')
}

function effectsFrom(e: LayerEffectsInfo | undefined, warn: (m: string) => void): LayerEffects | null {
  if (!e || e.disabled) return null
  const out: LayerEffects = JSON.parse(JSON.stringify(DEFAULT_EFFECTS))
  const s = e.stroke?.[0]
  if (s) {
    out.stroke = { enabled: s.enabled !== false, size: px(s.size, 3), color: colorToHex(s.color), opacity: s.opacity ?? 1, inside: s.position === 'inside' }
    if (s.fillType && s.fillType !== 'color') warn('외곽선의 그라데이션·패턴 채우기는 단색으로 바꿨습니다.')
  }
  const d = e.dropShadow?.[0]
  if (d) out.shadow = { enabled: d.enabled !== false, angle: d.angle ?? 90, distance: px(d.distance, 5), blur: px(d.size, 5), color: colorToHex(d.color), opacity: d.opacity ?? 0.75 }
  const i = e.innerShadow?.[0]
  if (i) out.innerShadow = { enabled: i.enabled !== false, angle: i.angle ?? 90, distance: px(i.distance, 5), blur: px(i.size, 5), color: colorToHex(i.color), opacity: i.opacity ?? 0.75 }
  const f = e.solidFill?.[0]
  if (f) out.overlay = { enabled: f.enabled !== false, color: colorToHex(f.color), opacity: f.opacity ?? 1 }
  const og = e.outerGlow
  if (og) out.outerGlow = { enabled: og.enabled !== false, size: px(og.size, 10), spread: px(og.choke, 0), color: colorToHex(og.color, '#ffffbe'), opacity: og.opacity ?? 0.75 }
  if (e.innerGlow || e.bevel || e.satin || e.gradientOverlay?.length || e.patternOverlay) warn('안쪽 광선·경사·새틴·그라데이션/패턴 오버레이 효과는 옮기지 못했습니다.')
  return hasEffects(out) ? out : null
}

const toneFrom = (c: { shadowInput: number; highlightInput: number; midtoneInput: number; shadowOutput: number; highlightOutput: number } | undefined): Partial<ChannelTone> =>
  c ? { inBlack: c.shadowInput, inWhite: c.highlightInput, midtone: c.midtoneInput || 1, outBlack: c.shadowOutput, outWhite: c.highlightOutput } : {}
const curveFrom = (c: { input: number; output: number }[] | undefined): CurvePoint[] | null => (c && c.length >= 2 ? c.map((p) => ({ x: p.input, y: p.output })).sort((a, b) => a.x - b.x) : null)

const RANGES: [ColorRange, 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas'][] = [
  ['reds', 'reds'],
  ['yellows', 'yellows'],
  ['greens', 'greens'],
  ['cyans', 'cyans'],
  ['blues', 'blues'],
  ['magentas', 'magentas']
]

/** PSD 조정 → 우리 조정 레이어 (종류·설정). 대응이 없으면 null */
function adjustmentFrom(a: AdjustmentLayer): { kind: 'levels' | 'curves' | 'hueSaturation' | 'exposure' | 'invert' | 'gradientMap'; settings: Adjustments } | null {
  const base: Adjustments = JSON.parse(JSON.stringify(DEFAULT_ADJUST))
  switch (a.type) {
    case 'levels': {
      const rgb = toneFrom(a.rgb)
      const ch = { r: { ...DEFAULT_TONE, ...toneFrom(a.red) }, g: { ...DEFAULT_TONE, ...toneFrom(a.green) }, b: { ...DEFAULT_TONE, ...toneFrom(a.blue) } }
      return { kind: 'levels', settings: { ...base, ...rgb, channels: ch } as Adjustments }
    }
    case 'curves': {
      const ch = {
        r: { ...DEFAULT_TONE, curve: curveFrom(a.red) ?? DEFAULT_TONE.curve },
        g: { ...DEFAULT_TONE, curve: curveFrom(a.green) ?? DEFAULT_TONE.curve },
        b: { ...DEFAULT_TONE, curve: curveFrom(a.blue) ?? DEFAULT_TONE.curve }
      }
      return { kind: 'curves', settings: { ...base, curve: curveFrom(a.rgb) ?? base.curve, channels: ch } }
    }
    case 'hue/saturation': {
      const m = a.master
      const hueRanges: Adjustments['hueRanges'] = {}
      for (const [ours, theirs] of RANGES) {
        const r = a[theirs]
        if (r && (r.hue || r.saturation || r.lightness)) hueRanges[ours] = { hue: r.hue, saturation: r.saturation, lightness: r.lightness }
      }
      return { kind: 'hueSaturation', settings: { ...base, hue: m?.hue ?? 0, saturation: m?.saturation ?? 0, lightness: m?.lightness ?? 0, hueRanges } }
    }
    case 'exposure':
      return { kind: 'exposure', settings: { ...base, exposure: a.exposure ?? 0, offset: a.offset ?? 0, gamma: a.gamma ?? 1 } }
    case 'invert':
      return { kind: 'invert', settings: { ...base, invert: true } }
    case 'gradient map': {
      const stops = a.colorStops ?? []
      if (stops.length < 2) return null
      const first = stops[0]
      const last = stops[stops.length - 1]
      return { kind: 'gradientMap', settings: { ...base, gradientMap: { shadows: colorToHex(first.color), highlights: colorToHex(last.color, '#ffffff'), reversed: !!a.reverse } } }
    }
    default:
      return null
  }
}

const ADJ_NAMES: Record<string, string> = { levels: '레벨', curves: '커브', 'hue/saturation': '색조/채도', exposure: '노출', invert: '반전', 'gradient map': '그라데이션 맵' }

function textFrom(l: PsdLayer, bmp: Bitmap | null): TextData | null {
  const t = l.text
  if (!t) return null
  const st = t.style ?? {}
  const scale = t.transform ? Math.hypot(t.transform[0], t.transform[1]) || 1 : 1
  const just = t.paragraphStyle?.justification
  const fontName = st.font?.name ?? 'Malgun Gothic'
  return {
    text: t.text.replace(/\r/g, '\n'),
    font: /malgun/i.test(fontName) ? 'Malgun Gothic' : fontName.replace(/MT$|PSMT$/, '').replace(/-.*$/, ''),
    size: Math.max(1, Math.round((st.fontSize ?? 24) * scale)),
    color: colorToHex(st.fillColor),
    bold: !!st.fauxBold || /bold/i.test(fontName),
    italic: !!st.fauxItalic || /italic|oblique/i.test(fontName),
    align: just === 'center' ? 'center' : just === 'right' ? 'right' : 'left',
    lineHeight: st.autoLeading !== false || !st.leading ? 1.2 : Math.max(0.5, st.leading / (st.fontSize || 24)),
    tracking: st.tracking ?? 0,
    boxWidth: bmp?.width ?? 100,
    boxHeight: bmp?.height ?? 40,
    vertical: t.orientation === 'vertical' || undefined
  }
}

/** PSD 바이트 → 문서 */
export function psdToDoc(bytes: Uint8Array, name = 'PSD'): PsdResult {
  checkStructure(bytes)
  let psd: Psd
  try {
    psd = readPsd(bytes, { useImageData: true, skipThumbnail: true })
  } catch (e) {
    throw new Error(`PSD 를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
  }
  const warnSet = new Set<string>()
  const warn = (m: string): void => void warnSet.add(m)
  const W = psd.width
  const H = psd.height
  const layers: Layer[] = []

  const maskFor = (l: PsdLayer, bx: number, by: number, bw: number, bh: number): Layer['mask'] => {
    const m = l.mask
    if (!m || !m.imageData) return null
    const out = new Uint8ClampedArray(bw * bh * 4)
    const def = m.defaultColor ?? 255
    for (let i = 0; i < bw * bh; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = def
      out[i * 4 + 3] = 255
    }
    const src = toBitmap(m.imageData)
    if (src) {
      const ox = (m.left ?? 0) - bx
      const oy = (m.top ?? 0) - by
      for (let y = 0; y < src.height; y++) {
        const ty = y + oy
        if (ty < 0 || ty >= bh) continue
        for (let x = 0; x < src.width; x++) {
          const tx = x + ox
          if (tx < 0 || tx >= bw) continue
          const v = src.data[(y * src.width + x) * 4] // 회색 마스크: R 채널
          const o = (ty * bw + tx) * 4
          out[o] = out[o + 1] = out[o + 2] = v
        }
      }
    }
    return { bitmap: { width: bw, height: bh, data: out }, enabled: !m.disabled, linked: true }
  }

  const walk = (list: PsdLayer[] | undefined, parentId: string | null): void => {
    for (const l of list ?? []) {
      const id = newId()
      const blendIn = l.blendMode ?? 'normal'
      let blend: BlendMode = FROM_PSD[blendIn] ?? NEAREST[blendIn] ?? 'normal'
      if (!FROM_PSD[blendIn] && blendIn !== 'pass through') warn(`혼합 모드 "${blendIn}" 는 가장 가까운 "${blend}" 로 바꿨습니다.`)
      const common = {
        id,
        name: l.name || '레이어',
        visible: !l.hidden,
        opacity: l.opacity ?? 1,
        parentId,
        clip: !!l.clipping,
        effects: effectsFrom(l.effects, warn),
        adjustment: null,
        text: null,
        lock:
          l.protected && (l.protected.transparency || l.protected.composite || l.protected.position)
            ? { alpha: !!l.protected.transparency, pixels: !!l.protected.composite, position: !!l.protected.position }
            : undefined
      }
      if (l.children) {
        if (blendIn === 'pass through') blend = 'normal'
        layers.push({ ...common, kind: 'group', blend, bitmap: null, transform: identityTransform(W, H), mask: maskFor(l, 0, 0, W, H), collapsed: l.opened === false, effects: null })
        walk(l.children, id)
        continue
      }
      if (l.adjustment) {
        const a = adjustmentFrom(l.adjustment)
        if (!a) {
          warn(`조정 레이어 "${l.name ?? l.adjustment.type}" (${l.adjustment.type}) 는 지원하지 않아 뺐습니다.`)
          continue
        }
        layers.push({
          ...common,
          name: l.name || ADJ_NAMES[l.adjustment.type] || '조정',
          kind: 'adjustment',
          blend,
          bitmap: null,
          transform: identityTransform(W, H),
          mask: maskFor(l, 0, 0, W, H),
          adjustment: { kind: a.kind, settings: a.settings },
          effects: null
        })
        continue
      }
      if (l.placedLayer) warn('고급 개체(스마트 오브젝트)는 보이는 픽셀로 열었습니다.')
      if (l.vectorFill || l.vectorMask) warn('모양(벡터) 레이어는 보이는 픽셀로 열었습니다.')
      const bmp = toBitmap(l.imageData)
      if (!bmp && !l.text && !l.mask) continue // 픽셀이 하나도 없는 레이어
      const bx = l.left ?? 0
      const by = l.top ?? 0
      const bitmap = bmp ?? { width: 1, height: 1, data: new Uint8ClampedArray(4) }
      const text = textFrom(l, bmp)
      layers.push({
        ...common,
        kind: text ? 'text' : 'pixel',
        blend,
        bitmap,
        transform: identityTransform(bitmap.width, bitmap.height, bx, by),
        mask: maskFor(l, bx, by, bitmap.width, bitmap.height),
        text
      })
    }
  }
  walk(psd.children, null)

  // 레이어가 없는 PSD (병합 저장 — 빈 자리표시 레이어 하나만 있기도 하다) → 합성 이미지 한 장
  const empty = layers.every((l) => l.kind === 'pixel' && !!l.bitmap && l.bitmap.width <= 1 && l.bitmap.height <= 1)
  if (empty && psd.imageData) layers.length = 0
  if (layers.length === 0) {
    const comp = toBitmap(psd.imageData)
    if (!comp) throw new Error('PSD 에 레이어도 합성 이미지도 없습니다.')
    layers.push({
      id: newId(),
      name: name,
      kind: 'pixel',
      visible: true,
      opacity: 1,
      blend: 'normal',
      bitmap: comp,
      transform: identityTransform(comp.width, comp.height),
      parentId: null,
      mask: null,
      clip: false,
      effects: null,
      adjustment: null,
      text: null
    })
  }
  const res = psd.imageResources?.resolutionInfo
  const dpi = res ? (res.horizontalResolutionUnit === 'PPCM' ? res.horizontalResolution * 2.54 : res.horizontalResolution) : 72
  if ((psd.bitsPerChannel ?? 8) > 8) warn('16비트 PSD 를 8비트로 열었습니다.')
  if (psd.colorMode !== undefined && psd.colorMode !== 3) warn('RGB 가 아닌 색상 모드(CMYK·흑백 등)를 RGB 로 바꿔 열었습니다.')
  const top = [...layers].reverse().find((l) => l.kind !== 'group') ?? layers[layers.length - 1]
  return { doc: { id: newId(), width: W, height: H, resolution: Math.round(dpi * 100) / 100, layers, activeId: top?.id ?? null, selection: null }, warnings: [...warnSet] }
}

// ── 저장 ──────────────────────────────────────────────────────────────────

const toneTo = (t: {
  inBlack: number
  inWhite: number
  midtone: number
  outBlack: number
  outWhite: number
}): { shadowInput: number; highlightInput: number; midtoneInput: number; shadowOutput: number; highlightOutput: number } => ({
  shadowInput: t.inBlack,
  highlightInput: t.inWhite,
  midtoneInput: t.midtone,
  shadowOutput: t.outBlack,
  highlightOutput: t.outWhite
})
const curveTo = (c: CurvePoint[]): { input: number; output: number }[] => c.map((p) => ({ input: Math.round(p.x), output: Math.round(p.y) }))

function adjustmentTo(l: Layer, warn: (m: string) => void): AdjustmentLayer | null {
  const a = l.adjustment
  if (!a) return null
  const s = a.settings
  if (a.filters) warn(`조정 레이어 "${l.name}" 의 필터는 PSD 에 넣을 수 없어 뺐습니다.`)
  switch (a.kind) {
    case 'levels':
      return { type: 'levels', rgb: toneTo(s), red: toneTo(s.channels.r), green: toneTo(s.channels.g), blue: toneTo(s.channels.b) }
    case 'curves':
      return { type: 'curves', rgb: curveTo(s.curve), red: curveTo(s.channels.r.curve), green: curveTo(s.channels.g.curve), blue: curveTo(s.channels.b.curve) }
    case 'hueSaturation': {
      if (s.colorize) warn(`"${l.name}" 의 색상화는 PSD 로 옮기지 못했습니다.`)
      const band = (
        hue: number,
        saturation: number,
        lightness: number,
        abcd: [number, number, number, number]
      ): { a: number; b: number; c: number; d: number; hue: number; saturation: number; lightness: number } => ({
        a: abcd[0],
        b: abcd[1],
        c: abcd[2],
        d: abcd[3],
        hue: Math.round(hue),
        saturation: Math.round(saturation),
        lightness: Math.round(lightness)
      })
      const out: AdjustmentLayer = { type: 'hue/saturation', master: band(s.hue, s.saturation, s.lightness, [0, 0, 0, 0]) }
      for (const [ours, theirs] of RANGES) {
        const r = s.hueRanges?.[ours]
        ;(out as unknown as Record<string, unknown>)[theirs] = band(r?.hue ?? 0, r?.saturation ?? 0, r?.lightness ?? 0, HUE_BANDS[ours])
      }
      return out
    }
    case 'exposure':
      return { type: 'exposure', exposure: s.exposure, offset: s.offset, gamma: s.gamma }
    case 'invert':
      return { type: 'invert' }
    case 'gradientMap': {
      const g = s.gradientMap ?? { shadows: '#000000', highlights: '#ffffff', reversed: false }
      return {
        type: 'gradient map',
        name: 'SH Compositor',
        gradientType: 'solid',
        reverse: g.reversed,
        smoothness: 1,
        colorStops: [
          { color: hexToColor(g.shadows), location: 0, midpoint: 0.5 },
          { color: hexToColor(g.highlights), location: 1, midpoint: 0.5 }
        ],
        opacityStops: [
          { opacity: 1, location: 0, midpoint: 0.5 },
          { opacity: 1, location: 1, midpoint: 0.5 }
        ]
      }
    }
    default:
      warn(`조정 레이어 "${l.name}" (${a.kind}) 는 PSD 에 대응이 없어 뺐습니다.`)
      return null
  }
}

function effectsTo(e: LayerEffects | null): LayerEffectsInfo | undefined {
  if (!hasEffects(e)) return undefined
  const out: LayerEffectsInfo = {}
  if (e.stroke.enabled)
    out.stroke = [
      {
        enabled: true,
        present: true,
        showInDialog: true,
        size: units(e.stroke.size),
        position: e.stroke.inside ? 'inside' : 'outside',
        fillType: 'color',
        blendMode: 'normal',
        opacity: e.stroke.opacity,
        color: hexToColor(e.stroke.color)
      }
    ]
  if (e.shadow.enabled)
    out.dropShadow = [
      {
        enabled: true,
        present: true,
        showInDialog: true,
        angle: e.shadow.angle,
        distance: units(e.shadow.distance),
        size: units(e.shadow.blur),
        color: hexToColor(e.shadow.color),
        opacity: e.shadow.opacity,
        blendMode: 'multiply',
        useGlobalLight: false
      }
    ]
  if (e.innerShadow.enabled)
    out.innerShadow = [
      {
        enabled: true,
        present: true,
        showInDialog: true,
        angle: e.innerShadow.angle,
        distance: units(e.innerShadow.distance),
        size: units(e.innerShadow.blur),
        color: hexToColor(e.innerShadow.color),
        opacity: e.innerShadow.opacity,
        blendMode: 'multiply',
        useGlobalLight: false
      }
    ]
  if (e.outerGlow?.enabled)
    out.outerGlow = {
      enabled: true,
      present: true,
      showInDialog: true,
      size: units(e.outerGlow.size),
      choke: { units: 'None', value: e.outerGlow.spread },
      color: hexToColor(e.outerGlow.color),
      opacity: e.outerGlow.opacity,
      blendMode: 'screen'
    }
  if (e.overlay.enabled) out.solidFill = [{ enabled: true, present: true, showInDialog: true, color: hexToColor(e.overlay.color), opacity: e.overlay.opacity, blendMode: 'normal' }]
  return out
}

const pixelData = (width: number, height: number, data: Uint8ClampedArray): PixelData => ({ width, height, data })

/** 문서 → PSD 바이트 (+ 옮기지 못한 것 안내) */
export function docToPsd(doc: Doc): { bytes: Uint8Array; warnings: string[] } {
  const warnSet = new Set<string>()
  const warn = (m: string): void => void warnSet.add(m)
  const W = doc.width
  const H = doc.height

  const build = (parentId: string | null): PsdLayer[] => {
    const out: PsdLayer[] = []
    for (const l of doc.layers.filter((k) => k.parentId === parentId)) {
      const base: PsdLayer = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: TO_PSD[l.blend] ?? 'normal', clipping: l.clip }
      if (l.lock && (l.lock.alpha || l.lock.pixels || l.lock.position)) base.protected = { transparency: !!l.lock.alpha, composite: !!l.lock.pixels, position: !!l.lock.position }
      const docMask = (): PsdLayer['mask'] =>
        l.mask ? { left: 0, top: 0, right: W, bottom: H, defaultColor: 255, disabled: !l.mask.enabled, imageData: pixelData(l.mask.bitmap.width, l.mask.bitmap.height, l.mask.bitmap.data) } : undefined
      if (l.kind === 'group') {
        out.push({ ...base, opened: !l.collapsed, children: build(l.id), mask: docMask() })
        continue
      }
      if (l.kind === 'adjustment') {
        const a = adjustmentTo(l, warn)
        if (a) out.push({ ...base, adjustment: a, mask: docMask() })
        continue
      }
      if (!l.bitmap) continue
      if (l.kind === 'text') warn('문자 레이어는 픽셀로 저장했습니다 (Photoshop 에서 글자를 다시 고칠 수는 없습니다).')
      const t = l.transform
      let left = Math.round(t.x)
      let top = Math.round(t.y)
      let img: PixelData
      let maskImg: PixelData | undefined
      if (isIdentityPlacement(t, l.bitmap.width, l.bitmap.height)) {
        img = pixelData(l.bitmap.width, l.bitmap.height, l.bitmap.data)
        if (l.mask) maskImg = pixelData(l.mask.bitmap.width, l.mask.bitmap.height, l.mask.bitmap.data)
      } else {
        // 회전·크기 변형은 PSD 레이어에 담을 수 없다 → 문서에 맞춰 굽는다
        const r = rasterizeBitmap(l.bitmap, l, W, H)
        if (!r) continue
        left = r.x
        top = r.y
        img = pixelData(r.width, r.height, r.data)
        if (l.mask) {
          const m = rasterizeBitmap(l.mask.bitmap, l, W, H)
          if (m && m.x === r.x && m.y === r.y && m.width === r.width && m.height === r.height) maskImg = pixelData(m.width, m.height, m.data)
        }
      }
      out.push({
        ...base,
        left,
        top,
        right: left + img.width,
        bottom: top + img.height,
        imageData: img,
        effects: effectsTo(l.effects),
        mask: l.mask && maskImg ? { left, top, right: left + maskImg.width, bottom: top + maskImg.height, defaultColor: 255, disabled: !l.mask.enabled, imageData: maskImg } : undefined
      })
    }
    return out
  }

  const flat = flattenDoc({ ...doc, selection: null })
  const psd: Psd = {
    width: W,
    height: H,
    children: build(null),
    imageData: pixelData(W, H, flat.data),
    imageResources: {
      resolutionInfo: {
        horizontalResolution: doc.resolution,
        horizontalResolutionUnit: 'PPI',
        widthUnit: 'Inches',
        verticalResolution: doc.resolution,
        verticalResolutionUnit: 'PPI',
        heightUnit: 'Inches'
      }
    }
  }
  const bytes = writePsdUint8Array(psd, { noBackground: true, generateThumbnail: false })
  return { bytes, warnings: [...warnSet] }
}

/** PSD 파일인가 (8BPS) */
export function isPsd(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53
}
