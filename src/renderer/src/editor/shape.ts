/**
 * 도형 레이어 — 모양 데이터(ShapeData)로 비트맵을 그린다. 크기를 바꾸거나 채우기·외곽선을 고치면 다시 그려서 또렷하다
 * (포토샵 모양 레이어의 단순판). 좌표: 비트맵 = 도형 크기 + 사방 여백(외곽선 절반 + 2px).
 */
import { getLayer, updateLayer, type Doc, type Layer, type ShapeData } from '@core/index'

// 래스터라이저는 core/shape.ts (서버와 같은 코드)
export { shapePad, renderShape } from '@core/shape'
import { shapePad, renderShape } from '@core/shape'

/** 모양 데이터를 바꿔 다시 그린다 — 가운데·회전은 유지 */
export function reshape(doc: Doc, id: string, patch: Partial<ShapeData>): Doc {
  const l = getLayer(doc, id)
  if (!l?.shape) return doc
  const d = { ...l.shape, ...patch }
  const bmp = renderShape(d)
  const t = l.transform
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  return updateLayer(doc, id, { shape: d, bitmap: bmp, transform: { ...t, x: cx - bmp.width / 2, y: cy - bmp.height / 2, width: bmp.width, height: bmp.height } })
}

/** 이동 도구로 크기를 바꾼 뒤: 늘어난 비율만큼 도형 자체를 키워 다시 그린다 (외곽선 두께는 그대로 — 포토샵과 같음) */
export function reshapeToTransform(doc: Doc, l: Layer): Doc {
  if (!l.shape || !l.bitmap) return doc
  const t = l.transform
  const kx = t.width / l.bitmap.width
  const ky = t.height / l.bitmap.height
  if (Math.abs(kx - 1) < 1e-3 && Math.abs(ky - 1) < 1e-3 && !t.flipH && !t.flipV) return doc
  const pad = shapePad(l.shape)
  const w = Math.max(1, (l.bitmap.width - pad * 2) * kx)
  const h = Math.max(1, (l.bitmap.height - pad * 2) * ky)
  // 반전은 선 방향에만 의미가 있다 (사각·타원은 대칭)
  const flip = (t.flipH ? 1 : 0) ^ (t.flipV ? 1 : 0)
  const dir = l.shape.kind === 'line' && flip ? ((l.shape.dir === -1 ? 1 : -1) as 1 | -1) : l.shape.dir
  const d2 = { ...l.shape, w, h, dir }
  const bmp = renderShape(d2)
  const cx = t.x + t.width / 2
  const cy = t.y + t.height / 2
  return updateLayer(doc, l.id, { shape: d2, bitmap: bmp, transform: { ...t, flipH: false, flipV: false, x: cx - bmp.width / 2, y: cy - bmp.height / 2, width: bmp.width, height: bmp.height } })
}
