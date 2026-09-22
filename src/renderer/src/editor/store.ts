/**
 * 편집기 상태 저장소 — Compositor `EditorSession` + `ProjectWorkspace`(탭) 에 해당.
 *
 * React 상태가 아니라 작은 외부 스토어다: 캔버스 포인터 이벤트(초당 수백 번)가 React 렌더를 거치지 않고,
 * 패널들은 `useEditor(selector)` 로 필요한 조각만 구독한다(useSyncExternalStore).
 * 문서 변경은 전부 `commit(doc, label)` 을 거쳐 실행취소 이력에 쌓인다.
 */
import { useSyncExternalStore } from 'react'
import { startHistory, record, replace, silent, undo as hUndo, redo as hRedo, DEFAULT_BRUSH, type History, type Doc, type BrushSettings, type Anchor, type MoreAdjustKind } from '../../../core/index'
import type { View } from '../gl/GLRenderer'
import { adaptView } from './view'

export type Tool =
  'move' | 'marquee' | 'lasso' | 'wand' | 'objectSelect' | 'crop' | 'brush' | 'spotHealing' | 'cloneStamp' | 'blur' | 'gradient' | 'shape' | 'type' | 'eyedropper' | 'hand' | 'zoom' | 'idle'

export interface Tab {
  id: string
  name: string
  /** 저장된 경로 (.shcomp) — 없으면 새 문서 */
  path: string | null
  history: History
  /** 마지막으로 저장한 문서 (바뀜 표시용) */
  saved: Doc | null
  /** null = 다음 그리기에서 화면에 맞춤 */
  view: View | null
  /** 작업 내역 스냅샷 (이름 붙은 지점 — 실행취소 한도와 상관없이 남는다) */
  snapshots: { id: string; name: string; doc: Doc }[]
}

export interface ToolSettings {
  marqueeKind: 'rect' | 'ellipse'
  lassoKind: 'free' | 'polygon'
  wandTolerance: number
  wandContiguous: boolean
  wandSampleAll: boolean
  /** 개체 선택: 사각형으로 감싸기 / 올가미로 감싸기 */
  objectMode: 'rect' | 'lasso' | 'paint'
  brush: BrushSettings
  brushMode: 'paint' | 'erase'
  blurMode: 'blur' | 'smudge' | 'liquify'
  blurStrength: number
  healMode: 'contentAware' | 'proximity'
  cloneAligned: boolean
  cloneSampleAll: boolean
  gradientShape: 'linear' | 'radial'
  gradientReverse: boolean
  gradientToTransparent: boolean
  shapeKind: 'rect' | 'roundRect' | 'ellipse' | 'line'
  shapeFill: boolean
  shapeStroke: boolean
  shapeStrokeWidth: number
  shapeRadius: number
  typeFont: string
  typeSize: number
  typeBold: boolean
  typeItalic: boolean
  typeAlign: 'left' | 'center' | 'right'
  typeLineHeight: number
  typeTracking: number
  typeVertical: boolean
  cropRatio: string
  cropDelete: boolean
  sampleRing: boolean
  autoSelect: boolean
  showTransformControls: boolean
  // 보기 (눈금자·안내선)
  showRulers: boolean
  showGuides: boolean
  snapGuides: boolean
  lockGuides: boolean
  // 환경 설정
  /** 실행취소 단계 수 */
  historyLimit: number
  /** 자동 저장 간격(분), 0 = 끔 */
  autosaveMinutes: number
  /** 끄는 동안 화면 해상도를 낮춰 빠르게 (느린 PC·GPU 없는 환경) */
  fastInteract: boolean
}

