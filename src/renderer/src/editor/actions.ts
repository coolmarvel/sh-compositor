/**
 * 편집 동작 — 메뉴·단축키·패널 버튼이 모두 여기를 부른다 (Compositor `EditorSession+*` 의 명령들).
 * React 밖의 평범한 함수: 현재 문서를 읽고 `editor.commit` 으로 한 칸씩 이력에 남긴다.
 */
import { editor } from './store'
import { bakeLayer, editPixels, fillSelection, eraseSelection, adjustLayer, layerViaCopy, selWeight, pixelsLocked } from './pixels'
import { copyToClipboard, mergedBitmap } from './io'
import { capture, land, currentDoc } from './commandBridge'
import {
  getLayer,
  updateLayer,
  addBlankLayer,
  addAdjustmentLayer,
  removeLayers,
  duplicateLayers,
  moveLayerBy,
  groupLayers,
  ungroup,
  mergeDown,
  mergeLayers,
  flattenImage,
  cropDoc,
  resizeCanvas,
  canvasTarget,
  anchorOffset,
  parseHex,
  CONTENT_FILL,
  type CanvasSizeOptions,
  flipCanvas,
  rotateCanvas90,
  selectAll as fullSelection,
  invertSelection as invertSel,
  growSelection,
  featherSelection,
  makeSelection,
  rasterizeLayer,
  histogram,
  autoLevelsFor,
  contentFill,
  gaussianBlur,
  transformBounds,
  selectionStrokeCoverage,
  smoothSelection,
  isEffectivelyVisible,
  DEFAULT_ADJUST,
  ADJUSTMENT_KINDS,
  type AdjustmentKind,
  type AutoLevelsMode,
  type Adjustments,
  type Doc,
  type Layer,
  type MatteRefine
} from '@core/index'

type BgOptions = { engine: 'offline' | 'online'; model?: 'isnet_fp16' | 'isnet' }

const doc = (): Doc | null => editor.doc

/** 마스크 편집 중이면 그 레이어(그룹·조정 레이어 포함) — 마스크 칠하기·채우기·지우기 대상 */
function maskLayer(d: Doc): Layer | null {
  const l = getLayer(d, d.activeId)
  return editor.state.maskEditing && l?.mask ? l : null
}

/** 픽셀을 바꿀 수 있는 활성 레이어 (아니면 안내하고 null) */
function pixelLayer(d: Doc, what = '이 작업'): Layer | null {
  const l = getLayer(d, d.activeId)
  if (!l) {
    editor.toast('info', `${what}에는 레이어를 먼저 고르세요.`)
    return null
  }
  if (l.kind === 'group' || l.kind === 'adjustment') {
    editor.toast('info', `${what}은(는) 픽셀 레이어에만 할 수 있습니다.`)
    return null
  }
  if (!l.visible) {
    editor.toast('info', '숨긴 레이어입니다. 눈 아이콘을 켜고 다시 해 주세요.')
    return null
  }
  if (pixelsLocked(l, (m) => editor.toast('info', m))) return null
  return l
}

// ── 선택 (Compositor Select 메뉴) ──
export function selectAll(): void {
  const d = doc()
  if (d) editor.commit({ ...d, selection: fullSelection(d.width, d.height) }, '모두 선택')
}
export function deselect(): void {
  const d = doc()
  if (d?.selection) editor.commit({ ...d, selection: null }, '선택 해제')
}
export function invertSelection(): void {
  const d = doc()
  if (d) editor.commit({ ...d, selection: invertSel(d.selection, d.width, d.height) }, '선택 반전')
}
export function modifySelection(op: 'expand' | 'contract' | 'feather', px: number): void {
  const d = doc()
  if (!d?.selection || px <= 0) return
  const sel = op === 'feather' ? featherSelection(d.selection, px) : growSelection(d.selection, op === 'expand' ? px : -px)
  editor.commit({ ...d, selection: sel }, op === 'expand' ? '선택 확장' : op === 'contract' ? '선택 축소' : '선택 페더')
}
/** 선택 ▸ 수정 ▸ 매끄럽게 */
export function smoothSel(px: number): void {
  const d = doc()
  if (!d?.selection || px <= 0) return
  editor.commit({ ...d, selection: smoothSelection(d.selection, px) }, '선택 매끄럽게')
}

