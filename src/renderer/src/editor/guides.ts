/**
 * 안내선 — 눈금자에서 끌어 만들고, 이동 도구(또는 Ctrl)로 끌어 옮기고, 눈금자로 끌어 내면 지운다 (포토샵과 같음).
 * 안내선은 문서에 저장되고 실행취소된다. 이동·자르기·사각 선택이 안내선에 붙는다 (보기 ▸ 안내선에 맞추기).
 */
import { editor } from './store'
import type { Doc, Guides } from '@core/index'

export type Axis = 'v' | 'h'
const EMPTY: Guides = { v: [], h: [] }

export const guidesOf = (d: Doc | null): Guides => d?.guides ?? EMPTY

/** 스냅 대상 (보이고 맞추기가 켜져 있을 때만) */
export function guideSnapTargets(d: Doc): { xs: number[]; ys: number[] } {
  const s = editor.state.settings
  if (!s.showGuides || !s.snapGuides) return { xs: [], ys: [] }
  const g = guidesOf(d)
  return { xs: g.v, ys: g.h }
}

export function addGuide(axis: Axis, pos: number): void {
  const d = editor.doc
  if (!d) return
  const g = guidesOf(d)
  const p = Math.round(pos * 10) / 10
  editor.commit({ ...d, guides: { ...g, [axis]: [...g[axis], p] } }, '안내선 만들기')
  if (!editor.state.settings.showGuides) editor.setSettings({ showGuides: true })
}

export function moveGuide(axis: Axis, index: number, pos: number, gesture: boolean): void {
  const d = editor.doc
  if (!d) return
  const g = guidesOf(d)
  const list = [...g[axis]]
  list[index] = Math.round(pos * 10) / 10
  const next = { ...d, guides: { ...g, [axis]: list } }
  if (gesture) editor.commitGesture(next, '안내선 옮기기')
  else editor.commit(next, '안내선 옮기기')
}

export function removeGuide(axis: Axis, index: number): void {
  const d = editor.doc
  if (!d) return
  const g = guidesOf(d)
  editor.commit({ ...d, guides: { ...g, [axis]: g[axis].filter((_, i) => i !== index) } }, '안내선 지우기')
}

export function clearGuides(): void {
  const d = editor.doc
  if (d?.guides && (d.guides.v.length || d.guides.h.length)) editor.commit({ ...d, guides: { v: [], h: [] } }, '안내선 모두 지우기')
}

/** 화면 좌표 근처(px)의 안내선 */
export function hitGuide(d: Doc, sx: number, sy: number, toScreen: (x: number, y: number) => { x: number; y: number }, r = 4): { axis: Axis; index: number } | null {
  const s = editor.state.settings
  if (!s.showGuides || s.lockGuides) return null
  const g = guidesOf(d)
  for (let i = g.v.length - 1; i >= 0; i--) if (Math.abs(toScreen(g.v[i], 0).x - sx) <= r) return { axis: 'v', index: i }
  for (let i = g.h.length - 1; i >= 0; i--) if (Math.abs(toScreen(0, g.h[i]).y - sy) <= r) return { axis: 'h', index: i }
  return null
}
