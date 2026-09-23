import { memo, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import TitleBar from './components/chrome/TitleBar'
import MenuBar, { type MenuDef } from './components/chrome/MenuBar'
import StatusBar from './components/chrome/StatusBar'
import ToolRailRaw from './components/ToolRail'
import ToolHeaderRaw from './components/ToolHeader'
import TabStripRaw from './components/TabStrip'
import CanvasViewRaw from './components/CanvasView'
import LayersPanelRaw, { openAdjustmentEditor } from './components/panels/LayersPanel'
import HistoryPanelRaw from './components/panels/HistoryPanel'
import DialogHostRaw from './components/DialogHost'
import PanelTabs from './components/panels/PanelTabs'
import SwatchesPanel from './components/panels/SwatchesPanel'
import NavigatorPanel from './components/panels/NavigatorPanel'
import HistogramPanel from './components/panels/HistogramPanel'
import { editor, useEditor, useDoc, type Tool } from './editor/store'
import * as A from './editor/actions'
import { openDialog, openPaths, openCompFolder, recentFiles, clearRecent, saveProject, exportPng, exportLayers, exportSelection, copyToClipboard, pasteFromClipboard } from './editor/io'
import { startAutosave, pendingRecovery } from './editor/autosave'
import { clearGuides } from './editor/guides'
import { runCommand } from './editor/commands'
import { toolInfo } from './tools'
import { getLayer, canUndo, canRedo, undoLabel, redoLabel, ADJUSTMENT_KINDS } from '@core/index'
import { applySkin, loadSkin } from './styles/tokens'
import { SKINS, SKIN_LABELS, type SkinName } from './styles/skins'
import { dims } from './util/format'
import { useCursor } from './editor/cursor'
import { ui } from './theme'

const { color, space, font, shadow, chrome } = ui

// 패널들은 스토어를 직접 구독한다 — App(메뉴 상태 때문에 문서가 바뀔 때마다 다시 그려짐)을 따라 다시 그리지 않게
const ToolRail = memo(ToolRailRaw)
const ToolHeader = memo(ToolHeaderRaw)
const TabStrip = memo(TabStripRaw)
const CanvasView = memo(CanvasViewRaw)
const LayersPanel = memo(LayersPanelRaw)
const HistoryPanel = memo(HistoryPanelRaw)
const DialogHost = memo(DialogHostRaw)

/** 글자 단축키 → 도구 (Compositor NavigationTool 단축키) */
const TOOL_KEYS: Record<string, Tool> = {
  v: 'move',
  m: 'marquee',
  l: 'lasso',
  w: 'wand',
  c: 'crop',
  b: 'brush',
  e: 'brush',
  j: 'spotHealing',
  s: 'cloneStamp',
  r: 'blur',
  g: 'gradient',
  u: 'shape',
  t: 'type',
  i: 'eyedropper',
  h: 'hand',
  z: 'zoom'
}

/** 첫 화면 — 문서가 없을 때 (Compositor 시작 창) */
function StartScreen(): JSX.Element {
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
      <Box
        sx={{
          pointerEvents: 'auto',
          bgcolor: color.canvas,
          border: `1px solid ${chrome.frame}`,
          boxShadow: shadow.dialog,
          p: `${space.xl}px`,
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: `${space.base}px`
        }}
      >
        <Box sx={{ fontSize: font.xl, fontWeight: font.bold }}>SH Compositor</Box>
        <Box sx={{ color: color.textSecondary }}>인터넷 없이 이 PC에서 레이어로 사진을 편집합니다.</Box>
        <Button variant="contained" onClick={() => editor.set({ dialog: { kind: 'newCanvas' } })}>
          새로 만들기… (Ctrl+N)
        </Button>
        <Button variant="outlined" onClick={() => void openDialog()}>
          열기… (Ctrl+O)
        </Button>
        <Button variant="outlined" onClick={() => void pasteFromClipboard()}>
          클립보드에서 새로 만들기 (Ctrl+V)
        </Button>
        <Box sx={{ fontSize: font.xs, color: color.textSecondary }}>이미지나 .shcomp 파일을 여기에 끌어다 놓아도 됩니다. PNG·JPEG·WebP·GIF·BMP·HEIC·TIFF 지원.</Box>
      </Box>
    </Box>
  )
}