/** 편집 ▸ 선 그리기 — 선택 테두리를 따라 색으로 칠한다 (활성 픽셀 레이어에) */
export function strokeSelection(o: { width: number; color: [number, number, number]; position: 'inside' | 'center' | 'outside'; opacity: number }): void {
  const d = doc()
  if (!d?.selection?.bounds) return editor.toast('info', '선을 그릴 영역을 먼저 선택하세요.')
  const l = pixelLayer(d, '선 그리기')
  if (!l) return
  const cov = selectionStrokeCoverage(d.selection, o.width, o.position)
  const b = d.selection.bounds
  const m = Math.ceil(o.width) + 2
  // 선이 선택 밖으로도 나가므로 선택 제한 없이 칠하고, 선택은 그대로 돌려놓는다
  const out = editPixels({ ...d, selection: null }, l.id, 'layer', { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, (px, w, h, ox, oy) => {
    for (let y = 0; y < h; y++) {
      const dy = y + oy
      if (dy < 0 || dy >= d.height) continue
      for (let x = 0; x < w; x++) {
        const dx = x + ox
        if (dx < 0 || dx >= d.width) continue
        const a = cov[dy * d.width + dx] * o.opacity
        if (a <= 0) continue
        const i = (y * w + x) * 4
        const da = px[i + 3] / 255
        const oa = a + da * (1 - a)
        for (let c = 0; c < 3; c++) px[i + c] = (o.color[c] * a + px[i + c] * da * (1 - a)) / oa
        px[i + 3] = oa * 255
      }
    }
  })
  editor.commit({ ...out, selection: d.selection }, '선 그리기')
}

/** 레이어 픽셀(알파)로 선택 — 레이어 썸네일 Ctrl+클릭 */
export function selectLayerPixels(id: string): void {
  const d = doc()
  const l = d && getLayer(d, id)
  if (!d || !l) return
  const r = rasterizeLayer({ ...l, visible: true, opacity: 1 }, d.width, d.height)
  if (!r) return editor.toast('info', '빈 레이어입니다.')
  const mask = new Uint8Array(d.width * d.height)
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const dx = r.x + x
      const dy = r.y + y
      if (dx < 0 || dy < 0 || dx >= d.width || dy >= d.height) continue
      mask[dy * d.width + dx] = r.data[(y * r.width + x) * 4 + 3]
    }
  editor.commit({ ...d, selection: makeSelection(d.width, d.height, mask) }, '레이어 픽셀 선택')
}

// ── 편집 ──
export async function copy(merged = false): Promise<void> {
  await copyToClipboard(merged)
}
export async function cut(): Promise<void> {
  const d = doc()
  if (!d) return
  const l = pixelLayer(d, '잘라내기')
  if (!l) return
  await copyToClipboard(false)
  editor.commit(eraseSelection(d, l.id), '잘라내기')
}
export function clearPixels(): void {
  const d = doc()
  if (!d) return
  const ml = maskLayer(d)
  if (ml) return editor.commit(fillSelection(d, ml.id, [0, 0, 0], 'mask'), '마스크 가리기')
  const l = pixelLayer(d, '지우기')
  if (!l) return
  if (!d.selection) return editor.toast('info', '지울 영역을 먼저 선택하세요. 레이어를 통째로 지우려면 레이어 메뉴의 레이어 삭제를 쓰세요.')
  editor.commit(eraseSelection(d, l.id), '픽셀 지우기')
}
export function fill(which: 'fg' | 'bg'): void {
  const d = doc()
  if (!d) return
  const rgb = which === 'fg' ? editor.state.fg : editor.state.bg
  const ml = maskLayer(d)
  if (ml) return editor.commit(fillSelection(d, ml.id, rgb, 'mask'), which === 'fg' ? '마스크 전경색 채우기' : '마스크 배경색 채우기')
  const l = pixelLayer(d, '채우기')
  if (!l) return
  editor.commit(fillSelection(d, l.id, rgb, 'layer'), which === 'fg' ? '전경색 채우기' : '배경색 채우기')
}
export function viaCopy(cutOut: boolean): void {
  const d = doc()
  if (!d) return
  if (!d.selection) {
    if (!cutOut) duplicate()
    return
  }
  if (!pixelLayer(d)) return
  editor.commit(layerViaCopy(d, cutOut), cutOut ? '잘라서 새 레이어' : '복사해서 새 레이어')
}

