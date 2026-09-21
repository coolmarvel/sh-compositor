/**
 * 파일 입출력 — 열기(프로젝트·이미지·HEIC·TIFF)·저장·내보내기·클립보드.
 * Compositor `ProjectController`·`ImageImporter`·`ImageExporter` 에 해당.
 */
import { editor } from './store'
import {
  deserializeDoc,
  docFromBitmap,
  unpackProject,
  packProject,
  flattenDoc,
  encodePng,
  decodePng,
  isPng,
  makeLayer,
  insertLayer,
  identityTransform,
  cropBitmap,
  type Bitmap,
  type Doc
} from '@core/index'

const stripExt = (n: string): string => n.replace(/\.[^.]+$/, '')

/** 이미지 바이트 → 비트맵 (PNG 는 순수 디코더, 나머지는 브라우저 디코더 · HEIC/TIFF 는 라이브러리) */
export async function decodeImage(bytes: Uint8Array, name: string): Promise<{ bitmap: Bitmap; dpi: number | null }> {
  if (isPng(bytes)) {
    const p = decodePng(bytes)
    return { bitmap: { width: p.width, height: p.height, data: p.data }, dpi: p.dpi }
  }
  let blob = new Blob([bytes as unknown as BlobPart])
  const lower = name.toLowerCase()
  if (/\.(heic|heif)$/.test(lower) || isHeic(bytes)) {
    const { default: heic2any } = await import('heic2any')
    blob = (await heic2any({ blob, toType: 'image/png' })) as Blob
  } else if (/\.tiff?$/.test(lower) || isTiff(bytes)) {
    const UTIF = await import('utif2')
    const ifds = UTIF.decode(bytes.buffer as ArrayBuffer)
    UTIF.decodeImage(bytes.buffer as ArrayBuffer, ifds[0])
    const rgba = UTIF.toRGBA8(ifds[0])
    return { bitmap: { width: ifds[0].width, height: ifds[0].height, data: new Uint8ClampedArray(rgba.buffer.slice(0)) }, dpi: null }
  }
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' })
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(bmp, 0, 0)
  const data = x.getImageData(0, 0, bmp.width, bmp.height).data
  bmp.close()
  return { bitmap: { width: c.width, height: c.height, data }, dpi: null }
}

const isHeic = (b: Uint8Array): boolean => b.length > 12 && String.fromCharCode(...b.subarray(4, 12)).match(/ftyp(heic|heix|mif1|msf1|hevc)/) !== null
const isTiff = (b: Uint8Array): boolean => b.length > 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42))

/** 파일 하나 열기 — .shcomp 면 프로젝트, 아니면 이미지 한 장짜리 새 문서 */
export async function openBytes(name: string, bytes: Uint8Array, path: string | null): Promise<void> {
  if (/\.shcomp$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const doc = unpackProject(bytes)
    editor.addTab(doc, stripExt(name), path)
    return
  }
  const { bitmap, dpi } = await decodeImage(bytes, name)
  editor.addTab(docFromBitmap(bitmap, stripExt(name), dpi ?? 72), stripExt(name), null)
}

export async function openDialog(): Promise<void> {
  const files = await window.api.open('any')
  for (const f of files) {
    await editor.busy(`${f.name} 여는 중…`, () => openBytes(f.name, f.bytes, /\.shcomp$/i.test(f.name) ? f.path : null))
    addRecent(f.path)
  }
}

export async function openPaths(paths: string[]): Promise<void> {
  for (const p of paths) {
    const ok = await editor.busy(`${p.split(/[\\/]/).pop()} 여는 중…`, async () => {
      if (/\.comp[\\/]?$/i.test(p)) return openCompFolder(p)
      const f = await window.api.read(p)
      await openBytes(f.name, f.bytes, /\.shcomp$/i.test(f.name) ? f.path : null)
      return true
    })
    if (ok) addRecent(p)
    else removeRecent(p)
  }
}

/** Compositor .comp 프로젝트 폴더 열기 (형식 호환 — manifest.json + images/) */
export async function openCompFolder(path?: string): Promise<boolean> {
  const r = await window.api.openCompFolder(path)
  if (!r) return false
  const doc = deserializeDoc(r.files)
  // .comp 는 다른 앱 형식이라 저장 경로로 쓰지 않는다 (저장하면 .shcomp 로)
  editor.addTab(doc, stripExt(r.name), null)
  addRecent(r.path)
  return true
}

// ── 최근 파일 (localStorage — 뷰어별 편의) ──
const RECENT_KEY = 'sc.recent'
export function recentFiles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function writeRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10)))
  } catch {
    /* 무시 */
  }
  editor.requestRender()
}
export function addRecent(path: string | null | undefined): void {
  if (path) writeRecent([path, ...recentFiles().filter((p) => p !== path)])
}
function removeRecent(path: string): void {
  writeRecent(recentFiles().filter((p) => p !== path))
}
export function clearRecent(): void {
  writeRecent([])
}

/** 이미지를 현재 문서에 새 레이어로 (가져오기·드롭·붙여넣기) — 위치 없으면 가운데 */
export async function importAsLayer(bytes: Uint8Array, name: string, at?: { x: number; y: number }): Promise<void> {
  const doc = editor.doc
  if (!doc) return openBytes(name, bytes, null)
  const { bitmap } = await decodeImage(bytes, name)
  const x = at ? Math.round(at.x - bitmap.width / 2) : Math.round((doc.width - bitmap.width) / 2)
  const y = at ? Math.round(at.y - bitmap.height / 2) : Math.round((doc.height - bitmap.height) / 2)
  editor.commit(insertLayer(doc, makeLayer('pixel', stripExt(name), bitmap, identityTransform(bitmap.width, bitmap.height, x, y))), '가져오기')
}

