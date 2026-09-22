/**
 * 프로젝트 저장/열기 (순수 TS) — Compositor `.comp` 형식과 같은 내용.
 *
 * `.comp` = `manifest.json` + `images/<UUID>.png`(+ 마스크 `images/<UUID>-mask.png`) 폴더(macOS 패키지).
 * Windows 에는 패키지 폴더가 없으므로 같은 내용을 **zip 한 `.shcomp`** 로 저장하고, `.comp` 폴더(파일 맵)도 읽는다.
 * manifest 는 Compositor v7 필드 이름을 그대로 쓰고(origin/size = [x,y]/[w,h] 배열), 우리만의 값(16종 합성 모드 중
 * 하드 라이트·제외, 조정 레이어 설정, 효과, 문자)은 같은 레코드의 추가 필드로 넣는다 — Compositor 는 모르는 키를 무시한다.
 */
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { encodePng, decodePng } from '../png'
import { MAX_SIDE, MAX_PIXELS } from '../limits'
import type { Doc, Layer, BlendMode, LayerTransform } from './types'

const FORMAT = 'com.compositor.project'
export const PROJECT_VERSION = 7
/** Compositor 와 같은 한도 */
const LIMITS = { side: MAX_SIDE, pixels: MAX_PIXELS, layers: 10000, manifest: 4 * 1024 * 1024 }

const BLEND_NAMES: Record<BlendMode, string> = {
  normal: 'Normal',
  darken: 'Darken',
  multiply: 'Multiply',
  colorBurn: 'Color Burn',
  lighten: 'Lighten',
  screen: 'Screen',
  colorDodge: 'Color Dodge',
  overlay: 'Overlay',
  softLight: 'Soft Light',
  hardLight: 'Hard Light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity'
}
const BLEND_FROM = Object.fromEntries(Object.entries(BLEND_NAMES).map(([k, v]) => [v, k])) as Record<string, BlendMode>

interface TransformRecord {
  origin: [number, number]
  size: [number, number]
  rotation: number
  flipX: boolean
  flipY: boolean
  sampling: string
}

const toRecord = (t: LayerTransform): TransformRecord => ({ origin: [t.x, t.y], size: [t.width, t.height], rotation: t.rotation, flipX: t.flipH, flipY: t.flipV, sampling: 'High quality' })
const fromRecord = (r: TransformRecord): LayerTransform => ({ x: r.origin[0], y: r.origin[1], width: r.size[0], height: r.size[1], rotation: r.rotation ?? 0, flipH: !!r.flipX, flipV: !!r.flipY })

/** 문서 → 파일 맵 (manifest.json + images/*.png) */
export function serializeDoc(doc: Doc): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const layers = doc.layers.map((l) => {
    const rec: Record<string, unknown> = {
      id: l.id,
      name: l.name,
      isVisible: l.visible,
      transform: toRecord(l.transform),
      imageFile: null,
      parentID: l.parentId,
      isGroup: l.kind === 'group' || undefined,
      opacity: l.opacity,
      blendMode: BLEND_NAMES[l.blend],
      maskSourceID: null,
      // ── sh-compositor 확장 (Compositor 는 무시) ──
      shKind: l.kind,
      shClip: l.clip || undefined,
      shEffects: l.effects ?? undefined,
      shAdjustment: l.adjustment ?? undefined,
      shText: l.text ?? undefined,
      shCollapsed: l.collapsed || undefined,
      shShape: l.shape ?? undefined,
      shLock: l.lock && (l.lock.alpha || l.lock.pixels || l.lock.position) ? l.lock : undefined
    }
    if (l.bitmap) {
      rec.imageFile = `${l.id}.png`
      files[`images/${l.id}.png`] = encodePng(l.bitmap.width, l.bitmap.height, l.bitmap.data)
    }
    if (l.mask) {
      rec.maskFile = `${l.id}-mask.png`
      rec.maskEnabled = l.mask.enabled
      rec.maskLinked = l.mask.linked
      files[`images/${l.id}-mask.png`] = encodePng(l.mask.bitmap.width, l.mask.bitmap.height, l.mask.bitmap.data)
    }
    // 클리핑: Compositor 는 maskSourceID(아래 레이어) 로 표현
    if (l.clip) {
      const sibs = doc.layers.filter((s) => s.parentId === l.parentId)
      const i = sibs.findIndex((s) => s.id === l.id)
      const base = sibs
        .slice(0, i)
        .reverse()
        .find((s) => !s.clip)
      rec.maskSourceID = base?.id ?? null
    }
    return rec
  })
  const manifest = {
    format: FORMAT,
    version: PROJECT_VERSION,
    colorSpace: 'sRGB',
    resolution: doc.resolution,
    documentID: doc.id,
    width: doc.width,
    height: doc.height,
    activeLayerID: doc.activeId,
    // 우리 확장 (Compositor 는 모르는 키라 무시한다)
    shGuides: doc.guides && (doc.guides.v.length || doc.guides.h.length) ? doc.guides : undefined,
    layers
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  return files
}