// ── 이미지 ──
export function cropToSelection(): void {
  const d = doc()
  if (!d?.selection?.bounds) return editor.toast('info', '자를 영역을 먼저 선택하세요.')
  editor.commit({ ...cropDoc(d, d.selection.bounds), selection: null }, '선택 영역으로 자르기')
}
export function rotateCanvas(dir: 1 | -1 | 2): void {
  const d = doc()
  if (!d) return
  if (dir === 2) editor.commit(rotateCanvas90(rotateCanvas90(d, 1), 1), '캔버스 180° 회전')
  else editor.commit(rotateCanvas90(d, dir), dir === 1 ? '캔버스 90° 시계 방향' : '캔버스 90° 반시계 방향')
}
export function flipCanvasCmd(horizontal: boolean): void {
  const d = doc()
  if (d) editor.commit(flipCanvas(d, horizontal), horizontal ? '캔버스 좌우 반전' : '캔버스 상하 반전')
}
/** 투명 여백 잘라내기 — 보이는 픽셀의 경계로 캔버스를 줄인다 */
export function trimTransparent(): void {
  const d = doc()
  if (!d) return
  const flat = mergedBitmap(d)
  let x0 = d.width
  let y0 = d.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < d.height; y++)
    for (let x = 0; x < d.width; x++)
      if (flat.data[(y * d.width + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return editor.toast('info', '보이는 픽셀이 없습니다.')
  if (x0 === 0 && y0 === 0 && x1 === d.width - 1 && y1 === d.height - 1) return editor.toast('info', '잘라낼 투명 여백이 없습니다.')
  editor.commit(cropDoc(d, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }), '투명 여백 자르기')
}

/** 바로 적용하는 보정 (반전·채도 감소·자동 레벨) — 활성 레이어에 */
export function quickAdjust(kind: 'invert' | 'desaturate' | AutoLevelsMode): void {
  const d = doc()
  if (!d) return
  const l = pixelLayer(d, '보정')
  if (!l) return
  let a: Adjustments
  if (kind === 'invert') a = { ...DEFAULT_ADJUST, invert: true }
  else if (kind === 'desaturate') a = { ...DEFAULT_ADJUST, saturation: -100 }
  else {
    const baked = getLayer(bakeLayer(d, l.id), l.id)!
    const auto = autoLevelsFor(histogram(baked.bitmap!.data), kind)
    if (!auto) return editor.toast('info', '이미 범위를 다 쓰고 있어 바꿀 것이 없습니다.')
    a = { ...DEFAULT_ADJUST, ...auto }
  }
  const label = kind === 'invert' ? '반전' : kind === 'desaturate' ? '채도 감소' : '자동 레벨'
  if (editor.state.maskEditing && l.mask && kind === 'invert')
    return editor.commit(
      editPixels(d, l.id, 'mask', undefined, (px) => {
        for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255 - px[i]
      }),
      '마스크 반전'
    )
  editor.commit(adjustLayer(d, l.id, a, null), label)
}

/** 내용 인식 채우기 — 선택 영역을 주변 픽셀로 (Compositor Edit ▸ Content-Aware Fill) */
export async function contentAwareFill(): Promise<void> {
  const d = doc()
  if (!d) return
  if (!d.selection?.bounds) return editor.toast('info', '채울 영역을 먼저 선택하세요.')
  const l = pixelLayer(d, '내용 인식 채우기')
  const at = capture()
  if (!l || !at) return
  await editor.busy('내용 인식 채우기…', () => {
    // 선택을 한 번에 채우려면 레이어가 캔버스 전체를 덮어야 한다
    const out = editPixels(d, l.id, 'layer', { x: 0, y: 0, w: d.width, h: d.height }, (px, w, h, ox, oy) => {
      const target = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) target[y * w + x] = selWeight(d, x + ox, y + oy) > 0.5 ? 1 : 0
      // 채울 곳은 원본으로 쓰지 않는다
      if (!contentFill(px, target, w, h)) throw new Error('원본으로 쓸 불투명 픽셀이 없습니다.')
    })
    land(at, { ...out, selection: d.selection }, '내용 인식 채우기')
  })
}

