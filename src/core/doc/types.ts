/**
 * 문서 모델 (순수 TS) — Compositor `Document/EditorSession.swift` 의 `CanvasDocument`·`ImageLayer` 를 옮긴 것.
 *
 * 원칙
 *  - **불변**: 문서·레이어·비트맵은 바꾸지 않고 새로 만든다. 실행취소는 문서 스냅샷을 쌓고, 바뀌지 않은
 *    레이어·비트맵은 참조를 공유한다(Compositor `RasterSnapshot` 과 같은 발상 — 메모리가 편집량에 비례).
 *  - **픽셀의 진실은 CPU**(Bitmap, 스트레이트 알파 RGBA). WebGL2 텍스처는 그 거울일 뿐이다(ADR-0002).
 *  - 레이어 순서는 **아래 → 위** (Compositor 와 같음).
 */
import type { LayerEffects } from '../effects'
import type { Adjustments } from '../adjust'
import type { Filters } from '../filters'

/** 스트레이트 알파 RGBA 비트맵 — 한 번 문서에 들어가면 수정하지 않는다 */
export interface Bitmap {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
}

/** Compositor `LayerBlendMode` 와 같은 16종 (Photoshop 순서) */
export type BlendMode =
  | 'normal'
  | 'darken'
  | 'multiply'
  | 'colorBurn'
  | 'lighten'
  | 'screen'
  | 'colorDodge'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export const BLEND_MODES: { key: BlendMode; label: string; group: number }[] = [
  { key: 'normal', label: '표준', group: 0 },
  { key: 'darken', label: '어둡게', group: 1 },
  { key: 'multiply', label: '곱하기', group: 1 },
  { key: 'colorBurn', label: '색상 번', group: 1 },
  { key: 'lighten', label: '밝게', group: 2 },
  { key: 'screen', label: '스크린', group: 2 },
  { key: 'colorDodge', label: '색상 닷지', group: 2 },
  { key: 'overlay', label: '오버레이', group: 3 },
  { key: 'softLight', label: '소프트 라이트', group: 3 },
  { key: 'hardLight', label: '하드 라이트', group: 3 },
  { key: 'difference', label: '차이', group: 4 },
  { key: 'exclusion', label: '제외', group: 4 },
  { key: 'hue', label: '색조', group: 5 },
  { key: 'saturation', label: '채도', group: 5 },
  { key: 'color', label: '색상', group: 5 },
  { key: 'luminosity', label: '광도', group: 5 }
]

/**
 * 레이어 변형 — 비트맵을 문서의 어디에 어떤 크기·각도로 놓는가 (비파괴, Compositor `LayerTransform`).
 * 크기를 줄였다 키워도 비트맵은 원래 해상도 그대로다.
 */
export interface LayerTransform {
  /** 회전 전 사각형의 왼쪽 위 (문서 px) */
  x: number
  y: number
  /** 문서에 그려지는 크기 (px) */
  width: number
  height: number
  /** 시계방향 회전 (도) — 사각형 중심 기준 */
  rotation: number
  flipH: boolean
  flipV: boolean
}

/** 레이어 마스크 — 흰색(255) = 보임. 비트맵의 R 채널만 쓴다 (Compositor `LayerMask`) */
export interface LayerMask {
  bitmap: Bitmap
  enabled: boolean
  /** 켜져 있으면 레이어와 함께 변형된다 (Compositor maskLinked) */
  linked: boolean
}

export type AdjustmentKind = 'levels' | 'curves' | 'hueSaturation' | 'exposure' | 'gradientMap' | 'grain' | 'invert'

export const ADJUSTMENT_KINDS: { key: AdjustmentKind; label: string }[] = [
  { key: 'levels', label: '레벨' },
  { key: 'curves', label: '커브' },
  { key: 'hueSaturation', label: '색조/채도' },
  { key: 'exposure', label: '노출' },
  { key: 'gradientMap', label: '그라데이션 맵' },
  { key: 'grain', label: '그레인' },
  { key: 'invert', label: '반전' }
]

/** 문자 레이어 데이터 (Compositor `TypeTool`) — 픽셀은 이 값으로 다시 그린다 */
export interface TextData {
  text: string
  font: string
  size: number
  color: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
  /** 줄 간격 배수 */
  lineHeight: number
  /** 자간 (em 의 1/1000) */
  tracking: number
  /** 문단 상자 크기 (문서 px) — 줄바꿈 폭 */
  boxWidth: number
  boxHeight: number
}

export type LayerKind = 'pixel' | 'group' | 'adjustment' | 'text'

export interface Layer {
  readonly id: string
  name: string
  kind: LayerKind
  visible: boolean
  /** 0~1 */
  opacity: number
  blend: BlendMode
  /** 픽셀 레이어·문자 레이어의 픽셀 (그룹·조정 레이어는 없음) */
  bitmap: Bitmap | null
  transform: LayerTransform
  /** 부모 폴더 id (없으면 최상위) */
  parentId: string | null
  mask: LayerMask | null
  /** 바로 아래 레이어에 클리핑 (Compositor maskSourceID) */
  clip: boolean
  effects: LayerEffects | null
  adjustment: { kind: AdjustmentKind; settings: Adjustments; filters?: Filters } | null
  text: TextData | null
  /** 폴더 접힘 (화면 전용이지만 저장한다) */
  collapsed?: boolean
}

/** 선택 영역 — 문서 크기의 덮임 정도(0~255). null 이면 선택 없음 (Compositor `DocumentSelection`) */
export interface Selection {
  readonly width: number
  readonly height: number
  readonly mask: Uint8Array
  /** 0 이 아닌 픽셀의 경계 (빈 선택이면 null) */
  readonly bounds: { x: number; y: number; w: number; h: number } | null
}

export interface Doc {
  readonly id: string
  width: number
  height: number
  /** 인쇄 해상도 (DPI) */
  resolution: number
  /** 아래 → 위 */
  layers: Layer[]
  activeId: string | null
  /** 실행취소 대상이지만 저장하지 않는다 (Compositor 와 같음) */
  selection: Selection | null
}

let seq = 0
/** 충분히 고유한 id (UUID 형식 — .comp 호환) */
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID().toUpperCase()
  seq++
  const h = (n: number, len: number): string => Math.floor(n).toString(16).padStart(len, '0').slice(-len)
  return `${h(Date.now(), 8)}-${h(seq, 4)}-4${h(Math.random() * 0xfff, 3)}-${h(0x8000 | (Math.random() * 0x3fff), 4)}-${h(Math.random() * 2 ** 48, 12)}`.toUpperCase()
}