/** 상태 줄: 커서 좌표 + 그 자리의 보이는 색 (포토샵 정보 패널의 축약) */
function CursorPane(): JSX.Element {
  const c = useCursor()
  if (!c) return <span>X · Y</span>
  const hexOf = (v: number): string => v.toString(16).padStart(2, '0')
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      X {c.x} · Y {c.y}
      {c.rgba && (
        <>
          <Box component="span" sx={{ width: 10, height: 10, border: `1px solid ${color.borderStrong}`, bgcolor: `rgba(${c.rgba[0]},${c.rgba[1]},${c.rgba[2]},${c.rgba[3] / 255})` }} />
          {c.rgba[3] === 0 ? '투명' : `#${hexOf(c.rgba[0])}${hexOf(c.rgba[1])}${hexOf(c.rgba[2])}${c.rgba[3] < 255 ? ` α${Math.round((c.rgba[3] / 255) * 100)}%` : ''}`}
        </>
      )}
    </Box>
  )
}

/** 오른쪽 패널 폭 조절 손잡이 */
function Splitter(): JSX.Element {
  const drag = useRef<{ x: number; w: number } | null>(null)
  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="패널 폭"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, w: editor.state.layersWidth }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) editor.setLayersWidth(Math.max(200, Math.min(520, d.w - (e.clientX - d.x))))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      sx={{ width: 4, flexShrink: 0, cursor: 'col-resize', bgcolor: chrome.frame, '&:hover': { bgcolor: color.hoverEdge } }}
    />
  )
}

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function App(): JSX.Element {
  const doc = useDoc()
  const tab = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const tabCount = useEditor((s) => s.tabs.length)
  const tool = useEditor((s) => s.tool)
  const progress = useEditor((s) => s.progress)
  const toast = useEditor((s) => s.toast)
  const showGrid = useEditor((s) => s.showGrid)
  const settings = useEditor((s) => s.settings)
  const layersWidth = useEditor((s) => s.layersWidth)
  const maskEditing = useEditor((s) => s.maskEditing)
  const selectedCount = useEditor((s) => s.selectedIds.length)
  const [skin, setSkin] = useState<SkinName>(loadSkin)
  useEditor((s) => s.renderTick) // 최근 파일 목록 갱신 신호
  const recent = recentFiles()

  // 창 닫기·파일 연결로 열기·붙여넣기
  useEffect(() => {
    const offClose = window.api.win.onCloseRequest(() => A.requestQuit())
    const offOpen = window.api.onOpenFiles((p) => void openPaths(p))
    void window.api.pendingOpen().then((p) => {
      if (p.length) void openPaths(p)
    })
    const stopAutosave = startAutosave()
    void pendingRecovery().then((items) => {
      if (items.length && !editor.state.dialog) editor.set({ dialog: { kind: 'recover', items } })
    })
    const offRecovered = window.api.onRecovered((reason) => editor.toast('err', `화면 프로세스가 복구되었습니다 (${reason}). 저장하지 않은 작업은 사라졌을 수 있습니다.`))
    return () => {
      offClose()
      offOpen()
      offRecovered()
      stopAutosave()
    }
  }, [])

  // 전역 단축키 — Photoshop·Compositor 배치
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isTyping(e.target) || editor.state.dialog || document.querySelector('.MuiPopover-root, .MuiMenu-root')) return
      const k = e.key.toLowerCase()
      const ctrl = e.ctrlKey || e.metaKey
      const run = (fn: () => unknown): void => {
        e.preventDefault()
        void fn()
      }
      if (ctrl) {
        const combo = `${e.shiftKey ? 'S' : ''}${e.altKey ? 'A' : ''}${k}`
        const map: Record<string, () => unknown> = {
          n: () => editor.set({ dialog: { kind: 'newCanvas' } }),
          o: openDialog,
          So: A.importDialog,
          s: () => saveProject(),
          Ss: () => saveProject(true),
          SAs: exportPng,
          w: () => A.requestCloseTab(),
          z: () => editor.undo(),
          Sz: () => editor.redo(),
          y: () => editor.redo(),
          x: A.cut,
          c: () => copyToClipboard(false),
          Sc: () => copyToClipboard(true),
          v: pasteFromClipboard,
          a: A.selectAll,
          d: A.deselect,
          Si: A.invertSelection,
          Ai: () => editor.set({ dialog: { kind: 'imageSize' } }),
          Ac: () => editor.set({ dialog: { kind: 'canvasSize' } }),
          l: () => editor.set({ dialog: { kind: 'adjust', tab: 'levels' } }),
          m: () => editor.set({ dialog: { kind: 'adjust', tab: 'curves' } }),
          u: () => editor.set({ dialog: { kind: 'adjust', tab: 'hsl' } }),
          b: () => editor.set({ dialog: { kind: 'moreAdjust', which: 'colorBalance' } }),
          SAb: () => editor.set({ dialog: { kind: 'moreAdjust', which: 'blackWhite' } }),
          i: () => A.quickAdjust('invert'),
          Su: () => A.quickAdjust('desaturate'),
          Sl: () => A.quickAdjust('color'),
          SAl: () => A.quickAdjust('contrast'),
          Sb: () => A.quickAdjust('neutral'),
          Sn: A.newLayer,
          j: () => A.viaCopy(false),
          Sj: () => A.viaCopy(true),
          g: A.group,
          Sg: A.ungroupCmd,
          Ag: A.toggleClip,
          e: A.mergeDownCmd,
          Se: A.mergeVisible,
          ']': () => A.arrange(1),
          '[': () => A.arrange(-1),
          t: () => editor.setTool('move'),
          '=': () => runCommand('zoomIn'),
          '+': () => runCommand('zoomIn'),
          'S+': () => runCommand('zoomIn'),
          'S=': () => runCommand('zoomIn'),
          '-': () => runCommand('zoomOut'),
          '0': () => runCommand('fit'),
          '1': () => runCommand('actualSize'),
          "'": () => editor.set({ showGrid: !editor.state.showGrid }),
          r: () => editor.setSettings({ showRulers: !editor.state.settings.showRulers }),
          k: () => editor.set({ dialog: { kind: 'preferences' } }),
          Ar: () => editor.state.tabs.length && editor.doc?.selection && editor.set({ dialog: { kind: 'refineEdge' } }),
          ';': () => editor.setSettings({ showGuides: !editor.state.settings.showGuides }),
          'S;': () => editor.setSettings({ snapGuides: !editor.state.settings.snapGuides }),
          'A;': () => editor.setSettings({ lockGuides: !editor.state.settings.lockGuides }),
          backspace: () => A.fill('bg')
        }
        const fn = map[combo]
        if (fn) run(fn)
        return
      }
      if (e.key === 'F1' && !e.shiftKey && !e.altKey) return run(() => editor.set({ dialog: { kind: 'help' } }))
      if (e.altKey && k === 'backspace') return run(() => A.fill('fg'))
      if (e.shiftKey && e.key === 'F5') return run(A.contentAwareFill)
      if (e.shiftKey && e.key === 'F6') return run(() => editor.state.tabs.length && editor.set({ dialog: { kind: 'selectAmount', op: 'feather' } }))
      if (e.altKey) return
      if ((k === 'delete' || k === 'backspace') && editor.doc) return run(A.clearPixels)
      if (e.shiftKey) return
      if (k === 'x') return run(() => editor.set({ fg: editor.state.bg, bg: editor.state.fg }))
      if (k === 'd') return run(() => editor.set({ fg: [0, 0, 0], bg: [255, 255, 255] }))
      if (k === 'q' && editor.doc) return run(() => A.addMask())
      const t = TOOL_KEYS[k]
      if (t) {
        run(() => {
          if (k === 'e') editor.setSettings({ brushMode: 'erase' })
          if (k === 'b') editor.setSettings({ brushMode: 'paint' })
          // W: 마법봉 ↔ 개체 선택 (포토샵 도구 묶음처럼 누를 때마다 번갈아)
          if (k === 'w' && editor.state.tool === 'wand') return editor.setTool('objectSelect')
          editor.setTool(t)
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const has = !!doc
  const active = doc ? getLayer(doc, doc.activeId) : null
  const hasSel = !!doc?.selection
  const pixel = !!active && (active.kind === 'pixel' || active.kind === 'text')
  const h = tab?.history
  const dlg = (d: Parameters<typeof editor.set>[0]['dialog']) => () => editor.set({ dialog: d })

  const menus: MenuDef[] = [
    {
      label: '파일(F)',
      items: [
        { label: '새로 만들기…', shortcut: 'Ctrl+N', onClick: dlg({ kind: 'newCanvas' }) },
        { label: '열기…', shortcut: 'Ctrl+O', onClick: () => void openDialog() },
        {
          label: '최근 파일',
          onClick: () => {},
          submenu: recent.length
            ? [
                ...recent.map((p, i) => ({ label: `${i + 1}. ${p.split(/[\\/]/).pop()}`, shortcut: p.length > 40 ? `…${p.slice(-38)}` : p, onClick: () => void openPaths([p]) })),
                'sep' as const,
                { label: '목록 지우기', onClick: clearRecent }
              ]
            : [{ label: '최근 파일 없음', onClick: () => {}, disabled: true }]
        },
        { label: 'Compositor 프로젝트(.comp) 폴더 열기…', onClick: () => void editor.busy('Compositor 프로젝트 여는 중…', () => openCompFolder()) },
        { label: '레이어로 가져오기…', shortcut: 'Ctrl+Shift+O', onClick: () => void A.importDialog(), disabled: !has },
        'sep',
        { label: '저장', shortcut: 'Ctrl+S', onClick: () => void saveProject(), disabled: !has },
        { label: '다른 이름으로 저장…', shortcut: 'Ctrl+Shift+S', onClick: () => void saveProject(true), disabled: !has },
        { label: 'Photoshop(PSD)로 저장…', onClick: () => void saveProject(true, 'psd'), disabled: !has },
        'sep',
        {
          label: '내보내기',
          onClick: () => {},
          disabled: !has,
          submenu: [
            { label: 'PNG…', shortcut: 'Ctrl+Shift+Alt+S', onClick: () => void exportPng() },
            { label: 'JPEG…', onClick: dlg({ kind: 'export', format: 'jpeg' }) },
            { label: 'WebP…', onClick: dlg({ kind: 'export', format: 'webp' }) },
            'sep',
            { label: '레이어를 각각 PNG로…', onClick: () => void exportLayers() },
            { label: '선택 영역을 PNG로…', onClick: () => void exportSelection(), disabled: !hasSel }
          ]
        },
        'sep',
        { label: '닫기', shortcut: 'Ctrl+W', onClick: () => A.requestCloseTab(), disabled: !has },
        // 웹은 브라우저 탭을 닫아 끝낸다 (페이지가 창을 닫을 수 없다)
        ...(window.api.platform === 'web' ? [] : [{ label: '끝내기', shortcut: 'Alt+F4', onClick: () => A.requestQuit() }])
      ]
    },
    {
      label: '편집(E)',
      items: [
        { label: h && canUndo(h) ? `실행 취소: ${undoLabel(h)}` : '실행 취소', shortcut: 'Ctrl+Z', onClick: () => editor.undo(), disabled: !h || !canUndo(h) },
        { label: h && canRedo(h) ? `다시 실행: ${redoLabel(h)}` : '다시 실행', shortcut: 'Ctrl+Shift+Z', onClick: () => editor.redo(), disabled: !h || !canRedo(h) },
        'sep',
        { label: '잘라내기', shortcut: 'Ctrl+X', onClick: () => void A.cut(), disabled: !pixel },
        { label: '복사', shortcut: 'Ctrl+C', onClick: () => void copyToClipboard(false), disabled: !pixel },
        { label: '병합하여 복사', shortcut: 'Ctrl+Shift+C', onClick: () => void copyToClipboard(true), disabled: !has },
        { label: '붙여넣기', shortcut: 'Ctrl+V', onClick: () => void pasteFromClipboard() },
        { label: '지우기', shortcut: 'Delete', onClick: A.clearPixels, disabled: !pixel || !hasSel },
        'sep',
        { label: '전경색으로 채우기', shortcut: 'Alt+Backspace', onClick: () => A.fill('fg'), disabled: !pixel },
        { label: '배경색으로 채우기', shortcut: 'Ctrl+Backspace', onClick: () => A.fill('bg'), disabled: !pixel },
        { label: '내용 인식 채우기', shortcut: 'Shift+F5', onClick: () => void A.contentAwareFill(), disabled: !pixel || !hasSel },
        { label: '선 그리기…', onClick: dlg({ kind: 'stroke' }), disabled: !pixel || !hasSel },
        'sep',
        { label: '자유 변형', shortcut: 'Ctrl+T', onClick: () => editor.setTool('move'), disabled: !has },
        'sep',
        { label: '환경 설정…', shortcut: 'Ctrl+K', onClick: dlg({ kind: 'preferences' }) }
      ]
    },
    {
      label: '이미지(I)',
      items: [
        { label: '이미지 크기…', shortcut: 'Ctrl+Alt+I', onClick: dlg({ kind: 'imageSize' }), disabled: !has },
        { label: '캔버스 크기…', shortcut: 'Ctrl+Alt+C', onClick: dlg({ kind: 'canvasSize' }), disabled: !has },
        { label: '선택 영역으로 자르기', onClick: A.cropToSelection, disabled: !hasSel },
        { label: '투명 여백 자르기', onClick: A.trimTransparent, disabled: !has },
        'sep',
        { label: '캔버스 90° 시계 방향', onClick: () => A.rotateCanvas(1), disabled: !has },
        { label: '캔버스 90° 반시계 방향', onClick: () => A.rotateCanvas(-1), disabled: !has },
        { label: '캔버스 180°', onClick: () => A.rotateCanvas(2), disabled: !has },
        { label: '캔버스 좌우 반전', onClick: () => A.flipCanvasCmd(true), disabled: !has },
        { label: '캔버스 상하 반전', onClick: () => A.flipCanvasCmd(false), disabled: !has },
        'sep',
        {
          label: '조정',
          onClick: () => {},
          disabled: !pixel,
          submenu: [
            { label: '레벨…', shortcut: 'Ctrl+L', onClick: dlg({ kind: 'adjust', tab: 'levels' }) },
            { label: '커브…', shortcut: 'Ctrl+M', onClick: dlg({ kind: 'adjust', tab: 'curves' }) },
            { label: '노출…', onClick: dlg({ kind: 'adjust', tab: 'exposure' }) },
            'sep',
            { label: '활기…', onClick: dlg({ kind: 'moreAdjust', which: 'vibrance' }) },
            { label: '색조/채도…', shortcut: 'Ctrl+U', onClick: dlg({ kind: 'adjust', tab: 'hsl' }) },
            { label: '색상 균형…', shortcut: 'Ctrl+B', onClick: dlg({ kind: 'moreAdjust', which: 'colorBalance' }) },
            { label: '흑백…', shortcut: 'Ctrl+Shift+Alt+B', onClick: dlg({ kind: 'moreAdjust', which: 'blackWhite' }) },
            'sep',
            { label: '반전', shortcut: 'Ctrl+I', onClick: () => A.quickAdjust('invert') },
            { label: '포스터화…', onClick: dlg({ kind: 'moreAdjust', which: 'posterize' }) },
            { label: '한계값…', onClick: dlg({ kind: 'moreAdjust', which: 'threshold' }) },
            { label: '그레인·그라데이션 맵…', onClick: dlg({ kind: 'adjust', tab: 'effects' }) },
            'sep',
            { label: '채도 감소', shortcut: 'Ctrl+Shift+U', onClick: () => A.quickAdjust('desaturate') }
          ]
        },
        'sep',
        { label: '자동 톤', shortcut: 'Ctrl+Shift+L', onClick: () => A.quickAdjust('color'), disabled: !pixel },
        { label: '자동 대비', shortcut: 'Ctrl+Shift+Alt+L', onClick: () => A.quickAdjust('contrast'), disabled: !pixel },
        { label: '자동 색상', shortcut: 'Ctrl+Shift+B', onClick: () => A.quickAdjust('neutral'), disabled: !pixel }
      ]
    },
    {
      label: '레이어(L)',
      items: [
        { label: '새 레이어', shortcut: 'Ctrl+Shift+N', onClick: A.newLayer, disabled: !has },
        { label: hasSel ? '복사한 레이어' : '레이어 복제', shortcut: 'Ctrl+J', onClick: () => A.viaCopy(false), disabled: !has || !selectedCount },
        { label: '잘라낸 레이어', shortcut: 'Ctrl+Shift+J', onClick: () => A.viaCopy(true), disabled: !pixel || !hasSel },
        { label: '레이어 삭제', onClick: A.deleteLayers, disabled: !selectedCount },
        { label: '이름 바꾸기…', onClick: () => active && editor.set({ dialog: { kind: 'rename', layerId: active.id } }), disabled: !active },
        'sep',
        { label: '새 조정 레이어', onClick: () => {}, disabled: !has, submenu: ADJUSTMENT_KINDS.map((k) => ({ label: `${k.label}…`, onClick: () => A.newAdjustmentLayer(k.key) })) },
        { label: '조정 설정 편집…', onClick: () => active && openAdjustmentEditor(active), disabled: active?.kind !== 'adjustment' },
        'sep',
        {
          label: '레이어 효과',
          onClick: () => {},
          disabled: !pixel,
          submenu: [
            { label: '효과 설정…', onClick: () => active && editor.set({ dialog: { kind: 'effects', layerId: active.id } }) },
            'sep',
            { label: '레이어 효과 복사', onClick: A.copyLayerStyle, disabled: !active?.effects },
            { label: '레이어 효과 붙여넣기', onClick: A.pasteLayerStyle, disabled: !A.hasStyleClip() },
            { label: '레이어 효과 지우기', onClick: A.clearLayerStyle, disabled: !active?.effects }
          ]
        },
        {
          label: '레이어 마스크',
          onClick: () => {},
          disabled: !active,
          submenu: [
            { label: active?.mask ? '마스크 편집' : '마스크 추가 (모두 보이기)', shortcut: 'Q', onClick: () => A.addMask() },
            { label: '마스크 추가 (모두 가리기)', onClick: () => A.addMask(true), disabled: !!active?.mask },
            'sep',
            { label: '마스크 편집 중', onClick: () => editor.set({ maskEditing: !maskEditing }), checked: maskEditing, disabled: !active?.mask },
            { label: active?.mask?.enabled === false ? '마스크 켜기' : '마스크 끄기', onClick: A.toggleMaskEnabled, disabled: !active?.mask },
            { label: '마스크 반전', onClick: A.invertMask, disabled: !active?.mask },
            { label: '마스크 페더…', onClick: dlg({ kind: 'selectAmount', op: 'maskFeather' }), disabled: !active?.mask },
            'sep',
            { label: '마스크 적용', onClick: () => A.deleteMask(true), disabled: !active?.mask || !active?.bitmap },
            { label: '마스크 삭제', onClick: () => A.deleteMask(false), disabled: !active?.mask }
          ]
        },
        'sep',
        { label: active?.clip ? '클리핑 마스크 해제' : '클리핑 마스크 만들기', shortcut: 'Ctrl+Alt+G', onClick: A.toggleClip, disabled: !active },
        { label: '그룹 만들기', shortcut: 'Ctrl+G', onClick: A.group, disabled: !selectedCount },
        { label: '그룹 해제', shortcut: 'Ctrl+Shift+G', onClick: A.ungroupCmd, disabled: active?.kind !== 'group' },
        { label: '앞으로 가져오기', shortcut: 'Ctrl+]', onClick: () => A.arrange(1), disabled: !active },
        { label: '뒤로 보내기', shortcut: 'Ctrl+[', onClick: () => A.arrange(-1), disabled: !active },
        'sep',
        { label: selectedCount > 1 ? '레이어 병합' : '아래 레이어와 병합', shortcut: 'Ctrl+E', onClick: A.mergeDownCmd, disabled: !active },
        { label: '보이는 레이어 병합', shortcut: 'Ctrl+Shift+E', onClick: A.mergeVisible, disabled: !has },
        { label: '이미지 병합', onClick: A.flatten, disabled: !has },
        { label: '래스터화 (픽셀로 바꾸기)', onClick: A.rasterizeText, disabled: active?.kind !== 'text' && !active?.shape }
      ]
    },
    {
      label: '선택(S)',
      items: [
        { label: '모두 선택', shortcut: 'Ctrl+A', onClick: A.selectAll, disabled: !has },
        { label: '선택 해제', shortcut: 'Ctrl+D', onClick: A.deselect, disabled: !hasSel },
        { label: '선택 반전', shortcut: 'Ctrl+Shift+I', onClick: A.invertSelection, disabled: !has },
        { label: '레이어 픽셀 선택', onClick: () => active && A.selectLayerPixels(active.id), disabled: !active?.bitmap },
        { label: '피사체 (AI)', onClick: () => void A.selectSubject(), disabled: !has },
        'sep',
        { label: '확장…', onClick: dlg({ kind: 'selectAmount', op: 'expand' }), disabled: !hasSel },
        { label: '축소…', onClick: dlg({ kind: 'selectAmount', op: 'contract' }), disabled: !hasSel },
        { label: '페더…', shortcut: 'Shift+F6', onClick: dlg({ kind: 'selectAmount', op: 'feather' }), disabled: !hasSel },
        { label: '매끄럽게…', onClick: dlg({ kind: 'selectAmount', op: 'smooth' }), disabled: !hasSel },
        'sep',
        { label: '가장자리 다듬기…', shortcut: 'Ctrl+Alt+R', onClick: dlg({ kind: 'refineEdge' }), disabled: !hasSel }
      ]
    },
    {
      label: '필터(T)',
      items: [
        { label: '흐림·노이즈·렌즈…', onClick: dlg({ kind: 'filters' }), disabled: !pixel },
        { label: '선명하게 (언샤프 마스크·하이 패스)…', onClick: dlg({ kind: 'filters', focus: 'sharpen' }), disabled: !pixel },
        { label: '모자이크·노이즈 감소…', onClick: dlg({ kind: 'filters', focus: 'other' }), disabled: !pixel },
        'sep',
        { label: '배경 제거 (AI)…', onClick: dlg({ kind: 'removeBg' }), disabled: !pixel },
        { label: '내용 인식 채우기', shortcut: 'Shift+F5', onClick: () => void A.contentAwareFill(), disabled: !pixel || !hasSel }
      ]
    },
    {
      label: '보기(V)',
      items: [
        { label: '확대', shortcut: 'Ctrl++', onClick: () => runCommand('zoomIn'), disabled: !has },
        { label: '축소', shortcut: 'Ctrl+-', onClick: () => runCommand('zoomOut'), disabled: !has },
        { label: '화면에 맞춤', shortcut: 'Ctrl+0', onClick: () => runCommand('fit'), disabled: !has },
        { label: '실제 크기 (100%)', shortcut: 'Ctrl+1', onClick: () => runCommand('actualSize'), disabled: !has },
        'sep',
        { label: '픽셀 격자 (확대 시)', shortcut: "Ctrl+'", onClick: () => editor.set({ showGrid: !showGrid }), checked: showGrid },
        { label: '눈금자', shortcut: 'Ctrl+R', onClick: () => editor.setSettings({ showRulers: !settings.showRulers }), checked: settings.showRulers },
        {
          label: '안내선',
          onClick: () => {},
          submenu: [
            { label: '안내선 보기', shortcut: 'Ctrl+;', onClick: () => editor.setSettings({ showGuides: !settings.showGuides }), checked: settings.showGuides },
            { label: '안내선에 맞추기', shortcut: 'Ctrl+Shift+;', onClick: () => editor.setSettings({ snapGuides: !settings.snapGuides }), checked: settings.snapGuides },
            { label: '안내선 잠그기', shortcut: 'Ctrl+Alt+;', onClick: () => editor.setSettings({ lockGuides: !settings.lockGuides }), checked: settings.lockGuides },
            'sep',
            { label: '새 안내선…', onClick: dlg({ kind: 'newGuide' }), disabled: !has },
            { label: '안내선 모두 지우기', onClick: clearGuides, disabled: !doc?.guides || (!doc.guides.v.length && !doc.guides.h.length) }
          ]
        },
        'sep',
        {
          label: '스킨',
          onClick: () => {},
          submenu: (Object.keys(SKINS) as SkinName[]).map((name) => ({
            label: SKIN_LABELS[name],
            onClick: () => {
              applySkin(name)
              setSkin(name)
            },
            checked: skin === name
          }))
        }
      ]
    },
    {
      label: '도움말(H)',
      items: [{ label: '사용 설명서…', shortcut: 'F1', onClick: dlg({ kind: 'help' }) }, 'sep', { label: 'SH Compositor 정보…', onClick: dlg({ kind: 'about' }) }]
    }
  ]

  const info = toolInfo(tool)
  const zoom = tab?.view ? `${Math.round(tab.view.zoom * 1000) / 10}%` : '—'
  const message = progress?.label ?? (maskEditing ? '마스크 편집 중입니다. 검정으로 칠하면 가려지고 흰색으로 칠하면 보입니다. 레이어로 돌아가려면 레이어 썸네일을 누르세요.' : (info?.hint ?? '준비'))
  const panes: React.ReactNode[] = doc
    ? [
        <CursorPane key="cur" />,
        `${dims(doc.width, doc.height)}px · ${doc.resolution}dpi`,
        `레이어 ${doc.layers.length}`,
        doc.selection?.bounds ? `선택 ${dims(doc.selection.bounds.w, doc.selection.bounds.h)}` : '선택 없음',
        zoom
      ]
    : [`문서 ${tabCount}`]

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: color.sunken, overflow: 'hidden' }}>
      <TitleBar subtitle={tab ? `${tab.name}${editor.isDirty(tab) ? ' *' : ''}` : undefined} />
      <MenuBar menus={menus} />
      <ToolHeader />
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ToolRail />
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <TabStrip />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
            <CanvasView />
            {tabCount === 0 && <StartScreen />}
          </Box>
        </Box>
        <Splitter />
        <Box sx={{ width: layersWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', bgcolor: color.sunken, minHeight: 0 }}>
          <Box sx={{ flex: 3, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <LayersPanel />
          </Box>
          <Box sx={{ height: 250, flexShrink: 0 }}>
            <PanelTabs
              id="lower"
              tabs={[
                { key: 'history', label: '작업 내역', render: () => <HistoryPanel /> },
                { key: 'swatches', label: '견본', render: () => <SwatchesPanel /> },
                { key: 'navigator', label: '내비게이터', render: () => <NavigatorPanel /> },
                { key: 'histogram', label: '히스토그램', render: () => <HistogramPanel /> }
              ]}
            />
          </Box>
        </Box>
      </Box>
      <StatusBar message={message} progress={progress ? (progress.value ?? null) : undefined} panes={panes} />
      <DialogHost />
      <Snackbar
        open={!!toast}
        autoHideDuration={toast?.kind === 'err' ? null : 4000}
        onClose={(_, reason) => reason !== 'clickaway' && editor.set({ toast: null })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        sx={{ bottom: '30px !important' }}
      >
        <Alert
          severity={toast?.kind === 'ok' ? 'success' : toast?.kind === 'err' ? 'error' : 'info'}
          variant="standard"
          onClose={() => editor.set({ toast: null })}
          sx={{ boxShadow: shadow.raised, bgcolor: color.canvas, maxWidth: 560 }}
        >
          {toast?.text}
        </Alert>
      </Snackbar>
    </Box>
  )
}