/** AI 배경 제거 → 레이어 마스크 (선택 영역이 있어도 레이어 전체 기준) */
export async function removeBackground(refine: MatteRefine | null, opts: BgOptions = { engine: 'offline' }): Promise<void> {
  const d = doc()
  if (!d) return
  const l = pixelLayer(d, '배경 제거')
  const at = capture()
  if (!l || !at) return
  await editor.busy('배경 제거 준비 중…', async () => {
    const baked = bakeLayer(d, l.id)
    const b = getLayer(baked, l.id)!
    const { subjectMask } = await import('./bgremove')
    // 탭을 닫으면 그 탭을 위한 추론을 그만 기다린다
    const mask = await subjectMask(b.bitmap!, refine, opts, (label, value) => editor.set({ progress: { label, value } }), at.signal).catch((e) => {
      if (at.signal.aborted) return null
      throw e
    })
    if (!mask) return
    const data = new Uint8ClampedArray(mask.length * 4)
    const old = b.mask?.bitmap.data
    for (let i = 0; i < mask.length; i++) {
      const v = old ? Math.round((mask[i] * old[i * 4]) / 255) : mask[i]
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v
      data[i * 4 + 3] = 255
    }
    if (!land(at, updateLayer(baked, l.id, { mask: { bitmap: { width: b.bitmap!.width, height: b.bitmap!.height, data }, enabled: true, linked: true } }), '배경 제거')) return
    editor.toast('ok', `배경을 레이어 마스크로 가렸습니다 (${opts.engine === 'online' ? '온라인 최신 모델' : '내장 모델'}). 마스크를 칠해 다듬을 수 있습니다.`)
  })
}

/**
 * 캔버스 크기 — 종이를 늘이고(앵커 기준) 늘어난 여백을 맨 아래 레이어에 채운다.
 * 투명이면 그대로, 색이면 그 색, 내용 인식이면 주변 그림으로 (Compositor CanvasResizer + ContentFill).
 */
export async function applyCanvasSize(o: CanvasSizeOptions): Promise<void> {
  const d = doc()
  const at = capture()
  if (!d || !at) return
  const t = canvasTarget(d.width, d.height, o)
  if (t.width === d.width && t.height === d.height) return
  let next = resizeCanvas(d, t.width, t.height, o.anchor)
  const bottom = next.layers.find((l) => l.parentId === null && (l.kind === 'pixel' || l.kind === 'text') && l.visible)
  if (o.background !== null && bottom) {
    const { dx, dy } = anchorOffset(d.width, d.height, t.width, t.height, o.anchor)
    // 원래 캔버스 자리 (새 좌표) 밖 = 여백
    const inOld = (x: number, y: number): boolean => x >= dx && y >= dy && x < dx + d.width && y < dy + d.height
    const content = o.background === CONTENT_FILL
    const rgb = content ? [0, 0, 0] : parseHex(o.background)
    const run = (): void => {
      next = editPixels({ ...next, selection: null }, bottom.id, 'layer', { x: 0, y: 0, w: t.width, h: t.height }, (px, w, h, ox, oy) => {
        const target = new Uint8Array(w * h)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            if (inOld(x + ox, y + oy)) continue
            const i = (y * w + x) * 4
            if (content) target[y * w + x] = 1
            else if (px[i + 3] < 255) {
              // 여백: 투명한 곳만 색으로 (레이어가 원래 캔버스 밖까지 있던 픽셀은 둔다)
              const a = px[i + 3] / 255
              for (let c = 0; c < 3; c++) px[i + c] = px[i + c] * a + rgb[c] * (1 - a)
              px[i + 3] = 255
            }
          }
        if (content) contentFill(px, target, w, h)
      })
    }
    if (content) await editor.busy('내용 인식으로 여백 채우는 중…', run)
    else run()
  }
  land(at, next, '캔버스 크기')
}

