/**
 * 문서 명령 공통 계약 (UI 독립) — 입력 검증 → 새 Doc. 활성 탭·React·window.api·대화상자를 모른다.
 * 데스크톱 편집기(`editor/commandBridge.ts`)와 서버(`service.ts`)가 같은 명령을 부른다 → UI 와 외부 호출의 결과가 같다.
 *
 * 좌표·크기는 문서 픽셀, 원점은 왼쪽 위. 색은 스트레이트 알파 RGBA. 보간은 CPU 합성과 같은 양선형(크게 줄이면 2배씩 먼저 축소).
 * 난수를 쓰는 명령(노이즈)은 seed 를 입력으로 받고 결과 요약에 남긴다.
 */
import type { Doc, Layer, Bitmap } from '../../core/doc/types'
import { getLayer } from '../../core/doc/ops'
import { CommandError, invalid, unsupported } from '../errors'
import { str, type Obj } from '../validate'

export interface CommandOutput {
  doc: Doc
  /** 실행취소 이력 이름 */
  label: string
  /** 사람이 읽을 변경 요약 */
  summary: string
  warnings: string[]
}

/** 명령이 문서 밖 자원을 읽을 때 (업로드한 그림을 레이어로) — 서비스가 넣어 준다. 일꾼 스레드에서는 없다 */
export interface CommandContext {
  loadImage?(assetId: string): { bitmap: Bitmap; name: string }
}

export interface DocCommand<I> {
  name: string
  /** 입력을 검사해 명령 입력으로 (문서를 보지 않는 검사) */
  parse(raw: unknown): I
  /** 문서에 적용 (문서에 따른 검사 포함). 입력 doc 을 바꾸지 않는다 */
  run(doc: Doc, input: I, ctx?: CommandContext): CommandOutput
  /** CPU·메모리를 크게 쓸 수 있는 명령 — 서버는 격리된 작업 실행기로 보낸다 */
  heavy?: boolean
  /** 결과 문서 크기를 계산 전에 알 수 있으면 (서버가 픽셀 한도를 미리 검사) */
  resultSize?(input: I): { width: number; height: number }
}

export const requireLayer = (doc: Doc, layerId: string): Layer => {
  const l = getLayer(doc, layerId)
  if (!l) throw new CommandError('NOT_FOUND', '레이어를 찾을 수 없습니다.', { layerId })
  return l
}

/** 픽셀을 바꿀 수 있는 레이어 (편집기 `actions.ts pixelLayer` 와 같은 규칙, 오류 코드로 답한다) */
export function pixelLayer(doc: Doc, layerId: string, what = '이 작업'): Layer {
  const l = requireLayer(doc, layerId)
  if (l.kind === 'group' || l.kind === 'adjustment') throw unsupported(`${what}은(는) 픽셀 레이어에만 할 수 있습니다.`)
  if (l.kind === 'text') throw unsupported(`문자 레이어에는 ${what}을(를) 할 수 없습니다. 서버에서는 문자를 래스터화할 수 없습니다.`)
  if (l.lock?.pixels) throw new CommandError('FORBIDDEN', `"${l.name}" 레이어는 픽셀이 잠겨 있습니다.`)
  if (!l.bitmap) throw invalid('빈 레이어입니다.', { layerId })
  return l
}

/** 마스크 편집 대상 (있어야 한다) */
export function maskLayer(doc: Doc, layerId: string): Layer & { mask: NonNullable<Layer['mask']> } {
  const l = requireLayer(doc, layerId)
  if (!l.mask) throw invalid(`"${l.name}" 레이어에는 마스크가 없습니다.`, { layerId })
  return l as Layer & { mask: NonNullable<Layer['mask']> }
}

/** 여러 레이어 ID (1개 이상, 중복 없이) */
export function layerIds(o: Obj, key = 'layerIds'): string[] {
  const v = o[key]
  if (!Array.isArray(v) || !v.length || v.length > 256) throw invalid(`${key}는 레이어 ID 1~256개의 배열이어야 합니다.`, { field: key })
  const out = v.map((x) => {
    if (typeof x !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(x)) throw invalid(`${key}에 올바르지 않은 ID 가 있습니다.`, { field: key })
    return x
  })
  if (new Set(out).size !== out.length) throw invalid(`${key}에 같은 ID 가 두 번 있습니다.`, { field: key })
  return out
}

/** "#rrggbb" 필수 */
export function colorOf(o: Obj, key: string, fallback?: string): [number, number, number] {
  const v = str(o, key, 7, fallback)
  if (v === undefined || !/^#[0-9a-fA-F]{6}$/.test(v)) throw invalid(`${key}는 #rrggbb 형식이어야 합니다.`, { field: key })
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]
}

export type Pt = { x: number; y: number; pressure?: number }
/** 점 목록 (문서 px) — 상한을 둔다 (한 획을 한 요청으로) */
export function points(o: Obj, key: string, min: number, max = 5000, withPressure = false): Pt[] {
  const v = o[key]
  if (!Array.isArray(v) || v.length < min || v.length > max) throw invalid(`${key}는 점 ${min}~${max}개의 배열이어야 합니다.`, { field: key })
  return v.map((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.x !== 'number' || typeof p.y !== 'number' || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw invalid(`${key}[${i}]는 {x, y} 여야 합니다.`, { field: key })
    if (Math.abs(p.x) > 1e6 || Math.abs(p.y) > 1e6) throw invalid(`${key}[${i}] 좌표가 너무 큽니다.`, { field: key })
    const out: Pt = { x: p.x, y: p.y }
    if (withPressure && p.pressure !== undefined) {
      if (typeof p.pressure !== 'number' || p.pressure < 0 || p.pressure > 1) throw invalid(`${key}[${i}].pressure 는 0~1 이어야 합니다.`, { field: key })
      out.pressure = p.pressure
    }
    return out
  })
}
