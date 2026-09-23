/**
 * 런타임 공통 코덱 — 순수 TS(core/png·project)만 쓴다. 브라우저 디코더·Canvas 가 필요한 형식(JPEG·HEIC·PSD 문자)은 여기 없다.
 * 서버 초기 범위: PNG 가져오기, PNG·.shcomp 내보내기 (plans/0004 §3). 나머지는 UNSUPPORTED_CAPABILITY 로 거절한다.
 */
import type { Doc } from '../core/doc/types'
import { decodePng, encodePng, isPng } from '../core/png'
import { docFromBitmap } from '../core/doc/ops'
import { flattenDoc } from '../core/doc/render'
import { packProject } from '../core/doc/project'
import { MAX_SIDE } from '../core/limits'
import { limit, unsupported, invalid } from './errors'

export const IMPORT_FORMATS = ['png'] as const
export const EXPORT_FORMATS = ['png', 'shcomp'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]
export const MEDIA_TYPES: Record<ExportFormat, string> = { png: 'image/png', shcomp: 'application/zip' }

/** 압축을 풀기 전에 IHDR 로 크기만 본다 — 디코딩 픽셀 수 한도는 파일 크기와 별개 (작은 파일이 거대한 그림일 수 있다) */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  if (!isPng(bytes) || bytes.length < 33) throw invalid('PNG 파일이 아닙니다.')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: dv.getUint32(16), height: dv.getUint32(20) }
}

export function importImage(bytes: Uint8Array, name: string, maxPixels: number): Doc {
  if (!isPng(bytes)) throw unsupported('지금은 PNG 만 가져올 수 있습니다.')
  const { width, height } = pngSize(bytes)
  if (width < 1 || height < 1) throw invalid('PNG 크기가 올바르지 않습니다.')
  if (width > MAX_SIDE || height > MAX_SIDE) throw limit(`한 변이 ${MAX_SIDE.toLocaleString()}픽셀을 넘을 수 없습니다 (${width}×${height}).`, { width, height, maxSide: MAX_SIDE })
  if (width * height > maxPixels) throw limit(`그림이 너무 큽니다 (${width}×${height}, 한도 ${maxPixels.toLocaleString()}픽셀).`, { width, height, maxPixels })
  let png: ReturnType<typeof decodePng>
  try {
    png = decodePng(bytes)
  } catch (e) {
    // 디코더 문구는 사용자 입력 설명이라 그대로 알려도 된다 (경로·내부 정보 없음)
    throw invalid(e instanceof Error ? e.message : 'PNG 를 읽지 못했습니다.')
  }
  return docFromBitmap({ width: png.width, height: png.height, data: png.data }, name, png.dpi ?? 72)
}

export function exportDoc(doc: Doc, format: ExportFormat): { bytes: Uint8Array; mediaType: string } {
  if (format === 'png') {
    const flat = flattenDoc(doc)
    return { bytes: encodePng(flat.width, flat.height, flat.data, doc.resolution), mediaType: MEDIA_TYPES.png }
  }
  return { bytes: packProject({ ...doc, selection: null }), mediaType: MEDIA_TYPES.shcomp }
}