/** 배경 제거 대화상자에서 고른 엔진 방식 (자동·내장·최신) → 이번에 쓸 엔진. 최신 전용인데 연결이 없으면 null */
async function pickEngine(): Promise<'offline' | 'online' | null> {
  let mode = 'auto'
  try {
    mode = localStorage.getItem('sc.bgMode') ?? 'auto'
  } catch {
    /* 무시 */
  }
  if (mode === 'offline') return 'offline'
  const { checkOnline } = await import('./bgremove')
  if (await checkOnline()) return 'online'
  if (mode === 'online') {
    editor.toast('info', '인터넷에 연결되어 있지 않아 최신 모델을 쓸 수 없습니다. 필터 ▸ 배경 제거에서 내장 모델을 고르세요.')
    return null
  }
  return 'offline'
}

/** 선택 ▸ 피사체 — 보이는 그림에서 AI 로 주인공을 찾아 선택 영역으로 (포토샵 Select Subject) */
export async function selectSubject(): Promise<void> {
  const d = doc()
  if (!d) return
  const at = capture()
  if (!at) return
  const engine = await pickEngine()
  if (!engine) return
  await editor.busy('피사체 찾는 중…', async () => {
    const flat = mergedBitmap(d)
    const { subjectMask } = await import('./bgremove')
    const mask = await subjectMask(flat, { refine: 8, shift: 0, contrast: 30 }, { engine }, (label, value) => editor.set({ progress: { label, value } }), at.signal).catch((e) => {
      if (at.signal.aborted) return null
      throw e
    })
    if (!mask) return
    const sel = makeSelection(d.width, d.height, mask)
    if (!sel?.bounds) return editor.toast('info', '피사체를 찾지 못했습니다.')
    // 선택만 바꾸는 결과라 그사이 픽셀 편집이 있었어도 그 탭의 지금 문서에 얹는다 (크기가 같을 때만)
    const cur = currentDoc(at)
    if (!cur || cur.width !== d.width || cur.height !== d.height) return
    land({ ...at, revision: editor.revisionOf(at.tabId)! }, { ...cur, selection: sel }, '피사체 선택')
  })
}

