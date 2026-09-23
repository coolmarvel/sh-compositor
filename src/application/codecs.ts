/**
 * 런타임 공통 코덱 — 순수 TS(core/png·project·psd)만 쓴다. 브라우저 디코더·Canvas 가 필요한 형식(JPEG·WebP·HEIC·TIFF)은 여기 없다.
 * 가져오기: PNG·PSD·.shcomp. 내보내기: PNG(합성)·.shcomp(레이어)·PSD(레이어). 나머지는 UNSUPPORTED_CAPABILITY.
 * PSD 의 문자 레이어는 픽셀로만 오간다 (서버에 글꼴·캔버스가 없다).
 */
import type { Doc, Bitmap } from '../core/doc/types'
import { decodePng, encodePng, isPng } from '../core/png'
import { docFromBitmap } from '../core/doc/ops'
import { flattenDoc } from '../core/doc/render'
import { packProject, unpackProject } from '../core/doc/project'
import { psdToDoc, docToPsd, isPsd } from '../core/doc/psd'
import { MAX_SIDE } from '../core/limits'
import { limit, unsupported, invalid } from './errors'

export const IMPORT_FORMATS = ['png', 'psd', 'shcomp'] as const
export const EXPORT_FORMATS = ['png', 'shcomp', 'psd'] as const
export type ImportFormat = (typeof IMPORT_FORMATS)[number]
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export const MEDIA_TYPES: Record<ExportFormat, string> = { png: 'image/png', shcomp: 'application/zip', psd: 'image/vnd.adobe.photoshop' }

const isZip = (b: Uint8Array): boolean => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5 || b[2] === 7)

/** 내용으로 형식 판정 (선언한 Content-Type 을 믿지 않는다). 모르면 null */
export function sniff(bytes: Uint8Array): ImportFormat | null {
  if (isPng(bytes)) return 'png'
  if (isPsd(bytes)) return 'psd'
  if (isZip(bytes)) return 'shcomp'
  return null
}

/** 압축을 풀기 전에 IHDR 로 크기만 본다 — 디코딩 픽셀 수 한도는 파일 크기와 별개 (작은 파일이 거대한 그림일 수 있다) */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (!isPng(bytes) || bytes.length < 33) throw invalid('PNG 파일이 아닙니다.')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

/** 업로드 검사 — 형식과 (PNG 는) 크기 헤더 */
export function inspectUpload(bytes: Uint8Array): { format: ImportFormat; mediaType: string } {
  const format = sniff(bytes)
  if (!format) throw unsupported('PNG·PSD·.shcomp 만 올릴 수 있습니다.')
  if (format === 'png') pngSize(bytes)
  return { format, mediaType: MEDIA_TYPES[format] }
}

export function importBitmap(bytes: Uint8Array, maxPixels: number): Bitmap {
  if (!isPng(bytes)) throw unsupported('레이어로 넣을 그림은 PNG 만 됩니다.')
  const png = decodePngChecked(bytes, maxPixels)
  return { width: png.width, height: png.height, data: png.data }
}

export function importDocument(bytes: Uint8Array, name: string, maxPixels: number): { doc: Doc; warnings: string[] } {
  const format = sniff(bytes)
  if (format === 'png') {
    const png = decodePngChecked(bytes, maxPixels)
    return { doc: docFromBitmap({ width: png.width, height: png.height, data: png.data }, name, png.dpi ?? 72), warnings: [] }
  }
  if (format === 'psd') {
    try {
      const r = psdToDoc(bytes, name)
      return { doc: r.doc, warnings: r.warnings }
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : 'PSD 를 읽지 못했습니다.')
    }
  }
  if (format === 'shcomp') {
    try {
      return { doc: unpackProject(bytes), warnings: [] }
    } catch (e) {
      throw invalid(e instanceof Error ? e.message : '프로젝트 파일을 읽지 못했습니다.')
    }
  }
  throw unsupported('PNG·PSD·.shcomp 만 가져올 수 있습니다.')
}
function decodePngChecked(bytes: Uint8Array, maxPixels: number): ReturnType<typeof decodePng> {
  checkPngSize(bytes, maxPixels)
  try {
    return decodePng(bytes)
  } catch (e) {
    throw invalid(e instanceof Error ? e.message : 'PNG 를 읽지 못했습니다.')
  }
}
function checkPngSize(bytes: Uint8Array, maxPixels: number): void {
  const { width, height } = pngSize(bytes)
  if (width < 1 || height < 1) throw invalid('PNG 크기가 올바르지 않습니다.')
  if (width > MAX_SIDE || height > MAX_SIDE) throw limit(`한 변이 ${MAX_SIDE.toLocaleString()}픽셀을 넘을 수 없습니다 (${width}×${height}).`, { width, height, maxSide: MAX_SIDE })
  if (width * height > maxPixels) throw limit(`그림이 너무 큽니다 (${width}×${height}, 한도 ${maxPixels.toLocaleString()}픽셀).`, { width, height, maxPixels })
}

export function exportDoc(doc: Doc, format: ExportFormat): { bytes: Uint8Array; mediaType: string; warnings: string[] } {
  if (format === 'png') {
    const flat = flattenDoc(doc)
    return { bytes: encodePng(flat.width, flat.height, flat.data, doc.resolution), mediaType: MEDIA_TYPES.png, warnings: [] }
  }
  if (format === 'psd') {
    const r = docToPsd({ ...doc, selection: null })
    return { bytes: r.bytes, mediaType: MEDIA_TYPES.psd, warnings: r.warnings }
  }
  return { bytes: packProject({ ...doc, selection: null }), mediaType: MEDIA_TYPES.shcomp, warnings: [] }
}
