/**
 * 입력 검증 — 외부(MCP·HTTP)에서 온 값은 스키마 안내와 별개로 여기서 다시 검사한다 (annotations·클라이언트 검증을 믿지 않는다).
 * 작은 손수 검사기: application 은 브라우저·Node 양쪽에서 돌아야 해서 런타임 의존성을 두지 않는다.
 */
import { invalid } from './errors'

export type Obj = Record<string, unknown>

export function object(raw: unknown, what = '입력'): Obj {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid(`${what}은(는) 객체여야 합니다.`)
  return raw as Obj
}

/** 허용하지 않은 키가 있으면 거절 — 오타난 매개변수가 조용히 무시되지 않게 */
export function onlyKeys(o: Obj, keys: readonly string[], what = '입력'): void {
  const extra = Object.keys(o).filter((k) => !keys.includes(k))
  if (extra.length) throw invalid(`${what}에 알 수 없는 항목이 있습니다: ${extra.join(', ')}`, { unknown: extra })
}

export function int(o: Obj, key: string, min: number, max: number): number
export function int(o: Obj, key: string, min: number, max: number, fallback: number | undefined): number | undefined
export function int(o: Obj, key: string, min: number, max: number, ...rest: [number | undefined] | []): number | undefined {
  const v = o[key]
  if (v === undefined && rest.length) return rest[0]
  if (typeof v !== 'number' || !Number.isInteger(v)) throw invalid(`${key}는 정수여야 합니다.`, { field: key })
  if (v < min || v > max) throw invalid(`${key}는 ${min}~${max} 사이여야 합니다.`, { field: key, min, max })
  return v
}

export function num(o: Obj, key: string, min: number, max: number): number
export function num(o: Obj, key: string, min: number, max: number, fallback: number | undefined): number | undefined
export function num(o: Obj, key: string, min: number, max: number, ...rest: [number | undefined] | []): number | undefined {
  const v = o[key]
  if (v === undefined && rest.length) return rest[0]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(`${key}는 숫자여야 합니다.`, { field: key })
  if (v < min || v > max) throw invalid(`${key}는 ${min}~${max} 사이여야 합니다.`, { field: key, min, max })
  return v
}

export function bool(o: Obj, key: string): boolean
export function bool(o: Obj, key: string, fallback: boolean | undefined): boolean | undefined
export function bool(o: Obj, key: string, ...rest: [boolean | undefined] | []): boolean | undefined {
  const v = o[key]
  if (v === undefined && rest.length) return rest[0]
  if (typeof v !== 'boolean') throw invalid(`${key}는 true 또는 false 여야 합니다.`, { field: key })
  return v
}

export function str(o: Obj, key: string, maxLength: number): string
export function str(o: Obj, key: string, maxLength: number, fallback: string | undefined): string | undefined
export function str(o: Obj, key: string, maxLength: number, ...rest: [string | undefined] | []): string | undefined {
  const v = o[key]
  if (v === undefined && rest.length) return rest[0]
  if (typeof v !== 'string') throw invalid(`${key}는 문자열이어야 합니다.`, { field: key })
  if (v.length > maxLength) throw invalid(`${key}는 ${maxLength}자 이하여야 합니다.`, { field: key, maxLength })
  // 제어 문자는 이름·ID 에 쓰지 않는다
  if (/[\u0000-\u001f\u007f]/.test(v)) throw invalid(`${key}에 제어 문자를 쓸 수 없습니다.`, { field: key })
  return v
}

export function oneOf<T extends string>(o: Obj, key: string, values: readonly T[]): T
export function oneOf<T extends string>(o: Obj, key: string, values: readonly T[], fallback: T | undefined): T | undefined
export function oneOf<T extends string>(o: Obj, key: string, values: readonly T[], ...rest: [T | undefined] | []): T | undefined {
  const v = o[key]
  if (v === undefined && rest.length) return rest[0]
  if (typeof v !== 'string' || !values.includes(v as T)) throw invalid(`${key}는 ${values.join(', ')} 중 하나여야 합니다.`, { field: key, allowed: values })
  return v as T
}

/** 식별자 (문서·레이어·자산·작업·operationId) — 짧은 안전 문자만 */
export function id(o: Obj, key: string): string {
  const v = str(o, key, 128)
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(v)) throw invalid(`${key} 형식이 올바르지 않습니다.`, { field: key })
  return v
}

/** "#rrggbb" → [r,g,b] */
export function hex(o: Obj, key: string): [number, number, number] | undefined {
  const v = o[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw invalid(`${key}는 #rrggbb 형식이어야 합니다.`, { field: key })
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]
}