export const DEFAULT_SETTINGS: ToolSettings = {
  marqueeKind: 'rect',
  lassoKind: 'free',
  wandTolerance: 32,
  wandContiguous: true,
  wandSampleAll: false,
  objectMode: 'rect',
  brush: DEFAULT_BRUSH,
  brushMode: 'paint',
  blurMode: 'blur',
  blurStrength: 50,
  healMode: 'contentAware',
  cloneAligned: true,
  cloneSampleAll: false,
  gradientShape: 'linear',
  gradientReverse: false,
  gradientToTransparent: false,
  shapeKind: 'rect',
  shapeFill: true,
  shapeStroke: false,
  shapeStrokeWidth: 4,
  shapeRadius: 16,
  typeFont: 'Malgun Gothic',
  typeSize: 48,
  typeBold: false,
  typeItalic: false,
  typeAlign: 'left',
  typeLineHeight: 1.25,
  typeTracking: 0,
  typeVertical: false,
  cropRatio: 'free',
  cropDelete: false,
  sampleRing: true,
  autoSelect: false,
  showTransformControls: true,
  showRulers: true,
  showGuides: true,
  snapGuides: true,
  lockGuides: false,
  historyLimit: 80,
  autosaveMinutes: 1,
  fastInteract: true
}

export type DialogKind =
  | { kind: 'newCanvas' }
  | { kind: 'imageSize' }
  | { kind: 'canvasSize' }
  | { kind: 'adjust'; tab: 'levels' | 'curves' | 'hsl' | 'exposure' | 'effects'; layerId?: string }
  | { kind: 'filters'; focus?: string }
  | { kind: 'effects'; layerId: string }
  | { kind: 'export'; format: 'jpeg' | 'webp' }
  | { kind: 'recover'; items: { id: string; name: string; path: string | null; savedAt: number }[] }
  | { kind: 'selectAmount'; op: 'expand' | 'contract' | 'feather' | 'maskFeather' | 'smooth' }
  | { kind: 'stroke' }
  | { kind: 'color'; which: 'fg' | 'bg' }
  | { kind: 'rename'; layerId: string }
  | { kind: 'confirmClose'; tabIds: string[]; quit: boolean }
  | { kind: 'about' }
  | { kind: 'help' }
  | { kind: 'removeBg' }
  | { kind: 'newGuide' }
  | { kind: 'preferences' }
  | { kind: 'refineEdge' }
  | { kind: 'moreAdjust'; which: MoreAdjustKind }

export interface EditorState {
  tabs: Tab[]
  activeTabId: string | null
  tool: Tool
  settings: ToolSettings
  fg: [number, number, number]
  bg: [number, number, number]
  /** 레이어 패널에서 여러 개 고른 것 (활성 레이어 포함) */
  selectedIds: string[]
  /** 레이어 대신 마스크를 칠하는 중 */
  maskEditing: boolean
  /** 도구가 진행 중일 때 캔버스가 대신 그리는 문서 (칠하는 중·그라데이션 미리보기) — 이력 밖 */
  preview: Doc | null
  /** preview 를 만들 때의 문서 — 문서가 바뀌면(다른 명령·실행취소) 그 미리보기는 낡은 것이라 그리지 않는다 */
  previewBase: Doc | null
  status: string
  progress: { label: string; value?: number } | null
  toast: { kind: 'ok' | 'err' | 'info'; text: string } | null
  dialog: DialogKind | null
  showGrid: boolean
  layersWidth: number
  /** 도구 헤더 등에서 캔버스를 다시 그려 달라는 신호 */
  renderTick: number
}

/**
 * 문서 크기가 바뀌면(자르기·캔버스 크기·실행취소) 맞춤 상태인 보기를 **바로** 다시 맞춘다.
 * 캔버스의 rAF 그리기를 기다리면 창이 뒤에 있을 때(rAF 멈춤) 클릭 좌표가 옛 보기로 계산된다 (2026-09-21 E2E E3 사고).
 */
function withView(t: Tab): Tab {
  const v = t.view
  if (!v?.fit || v.cw === undefined || v.ch === undefined) return t
  const d = t.history.present
  const nv = adaptView(v, d.width, d.height, v.cw, v.ch)
  return nv === v ? t : { ...t, view: nv }
}

let idSeq = 0
export const tabId = (): string => `t${++idSeq}`

