/** 문서·레이어 정보 (외부에 보이는 모양). 픽셀은 싣지 않는다 */
import type { Doc, Layer } from '../core/doc/types'

export interface LayerInfo {
  id: string
  name: string
  kind: Layer['kind']
  parentId: string | null
  visible: boolean
  opacity: number
  blend: Layer['blend']
  clip: boolean
  /** 문서 px, 회전 전 사각형의 왼쪽 위 */
  x: number
  y: number
  width: number
  height: number
  rotation: number
  hasMask: boolean
  lock: { alpha: boolean; pixels: boolean; position: boolean }
}

export interface DocSummary {
  width: number
  height: number
  resolution: number
  layerCount: number
  activeLayerId: string | null
  /** 선택 영역 경계 (없으면 null) */
  selection: { x: number; y: number; w: number; h: number } | null
  guides: { vertical: number[]; horizontal: number[] }
}

export function describeDoc(doc: Doc): DocSummary {
  return {
    width: doc.width,
    height: doc.height,
    resolution: doc.resolution,
    layerCount: doc.layers.length,
    activeLayerId: doc.activeId,
    selection: doc.selection?.bounds ?? null,
    guides: { vertical: doc.guides?.v ?? [], horizontal: doc.guides?.h ?? [] }
  }
}

/** 레이어 목록 — 배열 순서는 아래 → 위 (문서 모델과 같음) */
export function describeLayers(doc: Doc): LayerInfo[] {
  return doc.layers.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    parentId: l.parentId,
    visible: l.visible,
    opacity: l.opacity,
    blend: l.blend,
    clip: l.clip,
    x: l.transform.x,
    y: l.transform.y,
    width: l.transform.width,
    height: l.transform.height,
    rotation: l.transform.rotation,
    hasMask: !!l.mask,
    lock: { alpha: !!l.lock?.alpha, pixels: !!l.lock?.pixels, position: !!l.lock?.position }
  }))
}