// ── 레이어 ──
export function newLayer(): void {
  const d = doc()
  if (d) editor.commit(addBlankLayer(d), '새 레이어')
}
export function newAdjustmentLayer(kind: AdjustmentKind): void {
  const d = doc()
  if (!d) return
  const label = ADJUSTMENT_KINDS.find((k) => k.key === kind)?.label ?? '조정'
  const next = addAdjustmentLayer(d, kind, label)
  editor.commit(next, `${label} 조정 레이어`)
  const tab = kind === 'curves' ? 'curves' : kind === 'hueSaturation' ? 'hsl' : kind === 'exposure' ? 'exposure' : kind === 'levels' ? 'levels' : 'effects'
  if (kind !== 'invert') editor.set({ dialog: { kind: 'adjust', tab, layerId: next.activeId! } })
}
export function duplicate(): void {
  const d = doc()
  const ids = editor.state.selectedIds
  if (d && ids.length) editor.commit(duplicateLayers(d, ids), '레이어 복제')
}
export function deleteLayers(): void {
  const d = doc()
  const ids = editor.state.selectedIds
  if (d && ids.length) editor.commit(removeLayers(d, ids), '레이어 삭제')
}
export function group(): void {
  const d = doc()
  const ids = editor.state.selectedIds
  if (d && ids.length) editor.commit(groupLayers(d, ids), '그룹 만들기')
}
export function ungroupCmd(): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (d && l?.kind === 'group') editor.commit(ungroup(d, l.id), '그룹 해제')
}
export function mergeDownCmd(): void {
  const d = doc()
  if (!d?.activeId) return
  const ids = editor.state.selectedIds
  if (ids.length > 1) editor.commit(mergeLayers(d, ids), '레이어 병합')
  else editor.commit(mergeDown(d, d.activeId), '아래 레이어와 병합')
}
export function mergeVisible(): void {
  const d = doc()
  if (!d) return
  const ids = d.layers.filter((l) => !l.parentId && isEffectivelyVisible(d, l.id)).map((l) => l.id)
  if (ids.length > 1) editor.commit(mergeLayers(d, ids, '병합됨'), '보이는 레이어 병합')
}
export function flatten(): void {
  const d = doc()
  if (d) editor.commit(flattenImage(d), '이미지 병합')
}
export function arrange(by: 1 | -1): void {
  const d = doc()
  if (d?.activeId) editor.commit(moveLayerBy(d, d.activeId, by), by > 0 ? '앞으로 가져오기' : '뒤로 보내기')
}
export function toggleClip(): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (d && l) editor.commit(updateLayer(d, l.id, { clip: !l.clip }), l.clip ? '클리핑 해제' : '클리핑 마스크')
}
/** 마스크 추가 — 선택이 있으면 선택 영역만 보이게 (Compositor Reveal Selection) */
export function addMask(hideAll = false): void {
  const d = doc()
  if (!d) return
  const l = getLayer(d, d.activeId)
  if (!l) return editor.toast('info', '마스크를 추가할 레이어를 고르세요.')
  if (l.mask) {
    editor.set({ maskEditing: true })
    return
  }
  let base = d
  let w = d.width
  let h = d.height
  let ox = 0
  let oy = 0
  if (l.bitmap) {
    base = bakeLayer(d, l.id)
    const b = getLayer(base, l.id)!
    w = b.bitmap!.width
    h = b.bitmap!.height
    ox = Math.round(b.transform.x)
    oy = Math.round(b.transform.y)
  }
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = hideAll ? 0 : d.selection ? Math.round(selWeight(d, x + ox, y + oy) * 255) : 255
      const o = (y * w + x) * 4
      data[o] = data[o + 1] = data[o + 2] = v
      data[o + 3] = 255
    }
  editor.commit(updateLayer({ ...base, selection: null }, l.id, { mask: { bitmap: { width: w, height: h, data }, enabled: true, linked: true } }), '레이어 마스크 추가')
  editor.set({ maskEditing: true })
}
export function deleteMask(apply: boolean): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (!d || !l?.mask) return
  if (apply && l.bitmap) {
    const baked = bakeLayer(d, l.id)
    const b = getLayer(baked, l.id)!
    const px = b.bitmap!.data.slice()
    const m = b.mask!.bitmap.data
    for (let i = 3; i < px.length; i += 4) px[i] = (px[i] * m[i - 3]) / 255
    editor.commit(updateLayer(baked, l.id, { bitmap: { ...b.bitmap!, data: px }, mask: null }), '마스크 적용')
  } else editor.commit(updateLayer(d, l.id, { mask: null }), '마스크 삭제')
  editor.set({ maskEditing: false })
}
export function toggleMaskEnabled(): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (d && l?.mask) editor.commit(updateLayer(d, l.id, { mask: { ...l.mask, enabled: !l.mask.enabled } }), l.mask.enabled ? '마스크 끄기' : '마스크 켜기')
}
/** 마스크 반전 — 가린 곳과 보이는 곳을 맞바꾼다 */
export function invertMask(): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (!d || !l?.mask) return
  editor.commit(
    editPixels(d, l.id, 'mask', undefined, (px) => {
      for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255 - px[i]
    }),
    '마스크 반전'
  )
}
/** 마스크 페더 — 마스크 경계를 가우시안으로 부드럽게 (Compositor Mask ▸ Feather). 선택이 있으면 선택 안에서만 */
export function featherMask(radius: number): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (!d || !l?.mask || radius <= 0) return
  editor.commit(
    editPixels(d, l.id, 'mask', undefined, (px, w, h) => {
      const blurred = gaussianBlur(px, w, h, radius / 2)
      for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = blurred[i]
    }),
    '마스크 페더'
  )
}

