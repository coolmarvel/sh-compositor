/**
 * 문서 조작 (순수 TS) — 전부 새 Doc 을 돌려준다(불변). Compositor `EditorSession` 의 레이어·캔버스 명령들.
 * 레이어 배열은 아래 → 위이고, 같은 부모끼리의 상대 순서만 의미가 있다(폴더 = parentId).
 */
import { newId, type Bitmap, type Doc, type Layer, type LayerKind, type AdjustmentKind, type BlendMode, type LayerTransform } from './types'
import { createBitmap, cropBitmap, opaqueBounds, grayBitmap } from './bitmap'
import { identityTransform, transformBounds } from './transform'
import { flattenLayers, flattenDoc } from './render'
import { DEFAULT_ADJUST } from '../adjust'
import { anchorOffset, type Anchor } from '../canvassize'

// ── 만들기 ────────────────────────────────────────────────────────────────

export function makeLayer(kind: LayerKind, name: string, bitmap: Bitmap | null, transform?: LayerTransform, extra: Partial<Layer> = {}): Layer {
  return {
    id: newId(),
    name,
    kind,
    visible: true,
    opacity: 1,
    blend: 'normal',
    bitmap,
    transform: transform ?? identityTransform(bitmap?.width ?? 1, bitmap?.height ?? 1),
    parentId: null,
    mask: null,
    clip: false,
    effects: null,
    adjustment: null,
    text: null,
    ...extra
  }
}

/** 새 캔버스 — 배경 레이어 하나 (흰색·투명·지정 색) — Compositor `NewCanvasSheet` */
export function newDoc(width: number, height: number, background: [number, number, number, number] | null = [255, 255, 255, 255], resolution = 72): Doc {
  const layer = makeLayer('pixel', '배경', createBitmap(width, height, background ?? undefined))
  return { id: newId(), width: Math.round(width), height: Math.round(height), resolution, layers: [layer], activeId: layer.id, selection: null }
}

/** 이미지 한 장으로 문서 */
export function docFromBitmap(bitmap: Bitmap, name: string, resolution = 72): Doc {
  const layer = makeLayer('pixel', name, bitmap)
  return { id: newId(), width: bitmap.width, height: bitmap.height, resolution, layers: [layer], activeId: layer.id, selection: null }
}

// ── 찾기 ──────────────────────────────────────────────────────────────────

export function getLayer(doc: Doc, id: string | null | undefined): Layer | null {
  return (id && doc.layers.find((l) => l.id === id)) || null
}

export function childrenOf(doc: Doc, parentId: string | null): Layer[] {
  return doc.layers.filter((l) => l.parentId === parentId)
}

/** 자손 id 전부 (자신 제외) */
export function descendantsOf(doc: Doc, id: string): string[] {
  const out: string[] = []
  const walk = (pid: string): void => {
    for (const l of doc.layers)
      if (l.parentId === pid) {
        out.push(l.id)
        walk(l.id)
      }
  }
  walk(id)
  return out
}