/** 파일 맵 → 문서 (검증 실패면 이유를 말하는 오류) */
export function deserializeDoc(files: Record<string, Uint8Array>): Doc {
  const mf = files['manifest.json']
  if (!mf) throw new Error('프로젝트가 아니거나 manifest.json 이 없습니다.')
  if (mf.length > LIMITS.manifest) throw new Error('프로젝트 정보가 너무 큽니다.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = JSON.parse(strFromU8(mf)) as any
  if (m.format !== FORMAT) throw new Error('Compositor 형식 프로젝트가 아닙니다.')
  if (!(m.version >= 1 && m.version <= PROJECT_VERSION)) throw new Error(`지원하지 않는 프로젝트 버전입니다 (${m.version}). 1~${PROJECT_VERSION} 만 읽습니다.`)
  if (!(m.width >= 1 && m.height >= 1 && m.width <= LIMITS.side && m.height <= LIMITS.side)) throw new Error('캔버스 크기가 한도를 넘습니다.')
  if (!Array.isArray(m.layers) || m.layers.length > LIMITS.layers) throw new Error('레이어 정보가 손상되었습니다.')
  let pixels = 0
  const read = (name: string | null | undefined): { width: number; height: number; data: Uint8ClampedArray } | null => {
    if (!name) return null
    if (name.includes('/') || name.includes('..')) throw new Error('잘못된 파일 경로가 들어 있습니다.')
    const bytes = files[`images/${name}`]
    if (!bytes) throw new Error(`프로젝트 안의 이미지가 없습니다: ${name}`)
    const png = decodePng(bytes)
    pixels += png.width * png.height
    if (pixels > LIMITS.pixels) throw new Error('이미지 픽셀 합계가 1억 픽셀을 넘습니다.')
    return { width: png.width, height: png.height, data: png.data }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layers: Layer[] = m.layers.map((r: any) => {
    const bitmap = read(r.imageFile)
    const maskBmp = read(r.maskFile)
    const kind = (r.shKind as Layer['kind']) ?? (r.isGroup ? 'group' : r.adjustment ? 'adjustment' : 'pixel')
    const layer: Layer = {
      id: String(r.id),
      name: String(r.name ?? '레이어'),
      kind,
      visible: r.isVisible !== false,
      opacity: typeof r.opacity === 'number' ? r.opacity : 1,
      blend: BLEND_FROM[r.blendMode] ?? 'normal',
      bitmap,
      transform: fromRecord(r.transform),
      parentId: r.parentID ?? null,
      mask: maskBmp ? { bitmap: maskBmp, enabled: r.maskEnabled !== false, linked: r.maskLinked !== false } : null,
      clip: !!r.shClip || !!r.maskSourceID,
      effects: r.shEffects ?? null,
      adjustment: r.shAdjustment ?? null,
      text: r.shText ?? null,
      collapsed: !!r.shCollapsed,
      shape: r.shShape && typeof r.shShape.kind === 'string' ? r.shShape : undefined,
      lock: r.shLock ? { alpha: !!r.shLock.alpha, pixels: !!r.shLock.pixels, position: !!r.shLock.position } : undefined
    }
    return layer
  })
  const num = (a: unknown): number[] => (Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).slice(0, 500) : [])
  const guides = m.shGuides ? { v: num(m.shGuides.v), h: num(m.shGuides.h) } : undefined
  return {
    id: String(m.documentID),
    width: m.width,
    height: m.height,
    resolution: m.resolution ?? 72,
    layers,
    activeId: m.activeLayerID ?? layers[layers.length - 1]?.id ?? null,
    selection: null,
    guides
  }
}

/** .shcomp (zip) 바이트 */
export function packProject(doc: Doc): Uint8Array {
  const files = serializeDoc(doc)
  // PNG 는 이미 압축돼 있어 저장만 (level 0), manifest 만 압축
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {}
  for (const [k, v] of Object.entries(files)) entries[k] = [v, { level: k.endsWith('.png') ? 0 : 6 }]
  return zipSync(entries)
}

export function unpackProject(zip: Uint8Array): Doc {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zip)
  } catch {
    throw new Error('프로젝트 파일이 손상되었습니다 (zip 을 읽지 못함).')
  }
  // .comp 폴더를 통째로 압축한 경우(최상위 폴더 하나) 도 받아 준다
  if (!files['manifest.json']) {
    const key = Object.keys(files).find((k) => k.endsWith('/manifest.json'))
    if (key) {
      const prefix = key.slice(0, -'manifest.json'.length)
      files = Object.fromEntries(
        Object.entries(files)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v])
      )
    }
  }
  return deserializeDoc(files)
}