/** 문자·도형 레이어 → 일반 픽셀 레이어 (래스터화) */
export function rasterizeText(): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (d && l?.kind === 'text') editor.commit(updateLayer(d, l.id, { kind: 'pixel', text: null }), '문자 래스터화')
  else if (d && l?.shape) editor.commit(updateLayer(d, l.id, { shape: undefined }), '도형 래스터화')
}

// ── 파일·탭 ──
/** 탭 닫기 — 바뀐 게 있으면 저장 확인 */
export function requestCloseTab(id = editor.state.activeTabId): void {
  const t = editor.state.tabs.find((x) => x.id === id)
  if (!t) return
  if (editor.isDirty(t)) editor.set({ dialog: { kind: 'confirmClose', tabIds: [t.id], quit: false } })
  else editor.closeTab(t.id)
}
/** 앱 종료 요청 (창 닫기 버튼·Alt+F4) — 저장 안 한 문서가 있으면 묻는다 */
export function requestQuit(): void {
  const dirty = editor.state.tabs.filter((t) => editor.isDirty(t)).map((t) => t.id)
  if (dirty.length) editor.set({ dialog: { kind: 'confirmClose', tabIds: dirty, quit: true } })
  else
    void import('./autosave').then(async (m) => {
      await m.clearSessionRecovery()
      void window.api.win.confirmClose()
    })
}
export async function importDialog(): Promise<void> {
  const { importAsLayer } = await import('./io')
  const files = await window.api.open('image')
  for (const f of files) await editor.busy(`${f.name} 가져오는 중…`, () => importAsLayer(f.bytes, f.name))
}

// ── 정렬·분포 (포토샵 이동 도구 옵션) ──
type Edge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

/** 움직일 레이어들 (폴더면 자손 픽셀 레이어까지) + 각자의 문서 경계 */
function alignTargets(d: Doc): { ids: string[]; box: { x: number; y: number; w: number; h: number } }[] {
  const out: { ids: string[]; box: { x: number; y: number; w: number; h: number } }[] = []
  for (const id of editor.state.selectedIds) {
    const l = getLayer(d, id)
    if (!l || l.kind === 'adjustment' || l.lock?.position) continue
    const members = l.kind === 'group' ? d.layers.filter((k) => k.bitmap && isDescendant(d, k.id, l.id)) : l.bitmap ? [l] : []
    if (!members.length) continue
    const bs = members.map((k) => transformBounds(k.transform))
    const x0 = Math.min(...bs.map((b) => b.x))
    const y0 = Math.min(...bs.map((b) => b.y))
    const x1 = Math.max(...bs.map((b) => b.x + b.w))
    const y1 = Math.max(...bs.map((b) => b.y + b.h))
    out.push({ ids: members.map((k) => k.id), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } })
  }
  return out
}
function isDescendant(d: Doc, id: string, ancestor: string): boolean {
  let p = getLayer(d, id)?.parentId ?? null
  while (p) {
    if (p === ancestor) return true
    p = getLayer(d, p)?.parentId ?? null
  }
  return false
}
function shiftAll(d: Doc, ids: string[], dx: number, dy: number): Doc {
  let out = d
  for (const id of ids) {
    const l = getLayer(out, id)!
    out = updateLayer(out, id, { transform: { ...l.transform, x: Math.round(l.transform.x + dx), y: Math.round(l.transform.y + dy) } })
  }
  return out
}