/** 위 → 아래 트리 순서로 (레이어 패널 표시 순서), 깊이 포함 */
export function displayOrder(doc: Doc): { layer: Layer; depth: number }[] {
  const out: { layer: Layer; depth: number }[] = []
  const walk = (pid: string | null, depth: number): void => {
    const kids = childrenOf(doc, pid)
    for (let i = kids.length - 1; i >= 0; i--) {
      out.push({ layer: kids[i], depth })
      if (kids[i].kind === 'group' && !kids[i].collapsed) walk(kids[i].id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** 레이어가 실제로 보이는가 (조상 폴더까지 전부 보여야) */
export function isEffectivelyVisible(doc: Doc, id: string): boolean {
  let l = getLayer(doc, id)
  while (l) {
    if (!l.visible) return false
    l = getLayer(doc, l.parentId)
  }
  return true
}

// ── 레이어 추가·삭제 ─────────────────────────────────────────────────────

/** 활성 레이어 바로 위(같은 폴더)에 끼워 넣는다 */
export function insertLayer(doc: Doc, layer: Layer, aboveId: string | null = doc.activeId): Doc {
  const above = getLayer(doc, aboveId)
  const placed: Layer = { ...layer, parentId: above ? (above.kind === 'group' && !above.collapsed && layer.parentId === null ? above.id : above.parentId) : null }
  const layers = [...doc.layers]
  const idx = above ? layers.findIndex((l) => l.id === above.id) : layers.length - 1
  layers.splice(idx + 1, 0, placed)
  return { ...doc, layers, activeId: placed.id }
}

export function addBlankLayer(doc: Doc, name?: string): Doc {
  const n = doc.layers.filter((l) => l.kind === 'pixel').length + 1
  return insertLayer(doc, makeLayer('pixel', name ?? `레이어 ${n}`, createBitmap(doc.width, doc.height)))
}

export function addAdjustmentLayer(doc: Doc, kind: AdjustmentKind, label: string): Doc {
  const layer = makeLayer('adjustment', label, null, identityTransform(doc.width, doc.height), {
    adjustment: { kind, settings: kind === 'invert' ? { ...DEFAULT_ADJUST, invert: true } : DEFAULT_ADJUST }
  })
  return insertLayer(doc, layer)
}

export function removeLayers(doc: Doc, ids: string[]): Doc {
  const kill = new Set<string>()
  for (const id of ids) {
    kill.add(id)
    for (const d of descendantsOf(doc, id)) kill.add(d)
  }
  const layers = doc.layers.filter((l) => !kill.has(l.id))
  const activeIdx = doc.layers.findIndex((l) => l.id === doc.activeId)
  let activeId = doc.activeId && !kill.has(doc.activeId) ? doc.activeId : null
  if (!activeId && layers.length) {
    // 지운 자리 바로 아래(없으면 맨 위)
    const below = doc.layers
      .slice(0, Math.max(0, activeIdx))
      .reverse()
      .find((l) => !kill.has(l.id))
    activeId = (below ?? layers[layers.length - 1]).id
  }
  return { ...doc, layers, activeId }
}

/** 복제 — 폴더면 자손까지. 복사본은 원본 바로 위 */
export function duplicateLayers(doc: Doc, ids: string[]): Doc {
  let out = doc
  let lastId: string | null = null
  for (const id of ids) {
    const src = getLayer(out, id)
    if (!src) continue
    const map = new Map<string, string>()
    const family = [src, ...descendantsOf(out, id).map((d) => getLayer(out, d)!)]
    for (const l of family) map.set(l.id, newId())
    const copies = family.map((l) => ({ ...l, id: map.get(l.id)!, name: l.id === src.id ? `${l.name} 복사` : l.name, parentId: l.id === src.id ? l.parentId : map.get(l.parentId!)! }))
    const layers = [...out.layers]
    const idx = layers.findIndex((l) => l.id === id)
    layers.splice(idx + 1, 0, ...copies.reverse().reverse())
    out = { ...out, layers }
    lastId = map.get(src.id)!
  }
  return lastId ? { ...out, activeId: lastId } : out
}

export function updateLayer(doc: Doc, id: string, patch: Partial<Layer>): Doc {
  return { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }
}

export function setActive(doc: Doc, id: string | null): Doc {
  return doc.activeId === id ? doc : { ...doc, activeId: id }
}

// ── 순서 ──────────────────────────────────────────────────────────────────

/** 같은 폴더 안에서 한 칸 위(+1)/아래(−1) — Compositor `moveActiveLayer(by:)` */
export function moveLayerBy(doc: Doc, id: string, by: 1 | -1): Doc {
  const l = getLayer(doc, id)
  if (!l) return doc
  const sibs = childrenOf(doc, l.parentId)
  const i = sibs.findIndex((s) => s.id === id)
  const j = i + by
  if (j < 0 || j >= sibs.length) return doc
  return moveLayerTo(doc, id, sibs[j].id, by > 0 ? 'above' : 'below')
}

export function canMoveLayerBy(doc: Doc, id: string, by: 1 | -1): boolean {
  const l = getLayer(doc, id)
  if (!l) return false
  const sibs = childrenOf(doc, l.parentId)
  const j = sibs.findIndex((s) => s.id === id) + by
  return j >= 0 && j < sibs.length
}

/**
 * 끌어서 놓기 — target 의 위/아래 또는 폴더 안(inside)으로. 폴더를 자기 자손 안으로는 못 넣는다.
 * 자손은 함께 따라간다(순서 유지).
 */
export function moveLayerTo(doc: Doc, id: string, targetId: string, where: 'above' | 'below' | 'inside'): Doc {
  if (id === targetId) return doc
  const moving = getLayer(doc, id)
  const target = getLayer(doc, targetId)
  if (!moving || !target) return doc
  if (descendantsOf(doc, id).includes(targetId)) return doc
  const family = new Set([id, ...descendantsOf(doc, id)])
  const block = doc.layers.filter((l) => family.has(l.id))
  const rest = doc.layers.filter((l) => !family.has(l.id))
  const parentId = where === 'inside' ? target.id : target.parentId
  const head = block.map((l) => (l.id === id ? { ...l, parentId } : l))
  let idx = rest.findIndex((l) => l.id === targetId)
  if (where === 'above') idx += 1
  if (where === 'inside') {
    // 폴더의 맨 위 자식으로 = 폴더 자손 중 가장 뒤 다음 (배열상 폴더 앞쪽에 자식이 와도 상대 순서만 본다)
    const kids = rest.filter((l) => l.parentId === target.id)
    idx = kids.length ? rest.findIndex((l) => l.id === kids[kids.length - 1].id) + 1 : rest.findIndex((l) => l.id === target.id)
  }
  const layers = [...rest.slice(0, idx), ...head, ...rest.slice(idx)]
  return { ...doc, layers }
}

// ── 폴더 ──────────────────────────────────────────────────────────────────

/** 선택한 레이어들을 새 폴더로 (가장 위 레이어 자리) — Compositor ⌘G */
export function groupLayers(doc: Doc, ids: string[]): Doc {
  if (ids.length === 0) return doc
  const set = new Set(ids)
  const top = [...doc.layers].reverse().find((l) => set.has(l.id))!
  const group = makeLayer('group', `폴더 ${doc.layers.filter((l) => l.kind === 'group').length + 1}`, null, identityTransform(doc.width, doc.height), { parentId: top.parentId })
  let out: Doc = { ...doc, layers: [...doc.layers] }
  const idx = out.layers.findIndex((l) => l.id === top.id)
  out.layers.splice(idx + 1, 0, group)
  out = { ...out, layers: out.layers.map((l) => (set.has(l.id) && !ids.some((o) => o !== l.id && descendantsOf(doc, o).includes(l.id)) ? { ...l, parentId: group.id } : l)) }
  return { ...out, activeId: group.id }
}

/** 폴더에서 꺼내기 — 한 단계 위 폴더로, 폴더 바로 위 자리에 */
export function moveOutOfGroup(doc: Doc, id: string): Doc {
  const l = getLayer(doc, id)
  if (!l?.parentId) return doc
  return moveLayerTo(doc, id, l.parentId, 'above')
}

/** 폴더 풀기 — 자식을 폴더 자리로 올리고 폴더 삭제 */
export function ungroup(doc: Doc, groupId: string): Doc {
  const g = getLayer(doc, groupId)
  if (!g || g.kind !== 'group') return doc
  const layers = doc.layers.filter((l) => l.id !== groupId).map((l) => (l.parentId === groupId ? { ...l, parentId: g.parentId } : l))
  return { ...doc, layers, activeId: childrenOf(doc, groupId).slice(-1)[0]?.id ?? doc.activeId }
}

// ── 병합 ──────────────────────────────────────────────────────────────────

/** ids 를 한 장으로 합쳐 가장 아래 레이어 자리에 둔다 (Compositor Merge Layers ⌘E) */
export function mergeLayers(doc: Doc, ids: string[], name?: string): Doc {
  const set = new Set(ids)
  const involved = doc.layers.filter((l) => set.has(l.id))
  if (involved.length === 0) return doc
  const flat = flattenLayers(doc, set)
  const b = opaqueBounds(flat)
  const bitmap = b ? cropBitmap(flat, b.x, b.y, b.w, b.h) : createBitmap(1, 1)
  const bottom = involved[0]
  const merged = makeLayer('pixel', name ?? bottom.name, bitmap, identityTransform(bitmap.width, bitmap.height, b?.x ?? 0, b?.y ?? 0), { parentId: bottom.parentId })
  const kill = new Set<string>()
  for (const l of involved) {
    kill.add(l.id)
    for (const d of descendantsOf(doc, l.id)) kill.add(d)
  }
  const layers: Layer[] = []
  for (const l of doc.layers) {
    if (l.id === bottom.id) layers.push(merged)
    else if (!kill.has(l.id)) layers.push(l)
  }
  return { ...doc, layers, activeId: merged.id }
}

/** 아래로 병합 — 같은 폴더의 바로 아래 형제와 */
export function mergeDown(doc: Doc, id: string): Doc {
  const l = getLayer(doc, id)
  if (!l) return doc
  const sibs = childrenOf(doc, l.parentId)
  const i = sibs.findIndex((s) => s.id === id)
  if (i <= 0) return doc
  return mergeLayers(doc, [sibs[i - 1].id, id], sibs[i - 1].name)
}

/** 이미지 병합 — 보이는 것 전부 한 장 (숨긴 레이어는 버림) */
export function flattenImage(doc: Doc): Doc {
  const flat = flattenDoc(doc)
  const layer = makeLayer('pixel', '배경', flat)
  return { ...doc, layers: [layer], activeId: layer.id }
}

// ── 캔버스 ────────────────────────────────────────────────────────────────

/** 모든 레이어를 (dx,dy) 만큼 옮긴다 */
function shiftLayers(layers: Layer[], dx: number, dy: number): Layer[] {
  return layers.map((l) => ({ ...l, transform: { ...l.transform, x: l.transform.x + dx, y: l.transform.y + dy } }))
}

/** 캔버스 크기 — 픽셀은 그대로, 종이만 (Compositor CanvasResizer). 조정 레이어·폴더는 새 크기로 */
export function resizeCanvas(doc: Doc, width: number, height: number, anchor: Anchor): Doc {
  const { dx, dy } = anchorOffset(doc.width, doc.height, width, height, anchor)
  const layers = shiftLayers(doc.layers, dx, dy).map((l) =>
    l.kind === 'group' || l.kind === 'adjustment' ? { ...l, transform: identityTransform(width, height), mask: l.mask ? { ...l.mask, bitmap: grayBitmap(width, height, 255) } : null } : l
  )
  return { ...doc, width: Math.round(width), height: Math.round(height), layers, selection: null }
}

/** 이미지 크기 — 변형을 비율대로 (비파괴: 비트맵은 원본 해상도 유지 — Compositor 도 변형을 유지한다) */
export function resizeImage(doc: Doc, width: number, height: number, resolution = doc.resolution): Doc {
  const sx = width / doc.width
  const sy = height / doc.height
  const layers = doc.layers.map((l) => ({
    ...l,
    transform: { ...l.transform, x: l.transform.x * sx, y: l.transform.y * sy, width: l.transform.width * sx, height: l.transform.height * sy }
  }))
  return { ...doc, width: Math.round(width), height: Math.round(height), resolution, layers, selection: null }
}

/** 자르기 — 사각형을 새 문서 영역으로 (레이어 픽셀은 그대로, 위치만 옮김) */
export function cropDoc(doc: Doc, rect: { x: number; y: number; w: number; h: number }): Doc {
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  const w = Math.max(1, Math.round(rect.w))
  const h = Math.max(1, Math.round(rect.h))
  const layers = shiftLayers(doc.layers, -x, -y).map((l) => (l.kind === 'group' || l.kind === 'adjustment' ? { ...l, transform: identityTransform(w, h) } : l))
  return { ...doc, width: w, height: h, layers, selection: null }
}

/** 캔버스 반전 — 모든 레이어를 문서 중심 기준으로 */
export function flipCanvas(doc: Doc, horizontal: boolean): Doc {
  const layers = doc.layers.map((l) => {
    const t = l.transform
    const x = horizontal ? doc.width - (t.x + t.width) : t.x
    const y = horizontal ? t.y : doc.height - (t.y + t.height)
    return { ...l, transform: { ...t, x, y, rotation: -t.rotation, flipH: horizontal ? !t.flipH : t.flipH, flipV: horizontal ? t.flipV : !t.flipV } }
  })
  return { ...doc, layers }
}

/** 캔버스 90° 회전 (시계=1, 반시계=-1) */
export function rotateCanvas90(doc: Doc, dir: 1 | -1): Doc {
  const W = doc.width
  const H = doc.height
  const layers = doc.layers.map((l) => {
    const t = l.transform
    const cx = t.x + t.width / 2
    const cy = t.y + t.height / 2
    // 시계: (x,y) → (H − y, x)
    const ncx = dir === 1 ? H - cy : cy
    const ncy = dir === 1 ? cx : W - cx
    if (l.kind === 'group' || l.kind === 'adjustment') return { ...l, transform: identityTransform(H, W) }
    return { ...l, transform: { ...t, x: ncx - t.width / 2, y: ncy - t.height / 2, rotation: t.rotation + 90 * dir } }
  })
  return { ...doc, width: H, height: W, layers, selection: null }
}

/** 레이어 반전 (변형만 — 비파괴) */
export function flipLayer(doc: Doc, id: string, horizontal: boolean): Doc {
  const l = getLayer(doc, id)
  if (!l) return doc
  return updateLayer(doc, id, { transform: { ...l.transform, [horizontal ? 'flipH' : 'flipV']: !l.transform[horizontal ? 'flipH' : 'flipV'] } })
}

/** 문서 안에서 레이어가 차지하는 경계 */
export function layerDocBounds(l: Layer): { x: number; y: number; w: number; h: number } {
  return transformBounds(l.transform)
}

export function setBlend(doc: Doc, id: string, blend: BlendMode): Doc {
  return updateLayer(doc, id, { blend })
}
