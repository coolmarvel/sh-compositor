/**
 * 문자 글자별 서식 (순수 TS) — `TextData.runs`: 문자열 구간 [start, end) 마다 굵게·기울임·색·크기·글꼴을 따로 둔다.
 * 구간은 겹치지 않고 start 오름차순. 서식이 없는 글자는 TextData 의 기본값을 쓴다.
 */
export interface TextRun {
  start: number
  end: number
  bold?: boolean
  italic?: boolean
  color?: string
  size?: number
  font?: string
}
export type RunStyle = Omit<TextRun, 'start' | 'end'>
const KEYS: (keyof RunStyle)[] = ['bold', 'italic', 'color', 'size', 'font']

const same = (a: RunStyle, b: RunStyle): boolean => KEYS.every((k) => a[k] === b[k])
const styleOf = (r: TextRun): RunStyle => {
  const s: RunStyle = {}
  for (const k of KEYS) if (r[k] !== undefined) (s as Record<string, unknown>)[k] = r[k]
  return s
}
const empty = (s: RunStyle): boolean => KEYS.every((k) => s[k] === undefined)

/** [start,end) 에 patch 를 덮는다 (undefined 값 = 그 속성을 기본으로 되돌림). 겹치는 구간은 쪼개고 같은 서식은 합친다 */
export function applyRun(runs: TextRun[] | undefined, start: number, end: number, patch: Partial<Record<keyof RunStyle, RunStyle[keyof RunStyle] | undefined>>, length: number): TextRun[] | undefined {
  start = Math.max(0, Math.min(length, start))
  end = Math.max(start, Math.min(length, end))
  if (start === end) return normalize(runs ?? [])
  const pieces: TextRun[] = []
  for (const r of runs ?? []) {
    if (r.end <= start || r.start >= end) pieces.push(r)
    else {
      if (r.start < start) pieces.push({ ...r, end: start })
      if (r.end > end) pieces.push({ ...r, start: end })
    }
  }
  // 새 구간: 원래 그 자리에 있던 서식 위에 patch
  const covered: { s: number; e: number; base: RunStyle }[] = []
  let pos = start
  const inside = (runs ?? []).filter((r) => r.end > start && r.start < end).sort((a, b) => a.start - b.start)
  for (const r of inside) {
    const s = Math.max(start, r.start)
    if (s > pos) covered.push({ s: pos, e: s, base: {} })
    covered.push({ s, e: Math.min(end, r.end), base: styleOf(r) })
    pos = Math.min(end, r.end)
  }
  if (pos < end) covered.push({ s: pos, e: end, base: {} })
  for (const c of covered) {
    const st: RunStyle = { ...c.base }
    for (const k of Object.keys(patch) as (keyof RunStyle)[]) {
      const v = patch[k]
      if (v === undefined) delete st[k]
      else (st as Record<string, unknown>)[k] = v
    }
    if (!empty(st)) pieces.push({ start: c.s, end: c.e, ...st })
  }
  return normalize(pieces)
}

/** 정렬·빈 구간 제거·이웃 같은 서식 합치기. 아무것도 없으면 undefined */
export function normalize(runs: TextRun[]): TextRun[] | undefined {
  const out: TextRun[] = []
  for (const r of [...runs].filter((r) => r.end > r.start && !empty(styleOf(r))).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1]
    if (last && last.end === r.start && same(styleOf(last), styleOf(r))) last.end = r.end
    else out.push({ ...r })
  }
  return out.length ? out : undefined
}

/** 글자를 넣거나 지웠을 때 구간을 따라 옮긴다 (텍스트 편집 중 서식 유지) */
export function shiftRuns(runs: TextRun[] | undefined, at: number, removed: number, inserted: number): TextRun[] | undefined {
  if (!runs) return undefined
  const delta = inserted - removed
  const out: TextRun[] = []
  for (const r of runs) {
    let { start, end } = r
    if (end <= at) out.push(r)
    else if (start >= at + removed) out.push({ ...r, start: start + delta, end: end + delta })
    else {
      // 편집 구간과 겹침: 지운 부분을 빼고 넣은 글자는 앞 구간의 서식을 잇는다
      start = Math.min(start, at)
      end = Math.max(at + inserted, end + delta)
      out.push({ ...r, start, end })
    }
  }
  return normalize(out)
}

/** 텍스트를 구간별 조각으로 (렌더러용): 기본 서식 + 구간 서식 */
export function segments(text: string, runs: TextRun[] | undefined, from: number, to: number): { start: number; end: number; style: RunStyle }[] {
  const out: { start: number; end: number; style: RunStyle }[] = []
  let pos = from
  for (const r of runs ?? []) {
    if (r.end <= from || r.start >= to) continue
    const s = Math.max(from, r.start)
    if (s > pos) out.push({ start: pos, end: s, style: {} })
    out.push({ start: s, end: Math.min(to, r.end), style: styleOf(r) })
    pos = Math.min(to, r.end)
  }
  if (pos < to) out.push({ start: pos, end: to, style: {} })
  void text
  return out
}