/** 정렬 — 기준: 선택 영역 › (레이어 하나면) 캔버스 › 고른 레이어들 전체 경계 */
export function alignLayers(edge: Edge): void {
  const d = doc()
  if (!d) return
  const ts = alignTargets(d)
  if (!ts.length) return editor.toast('info', '정렬할 레이어를 고르세요. (Ctrl+클릭으로 여러 장)')
  const ref =
    d.selection?.bounds ??
    (ts.length === 1
      ? { x: 0, y: 0, w: d.width, h: d.height }
      : (() => {
          const x0 = Math.min(...ts.map((t) => t.box.x))
          const y0 = Math.min(...ts.map((t) => t.box.y))
          return { x: x0, y: y0, w: Math.max(...ts.map((t) => t.box.x + t.box.w)) - x0, h: Math.max(...ts.map((t) => t.box.y + t.box.h)) - y0 }
        })())
  let out = d
  for (const t of ts) {
    const b = t.box
    const dx = edge === 'left' ? ref.x - b.x : edge === 'hcenter' ? ref.x + ref.w / 2 - (b.x + b.w / 2) : edge === 'right' ? ref.x + ref.w - (b.x + b.w) : 0
    const dy = edge === 'top' ? ref.y - b.y : edge === 'vcenter' ? ref.y + ref.h / 2 - (b.y + b.h / 2) : edge === 'bottom' ? ref.y + ref.h - (b.y + b.h) : 0
    out = shiftAll(out, t.ids, dx, dy)
  }
  editor.commit(out, '정렬')
}

/** 분포 — 3장 이상을 가운데 간격이 고르게 (양 끝 레이어는 그대로) */
export function distributeLayers(axis: 'h' | 'v'): void {
  const d = doc()
  if (!d) return
  const ts = alignTargets(d)
  if (ts.length < 3) return editor.toast('info', '분포는 레이어를 3장 이상 골라야 합니다.')
  const c = (t: (typeof ts)[number]): number => (axis === 'h' ? t.box.x + t.box.w / 2 : t.box.y + t.box.h / 2)
  const sorted = [...ts].sort((a, b) => c(a) - c(b))
  const first = c(sorted[0])
  const step = (c(sorted[sorted.length - 1]) - first) / (sorted.length - 1)
  let out = d
  sorted.forEach((t, i) => {
    const want = first + step * i
    out = shiftAll(out, t.ids, axis === 'h' ? want - c(t) : 0, axis === 'v' ? want - c(t) : 0)
  })
  editor.commit(out, '분포')
}

// ── 레이어 스타일 복사·붙여넣기 (포토샵 Copy/Paste Layer Style) ──
let styleClip: { effects: Layer['effects'] } | null = null
export const hasStyleClip = (): boolean => !!styleClip
export function copyLayerStyle(): void {
  const d = doc()
  const l = d && getLayer(d, d.activeId)
  if (!l?.effects) return editor.toast('info', '복사할 레이어 효과가 없습니다.')
  styleClip = { effects: JSON.parse(JSON.stringify(l.effects)) }
  editor.toast('ok', `"${l.name}" 의 레이어 효과를 복사했습니다.`)
  editor.requestRender()
}
export function pasteLayerStyle(): void {
  const d = doc()
  if (!d || !styleClip) return
  let out = d
  for (const id of editor.state.selectedIds) {
    const l = getLayer(out, id)
    if (l && (l.kind === 'pixel' || l.kind === 'text')) out = updateLayer(out, id, { effects: JSON.parse(JSON.stringify(styleClip.effects)) })
  }
  if (out !== d) editor.commit(out, '레이어 효과 붙여넣기')
}
export function clearLayerStyle(): void {
  const d = doc()
  if (!d) return
  let out = d
  for (const id of editor.state.selectedIds) if (getLayer(out, id)?.effects) out = updateLayer(out, id, { effects: null })
  if (out !== d) editor.commit(out, '레이어 효과 지우기')
}
