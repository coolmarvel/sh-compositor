import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import { GLRenderer, type View } from '../gl/GLRenderer'
import { fitView, adaptView, nextZoom } from '../editor/view'
export { fitView }
import { editor, useEditor } from '../editor/store'
import { toolInfo } from '../tools'
import { drawSelection } from '../tools/select'
import { typeTool, commitTextDraft, type TextDraft, zoomAt } from '../tools/misc'
import { clearHover } from '../tools/paint'
import { importAsLayer, openBytes } from '../editor/io'
import { fontCss } from '../editor/text'
import type { ToolCtx, PointerInfo } from '../tools/types'
import { registerCommands } from '../editor/commands'
import { setCursor as setCursorInfo } from '../editor/cursor'
import { ui } from '../theme'

const { color } = ui
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

/**
 * 캔버스 — WebGL2 합성 결과 + 2D 오버레이(선택 테두리·핸들·도구 미리보기) + 문자 편집 상자.
 * 포인터·키·휠을 활성 도구에 넘긴다. Space 를 누르고 있으면 어느 도구에서나 손(팬).
 */
export default function CanvasView(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GLRenderer | null>(null)
  const dragging = useRef(false)
  const hoverRef = useRef<PointerInfo | null>(null)
  const spaceRef = useRef<{ down: boolean; pan: { sx: number; sy: number; px: number; py: number } | null }>({ down: false, pan: null })
  const [draft, setDraft] = useState<TextDraft | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const tool = useEditor((s) => s.tool)
  const tabId = useEditor((s) => s.activeTabId)

  const view = (): View => editor.tab?.view ?? { zoom: 1, panX: 0, panY: 0 }

  const ctx: ToolCtx = {
    doc: () => editor.doc,
    view,
    renderer: () => rendererRef.current,
    toDoc: (sx, sy) => {
      const v = view()
      return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom }
    },
    toScreen: (dx, dy) => {
      const v = view()
      return { x: v.panX + dx * v.zoom, y: v.panY + dy * v.zoom }
    },
    redraw: () => draw(),
    setView: (v) => {
      const h = hostRef.current
      // 도구·휠이 바꾼 보기 = 사용자 조작 → 맞춤 상태 해제 (도구가 {...view} 로 fit:true 를 복사해 와도)
      editor.setView({ zoom: v.zoom, panX: v.panX, panY: v.panY, fit: false, cw: h?.clientWidth, ch: h?.clientHeight })
      draw()
    }
  }

  const draw = useCallback(() => {
    const r = rendererRef.current
    const host = hostRef.current
    const ov = ovRef.current
    if (!host || !ov) return
    const tab = editor.tab
    const doc = editor.state.preview ?? tab?.history.present ?? null
    let v = tab?.view ?? null
    if (tab && doc && host.clientWidth > 0 && host.clientHeight > 0) {
      const nv = adaptView(v, doc.width, doc.height, host.clientWidth, host.clientHeight)
      if (nv !== v) {
        v = nv
        editor.setView(v)
      }
    }
    if (r) {
      r.setDoc(doc)
      const bg = hex(color.viewer)
      r.render(v ?? { zoom: 1, panX: 0, panY: 0 }, editor.state.showGrid, { a: hex(color.checkerA), b: hex(color.checkerB) }, bg)
    }
    // 오버레이
    const dpr = window.devicePixelRatio || 1
    const cw = host.clientWidth
    const ch = host.clientHeight
    if (ov.width !== Math.round(cw * dpr) || ov.height !== Math.round(ch * dpr)) {
      ov.width = Math.round(cw * dpr)
      ov.height = Math.round(ch * dpr)
    }
    const g = ov.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, cw, ch)
    if (doc && v) {
      // 문서 테두리
      g.strokeStyle = 'rgba(0,0,0,.6)'
      g.strokeRect(Math.round(v.panX) - 0.5, Math.round(v.panY) - 0.5, Math.round(doc.width * v.zoom) + 1, Math.round(doc.height * v.zoom) + 1)
      if (doc.selection) drawSelection(ctx, g, doc.selection)
      toolInfo(editor.state.tool)?.handler.overlay?.(ctx, g)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 렌더러 생성
  useEffect(() => {
    try {
      rendererRef.current = new GLRenderer(glRef.current!)
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
    }
    const ro = new ResizeObserver(() => draw())
    ro.observe(hostRef.current!)
    return () => {
      ro.disconnect()
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [draw])

  // 문서·보기·미리보기가 바뀌면 다시 그림
  useEffect(() => editor.subscribe(() => requestAnimationFrame(draw)), [draw])

  // 선택 테두리 개미 행진 — 선택이 있을 때만 애니메이션
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number): void => {
      if (editor.doc?.selection && t - last > 90) {
        last = t
        draw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  // 도구를 바꾸면 이전 도구의 진행 중인 일을 확정
  const prevTool = useRef(tool)
  useEffect(() => {
    if (prevTool.current !== tool) {
      toolInfo(prevTool.current)?.handler.leave?.(ctx)
      prevTool.current = tool
      clearHover()
      draw()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // 메뉴·도구 헤더가 부르는 캔버스 명령
  useEffect(() => {
    const host = (): HTMLDivElement => hostRef.current!
    const center = (): { x: number; y: number } => ({ x: host().clientWidth / 2, y: host().clientHeight / 2 })
    return registerCommands({
      toolCommit: () => {
        toolInfo(editor.state.tool)?.handler.commit?.(ctx)
        editor.requestRender()
      },
      toolCancel: () => {
        toolInfo(editor.state.tool)?.handler.cancel?.(ctx)
        editor.requestRender()
      },
      fit: () => {
        const d = editor.doc
        if (d) {
          editor.setView(fitView(d.width, d.height, host().clientWidth, host().clientHeight))
          draw()
        }
      },
      actualSize: () => {
        const d = editor.doc
        if (d) ctx.setView({ zoom: 1, panX: Math.round((host().clientWidth - d.width) / 2), panY: Math.round((host().clientHeight - d.height) / 2) })
      },
      zoomIn: () => zoomAt(ctx, center(), nextZoom(view().zoom, 1)),
      zoomOut: () => zoomAt(ctx, center(), nextZoom(view().zoom, -1)),
      redraw: () => draw()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw])

  // 탭을 바꾸면 문자 편집 닫기
  useEffect(() => setDraft(null), [tabId])

  // 문자 도구 → 편집 상자
  useEffect(() => {
    typeTool.onDraft = (d) => setDraft(d)
    return () => {
      typeTool.onDraft = undefined
    }
  }, [])

  const info = (e: React.PointerEvent | PointerEvent): PointerInfo => {
    const r = hostRef.current!.getBoundingClientRect()
    const s = { x: e.clientX - r.left, y: e.clientY - r.top }
    const pe = ('nativeEvent' in e ? e.nativeEvent : e) as PointerEvent
    return { p: ctx.toDoc(s.x, s.y), s, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, pressure: pe.pressure || 1, e: pe }
  }

  // 상태 줄 좌표·색 — 프레임당 한 번만 GPU 에서 읽는다
  const cursorRaf = useRef(0)
  const reportCursor = (pt: { x: number; y: number }): void => {
    if (cursorRaf.current) return
    cursorRaf.current = requestAnimationFrame(() => {
      cursorRaf.current = 0
      const d = editor.doc
      if (!d) return setCursorInfo(null)
      const x = Math.floor(pt.x)
      const y = Math.floor(pt.y)
      const inside = x >= 0 && y >= 0 && x < d.width && y < d.height
      setCursorInfo({ x, y, rgba: inside ? (rendererRef.current?.readPixel(x, y) ?? null) : null })
    })
  }

  const setCursor = (p: PointerInfo | null): void => {
    const host = hostRef.current
    if (!host) return
    if (spaceRef.current.down) host.style.cursor = spaceRef.current.pan ? 'grabbing' : 'grab'
    else host.style.cursor = toolInfo(editor.state.tool)?.handler.cursor?.(ctx, p) ?? 'default'
  }

  const onDown = (e: React.PointerEvent): void => {
    if (!editor.doc || draft) return
    hostRef.current!.focus()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = info(e)
    if (spaceRef.current.down || e.button === 1) {
      const v = view()
      spaceRef.current.pan = { sx: p.s.x, sy: p.s.y, px: v.panX, py: v.panY }
      setCursor(p)
      return
    }
    if (e.button !== 0) return
    dragging.current = true
    toolInfo(editor.state.tool)?.handler.down?.(ctx, p)
    editor.requestRender()
  }
  const onMove = (e: React.PointerEvent): void => {
    const p = info(e)
    hoverRef.current = p
    reportCursor(p.p)
    const pan = spaceRef.current.pan
    if (pan) {
      ctx.setView({ ...view(), panX: pan.px + p.s.x - pan.sx, panY: pan.py + p.s.y - pan.sy })
      return
    }
    if (!editor.doc) return
    // 빠른 펜·마우스: 합쳐진 이벤트까지 모두 (브러시가 끊기지 않게)
    const events = dragging.current && e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
    for (const ev of events) toolInfo(editor.state.tool)?.handler.move?.(ctx, info(ev), dragging.current)
    setCursor(p)
  }
  const onUp = (e: React.PointerEvent): void => {
    if (spaceRef.current.pan) {
      spaceRef.current.pan = null
      setCursor(info(e))
      return
    }
    if (!dragging.current) return
    dragging.current = false
    toolInfo(editor.state.tool)?.handler.up?.(ctx, info(e))
    editor.requestRender()
  }

  // 휠: Ctrl/Alt = 확대/축소(마우스 위치 기준), 그냥 = 세로 팬, Shift = 가로 팬 — Compositor 트랙패드 동작의 마우스판
  const onWheel = (e: React.WheelEvent): void => {
    if (!editor.doc) return
    const r = hostRef.current!.getBoundingClientRect()
    const s = { x: e.clientX - r.left, y: e.clientY - r.top }
    if (e.ctrlKey || e.altKey) zoomAt(ctx, s, view().zoom * Math.pow(1.0015, -e.deltaY))
    else {
      const v = view()
      ctx.setView({ ...v, panX: v.panX - (e.shiftKey ? e.deltaY : e.deltaX), panY: v.panY - (e.shiftKey ? 0 : e.deltaY) })
    }
  }

  // Space = 임시 손 도구 / 도구 키 전달
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (draft) return
    if (e.key === ' ' && !spaceRef.current.down) {
      spaceRef.current.down = true
      setCursor(hoverRef.current)
      e.preventDefault()
      return
    }
    const h = toolInfo(editor.state.tool)?.handler
    if (e.key === 'Enter' && h?.commit) {
      h.commit(ctx)
      e.preventDefault()
      editor.requestRender()
      return
    }
    if (e.key === 'Escape' && h?.cancel) {
      h.cancel(ctx)
      e.preventDefault()
      editor.requestRender()
      return
    }
    if (h?.key?.(ctx, e.nativeEvent)) {
      e.preventDefault()
      e.stopPropagation()
      editor.requestRender()
    }
  }
  const onKeyUp = (e: React.KeyboardEvent): void => {
    if (e.key === ' ') {
      spaceRef.current.down = false
      spaceRef.current.pan = null
      setCursor(hoverRef.current)
    }
  }

  // 파일 드롭: 문서가 있으면 떨어뜨린 자리에 레이어로, 없으면 새 문서
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    const r = hostRef.current!.getBoundingClientRect()
    const at = ctx.toDoc(e.clientX - r.left, e.clientY - r.top)
    for (const f of Array.from(e.dataTransfer.files)) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (/\.shcomp$/i.test(f.name) || !editor.doc) await editor.busy(`${f.name} 여는 중…`, () => openBytes(f.name, bytes, /\.shcomp$/i.test(f.name) ? window.api.pathOf(f) : null))
      else await editor.busy(`${f.name} 가져오는 중…`, () => importAsLayer(bytes, f.name, at))
    }
  }

  const doc = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId)?.history.present ?? null)
  const v = view()

  return (
    <Box
      ref={hostRef}
      tabIndex={0}
      data-testid="canvas"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => {
        hoverRef.current = null
        setCursorInfo(null)
        clearHover()
        draw()
      }}
      onDoubleClick={(e) => toolInfo(editor.state.tool)?.handler.dbl?.(ctx, info(e as unknown as React.PointerEvent))}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
      sx={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', bgcolor: color.viewer, outline: 'none', touchAction: 'none' }}
    >
      <canvas ref={glRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <canvas ref={ovRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      {glError && <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', p: 4, textAlign: 'center' }}>{glError}</Box>}
      {draft && doc && (
        <Box
          component="textarea"
          autoFocus
          data-testid="text-editor"
          defaultValue={draft.data.text}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...draft, data: { ...draft.data, text: e.target.value } })}
          onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            e.stopPropagation()
            if (e.key === 'Escape') setDraft(null)
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              commitTextDraft({ ...draft, data: { ...draft.data, text: e.currentTarget.value } })
              setDraft(null)
            }
          }}
          onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => {
            commitTextDraft({ ...draft, data: { ...draft.data, text: e.currentTarget.value } })
            setDraft(null)
          }}
          sx={{
            position: 'absolute',
            left: v.panX + draft.box.x * v.zoom,
            top: v.panY + draft.box.y * v.zoom,
            width: draft.box.w * v.zoom,
            minHeight: draft.box.h * v.zoom,
            font: fontCss({ ...draft.data, size: draft.data.size * v.zoom }),
            lineHeight: draft.data.lineHeight,
            color: draft.data.color,
            textAlign: draft.data.align,
            background: 'rgba(255,255,255,0.08)',
            border: '1px dashed #2a8dd4',
            outline: 'none',
            resize: 'both',
            overflow: 'hidden',
            p: 0,
            m: 0,
            userSelect: 'text'
          }}
        />
      )}
    </Box>
  )
}
