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
  hasVectorMask: boolean
  /** 켜진 레이어 효과 이름 (stroke·shadow·innerShadow·overlay·outerGlow·gradientOverlay·bevel) */
  effects: string[]
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
  /** 패스 목록 (id·이름·앵커 수) */
  paths: { id: string; name: string; anchors: number }[]
}

export function describeDoc(doc: Doc): DocSummary {
  return {
    width: doc.width,
    height: doc.height,
    resolution: doc.resolution,
    layerCount: doc.layers.length,
    activeLayerId: doc.activeId,
    selection: doc.selection?.bounds ?? null,
    guides: { vertical: doc.guides?.v ?? [], horizontal: doc.guides?.h ?? [] },
    paths: (doc.paths ?? []).map((p) => ({ id: p.id, name: p.name, anchors: p.subpaths.reduce((a, s) => a + s.anchors.length, 0) }))
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
    hasVectorMask: !!l.vectorMask?.enabled,
    effects: Object.entries(l.effects ?? {})
      .filter(([, v]) => (v as { enabled?: boolean } | undefined)?.enabled)
      .map(([k]) => k),
    lock: { alpha: !!l.lock?.alpha, pixels: !!l.lock?.pixels, position: !!l.lock?.position }
  }))
}