/** 저장 (경로 없으면 다른 이름으로) */
export async function saveProject(asNew = false): Promise<boolean> {
  const tab = editor.tab
  if (!tab) return false
  let path = asNew ? null : tab.path
  if (!path) path = await window.api.saveAs(`${tab.name}.shcomp`, 'project')
  if (!path) return false
  const doc = tab.history.present
  const ok = await editor.busy('저장 중…', async () => {
    await window.api.write(path!, packProject(doc))
    return true
  })
  if (!ok) return false
  const name = stripExt(path.split(/[\\/]/).pop() ?? tab.name)
  editor.markSaved(path, name)
  addRecent(path)
  editor.toast('ok', `저장했습니다: ${path}`)
  return true
}

/** 합성 결과 (선택이 있으면 그 경계로 잘라서) */
export function mergedBitmap(doc: Doc, onlySelection = false): Bitmap {
  const flat = flattenDoc(doc)
  if (onlySelection && doc.selection?.bounds) {
    const b = doc.selection.bounds
    const cut = cropBitmap(flat, b.x, b.y, b.w, b.h)
    // 선택 마스크를 알파에 곱한다
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        const m = doc.selection.mask[(b.y + y) * doc.width + (b.x + x)]
        cut.data[(y * b.w + x) * 4 + 3] = (cut.data[(y * b.w + x) * 4 + 3] * m) / 255
      }
    return cut
  }
  return flat
}

export async function exportPng(): Promise<void> {
  const tab = editor.tab
  if (!tab) return
  const path = await window.api.saveAs(`${tab.name}.png`, 'png')
  if (!path) return
  await editor.busy('PNG 내보내는 중…', async () => {
    const doc = tab.history.present
    const flat = flattenDoc(doc)
    await window.api.write(path, encodePng(flat.width, flat.height, flat.data, doc.resolution))
    editor.toast('ok', `내보냈습니다: ${path}`)
  })
}

/** JPEG 인코딩 (매트 색 위에 평평하게) — 내보내기 대화상자에서 미리보기·저장 공용 */
export async function encodeJpeg(bitmap: Bitmap, quality: number, matte: [number, number, number]): Promise<Uint8Array> {
  return encodeLossy(bitmap, quality, 'image/jpeg', matte)
}

/** WebP 인코딩 (투명 유지) */
export async function encodeWebp(bitmap: Bitmap, quality: number): Promise<Uint8Array> {
  return encodeLossy(bitmap, quality, 'image/webp', null)
}

async function encodeLossy(bitmap: Bitmap, quality: number, type: 'image/jpeg' | 'image/webp', matte: [number, number, number] | null): Promise<Uint8Array> {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height)
  const x = c.getContext('2d')!
  if (matte) {
    x.fillStyle = `rgb(${matte.join(',')})`
    x.fillRect(0, 0, c.width, c.height)
  }
  const tmp = new OffscreenCanvas(bitmap.width, bitmap.height)
  tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bitmap.data), bitmap.width, bitmap.height), 0, 0)
  x.drawImage(tmp, 0, 0)
  const blob = await c.convertToBlob({ type, quality })
  return new Uint8Array(await blob.arrayBuffer())
}

/** 클립보드로 — 병합 복사면 보이는 그대로, 아니면 활성 레이어 (선택이 있으면 선택만) */
export async function copyToClipboard(merged: boolean): Promise<void> {
  const doc = editor.doc
  if (!doc) return
  const bmp = merged ? mergedBitmap(doc, true) : layerSelectionBitmap(doc)
  if (!bmp) return editor.toast('info', '복사할 픽셀이 없습니다.')
  await window.api.clipboard.writeImage(encodePng(bmp.width, bmp.height, bmp.data))
  editor.toast('ok', merged ? '보이는 그대로 복사했습니다.' : '레이어를 복사했습니다.')
}

/** 활성 레이어의 (선택 영역) 픽셀 — 문서 좌표로 래스터화해서 자른다 */
export function layerSelectionBitmap(doc: Doc): Bitmap | null {
  const l = doc.layers.find((x) => x.id === doc.activeId)
  if (!l?.bitmap) return null
  const flat = flattenDoc({ ...doc, layers: [{ ...l, parentId: null, clip: false, visible: true, blend: 'normal', opacity: 1 }] })
  const b = doc.selection?.bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height }
  const cut = cropBitmap(flat, b.x, b.y, b.w, b.h)
  if (doc.selection)
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) cut.data[(y * b.w + x) * 4 + 3] = (cut.data[(y * b.w + x) * 4 + 3] * doc.selection.mask[(b.y + y) * doc.width + (b.x + x)]) / 255
  return cut
}

/** 붙여넣기 — 클립보드 이미지를 새 레이어로 (문서가 없으면 새 문서) */
export async function pasteFromClipboard(): Promise<void> {
  const png = await window.api.clipboard.readImage()
  if (!png) return editor.toast('info', '클립보드에 이미지가 없습니다.')
  const doc = editor.doc
  if (!doc) return openBytes('붙여넣기.png', png, null)
  const at = doc.selection?.bounds ? { x: doc.selection.bounds.x + doc.selection.bounds.w / 2, y: doc.selection.bounds.y + doc.selection.bounds.h / 2 } : undefined
  await importAsLayer(png, '붙여넣기', at)
}