export class EditorStore {
  private listeners = new Set<() => void>()
  state: EditorState = {
    tabs: [],
    activeTabId: null,
    tool: 'move',
    settings: loadSettings(),
    fg: [0, 0, 0],
    bg: [255, 255, 255],
    selectedIds: [],
    maskEditing: false,
    preview: null,
    previewBase: null,
    status: '',
    progress: null,
    toast: null,
    dialog: null,
    showGrid: true,
    layersWidth: loadNumber('sc.layersWidth', 260),
    renderTick: 0
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  get = (): EditorState => this.state

  set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  // ── 탭 ──
  get tab(): Tab | null {
    return this.state.tabs.find((t) => t.id === this.state.activeTabId) ?? null
  }
  get doc(): Doc | null {
    return this.tab?.history.present ?? null
  }

  private patchTab(id: string, patch: Partial<Tab>): void {
    this.set({ tabs: this.state.tabs.map((t) => (t.id === id ? withView({ ...t, ...patch }) : t)) })
  }

  addTab(doc: Doc, name: string, path: string | null = null, label = '열기'): void {
    const t: Tab = { id: tabId(), name, path, history: startHistory(doc, label), saved: path ? doc : null, view: null, snapshots: [] }
    this.set({ tabs: [...this.state.tabs, t], activeTabId: t.id, selectedIds: doc.activeId ? [doc.activeId] : [], maskEditing: false })
  }

  closeTab(id: string): void {
    const i = this.state.tabs.findIndex((t) => t.id === id)
    const tabs = this.state.tabs.filter((t) => t.id !== id)
    const next = this.state.activeTabId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : this.state.activeTabId
    this.set({ tabs, activeTabId: next, maskEditing: false })
    this.syncSelected()
  }

  switchTab(id: string): void {
    if (id === this.state.activeTabId) return
    this.set({ activeTabId: id, maskEditing: false })
    this.syncSelected()
  }

  setView(view: View | null): void {
    const t = this.tab
    if (t) this.patchTab(t.id, { view })
  }

  markSaved(tabId: string, snapshot: Doc, path: string, name: string): void {
    const t = this.state.tabs.find((t) => t.id === tabId)
    if (t) this.patchTab(t.id, { path, name, saved: snapshot })
  }

  isDirty(t: Tab): boolean {
    return t.history.present !== t.saved && (t.saved !== null || t.history.past.length > 0)
  }

  // ── 문서 변경 ──
  /** 이력에 남기는 변경 */
  commit(doc: Doc, label: string): void {
    const t = this.tab
    if (!t) return
    this.patchTab(t.id, { history: record(t.history, doc, label, this.state.settings.historyLimit) })
    this.syncSelected()
  }
  /**
   * 끄는 동안(제스처)의 변경 — 첫 번은 새 칸, 이후는 그 칸을 덮어쓴다. `endGesture()` 로 끝낸다.
   * 한 번의 끌기·슬라이더 조작 = 실행취소 한 칸.
   */
  commitGesture(doc: Doc, label: string): void {
    const t = this.tab
    if (!t) return
    const history = this.gestureOpen ? replace(t.history, doc, label) : record(t.history, doc, label, this.state.settings.historyLimit)
    this.gestureOpen = true
    this.patchTab(t.id, { history })
  }
  endGesture(): void {
    this.gestureOpen = false
  }
  private gestureOpen = false
  /** 이력에 안 남기는 변경 (활성 레이어 바꾸기 등) */
  quiet(doc: Doc): void {
    const t = this.tab
    if (!t) return
    this.patchTab(t.id, { history: silent(t.history, doc) })
    this.syncSelected()
  }
  undo(): void {
    const t = this.tab
    if (!t) return
    this.patchTab(t.id, { history: hUndo(t.history) })
    this.syncSelected()
  }
  redo(): void {
    const t = this.tab
    if (!t) return
    this.patchTab(t.id, { history: hRedo(t.history) })
    this.syncSelected()
  }

  /** 선택 목록을 문서의 활성 레이어·존재하는 레이어로 맞춘다 */
  private syncSelected(): void {
    const doc = this.doc
    if (!doc) return this.set({ selectedIds: [] })
    const ids = new Set(doc.layers.map((l) => l.id))
    let sel = this.state.selectedIds.filter((id) => ids.has(id))
    if (doc.activeId && !sel.includes(doc.activeId)) sel = [doc.activeId]
    if (!doc.activeId) sel = []
    const same = sel.length === this.state.selectedIds.length && sel.every((v, i) => v === this.state.selectedIds[i])
    if (!same) this.set({ selectedIds: sel })
    const active = doc.layers.find((l) => l.id === doc.activeId)
    if (this.state.maskEditing && !active?.mask) this.set({ maskEditing: false })
  }

  // ── 도구·설정 ──
  setTool(tool: Tool): void {
    this.set({ tool })
  }
  setSettings(patch: Partial<ToolSettings>): void {
    const settings = { ...this.state.settings, ...patch }
    this.set({ settings })
    try {
      localStorage.setItem('sc.settings', JSON.stringify(settings))
    } catch {
      /* 저장소 불가 — 무시 */
    }
  }
  setLayersWidth(w: number): void {
    this.set({ layersWidth: w })
    try {
      localStorage.setItem('sc.layersWidth', String(w))
    } catch {
      /* 무시 */
    }
  }

  toast(kind: 'ok' | 'err' | 'info', text: string): void {
    this.set({ toast: { kind, text } })
  }

  /** 오래 걸리는 작업 — 진행 표시와 오류 알림을 한 곳에서 */
  async busy<T>(label: string, fn: () => Promise<T> | T): Promise<T | undefined> {
    this.set({ progress: { label } })
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    try {
      return await fn()
    } catch (e) {
      this.toast('err', e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      this.set({ progress: null })
    }
  }

  /** 도구·대화상자 미리보기 — 지금 문서에 묶는다 (2026-09-21 사고: 확정 안 한 그라데이션 미리보기가 남아 배경 제거 결과가 화면에 안 보임) */
  setPreview(doc: Doc | null): void {
    this.set({ preview: doc, previewBase: doc ? this.doc : null })
  }
  /** 캔버스가 그릴 문서 — 유효한 미리보기가 있으면 그것 */
  get shownDoc(): Doc | null {
    const d = this.doc
    const p = this.state.preview
    return p && this.state.previewBase === d ? p : d
  }

  /** 스냅샷 — 지금 문서에 이름을 붙여 남긴다 */
  addSnapshot(name?: string): void {
    const t = this.tab
    if (!t) return
    const n = name ?? `스냅샷 ${t.snapshots.length + 1}`
    this.patchTab(t.id, { snapshots: [...t.snapshots, { id: `${Date.now()}-${t.snapshots.length}`, name: n, doc: t.history.present }] })
  }
  removeSnapshot(id: string): void {
    const t = this.tab
    if (t) this.patchTab(t.id, { snapshots: t.snapshots.filter((s) => s.id !== id) })
  }
  restoreSnapshot(id: string): void {
    const s = this.tab?.snapshots.find((x) => x.id === id)
    if (s) this.commit(s.doc, `스냅샷: ${s.name}`)
  }

  requestRender(): void {
    this.set({ renderTick: this.state.renderTick + 1 })
  }
}

function loadSettings(): ToolSettings {
  try {
    const s = localStorage.getItem('sc.settings')
    if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) }
  } catch {
    /* 무시 */
  }
  return DEFAULT_SETTINGS
}
function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : fallback
  } catch {
    return fallback
  }
}

export const editor = new EditorStore()

/** 필요한 조각만 구독 — selector 결과가 같으면 다시 그리지 않는다 */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(editor.subscribe, () => selector(editor.get()))
}

/** 활성 탭의 현재 문서 */
export function useDoc(): Doc | null {
  return useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId)?.history.present ?? null)
}

export type { Anchor }
