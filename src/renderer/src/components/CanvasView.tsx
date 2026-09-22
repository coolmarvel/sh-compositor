import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import { GLRenderer, type View } from '../gl/GLRenderer'
import { fitView, adaptView, nextZoom } from '../editor/view'
export { fitView }
import { editor, useEditor } from '../editor/store'
import { toolInfo } from '../tools'
import { moveTool } from '../tools/move'
import { drawSelection } from '../tools/select'
import { typeTool, commitTextDraft, type TextDraft, zoomAt } from '../tools/misc'
import { clearHover } from '../tools/paint'
import { importAsLayer, openBytes, keepsPath } from '../editor/io'
import { fontCss } from '../editor/text'
import type { ToolCtx, PointerInfo, ToolHandler } from '../tools/types'
import { registerCommands, registerThumbnail } from '../editor/commands'
import { Ruler, RULER } from './Rulers'
import { guidesOf, hitGuide, addGuide, moveGuide, removeGuide, type Axis } from '../editor/guides'
import { setCursor as setCursorInfo } from '../editor/cursor'
import { ui } from '../theme'

const { color } = ui
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]

/** Ctrl 에 제 뜻이 있는 도구 — 이 도구들에선 Ctrl+끌기가 임시 이동이 아니다 */
const CTRL_OWN = new Set(['move', 'marquee', 'lasso', 'wand', 'crop', 'hand', 'zoom', 'eyedropper'])

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
  /** 끌고 있는 안내선 (index −1 = 눈금자에서 새로) */
  const guideDrag = useRef<{ axis: Axis; index: number; pos: number } | null>(null)
  /** 이번 끌기를 맡은 도구 (Ctrl 임시 이동이면 이동 도구) */
  const gestureHandler = useRef<ToolHandler | null>(null)
  const hoverRef = useRef<PointerInfo | null>(null)
  const spaceRef = useRef<{ down: boolean; pan: { sx: number; sy: number; px: number; py: number } | null }>({ down: false, pan: null })
  const [draft, setDraft] = useState<TextDraft | null>(null)
  const [glError, setGlError] = useState<string | null>(null)
  const tool = useEditor((s) => s.tool)
  const showRulers = useEditor((s) => s.settings.showRulers && s.tabs.length > 0)
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
    redraw: () => requestDraw(),
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
    const doc = editor.shownDoc
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
      // 안내선 (청록 1px) + 끌고 있는 안내선
      if (editor.state.settings.showGuides || guideDrag.current) {
        const gd = guidesOf(doc)
        g.strokeStyle = '#00b4d8'
        g.lineWidth = 1
        g.beginPath()
        const vline = (x: number): void => {
          const s = Math.round(v.panX + x * v.zoom) + 0.5
          g.moveTo(s, 0)
          g.lineTo(s, ch)
        }
        const hline = (y: number): void => {
          const s = Math.round(v.panY + y * v.zoom) + 0.5
          g.moveTo(0, s)
          g.lineTo(cw, s)
        }
        const gdr = guideDrag.current
        if (editor.state.settings.showGuides) {
          gd.v.forEach((x, i) => !(gdr && gdr.axis === 'v' && gdr.index === i) && vline(x))
          gd.h.forEach((y, i) => !(gdr && gdr.axis === 'h' && gdr.index === i) && hline(y))
        }
        if (gdr && Number.isFinite(gdr.pos)) (gdr.axis === 'v' ? vline : hline)(gdr.pos)
        g.stroke()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 그리기 예약 — 한 프레임에 여러 번 요청돼도(붓질의 합쳐진 포인터 이벤트·스토어 변경) 한 번만 그린다
  const drawRaf = useRef(0)
  const requestDraw = useCallback(() => {
    if (drawRaf.current) return
    drawRaf.current = requestAnimationFrame(() => {
      drawRaf.current = 0
      draw()
    })
  }, [draw])

  // 렌더러 생성
  useEffect(() => {
    try {
      rendererRef.current = new GLRenderer(glRef.current!)
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e))
    }
    registerThumbnail((m) => rendererRef.current?.thumbnail(m) ?? null)
    const ro = new ResizeObserver(() => draw())
    ro.observe(hostRef.current!)
    return () => {
      ro.disconnect()
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [draw])

  // 문서·보기·미리보기가 바뀌면 다시 그림
  useEffect(() => editor.subscribe(requestDraw), [requestDraw])

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

  // 상태 줄 좌표·색 — 좌표는 바로, 색은 마우스가 멈췄을 때만 GPU 에서 읽는다
  // (readPixels 는 GPU 가 끝날 때까지 기다리게 해서 끄는 중에 읽으면 프레임마다 멈칫한다 — 2026-09-21 프로파일)
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportCursor = (pt: { x: number; y: number }): void => {
    const d = editor.doc
    if (!d) return setCursorInfo(null)
    const x = Math.floor(pt.x)
    const y = Math.floor(pt.y)
    const inside = x >= 0 && y >= 0 && x < d.width && y < d.height
    setCursorInfo({ x, y, rgba: null })
    if (colorTimer.current) clearTimeout(colorTimer.current)
    if (!inside || dragging.current) return
    colorTimer.current = setTimeout(() => {
      colorTimer.current = null
      if (dragging.current || editor.doc !== d) return
      setCursorInfo({ x, y, rgba: rendererRef.current?.readPixel(x, y) ?? null })
    }, 120)
  }

  const setCursor = (p: PointerInfo | null): void => {
    const host = hostRef.current
    if (!host) return
    if (spaceRef.current.down) host.style.cursor = spaceRef.current.pan ? 'grabbing' : 'grab'
    else {
      const d = editor.doc
      const hg = p && d && editor.state.tool === 'move' ? hitGuide(d, p.s.x, p.s.y, ctx.toScreen) : null
      host.style.cursor = hg ? (hg.axis === 'v' ? 'col-resize' : 'row-resize') : (toolInfo(editor.state.tool)?.handler.cursor?.(ctx, p) ?? 'default')
    }
  }

  /** 안내선 끌기 — 창 전체에서 포인터를 따라간다 (눈금자에서 시작하면 캔버스로 들어와야 생긴다) */
  const startGuideDrag = (axis: Axis, index: number, e: React.PointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    guideDrag.current = { axis, index, pos: NaN }
    const move = (ev: PointerEvent): void => {
      const r = hostRef.current!.getBoundingClientRect()
      const p = ctx.toDoc(ev.clientX - r.left, ev.clientY - r.top)
      let pos = axis === 'v' ? p.x : p.y
      if (!ev.shiftKey) pos = Math.round(pos) // Shift = 소수점 위치 허용
      guideDrag.current = { axis, index, pos }
      requestDraw()
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const g = guideDrag.current
      guideDrag.current = null
      const r = hostRef.current!.getBoundingClientRect()
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      if (g && Number.isFinite(g.pos) && inside) {
        if (g.index < 0) addGuide(g.axis, g.pos)
        else moveGuide(g.axis, g.index, g.pos, false)
      } else if (g && g.index >= 0 && !inside) removeGuide(g.axis, g.index) // 눈금자·창 밖으로 끌어 내면 지운다
      requestDraw()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onDown = (e: React.PointerEvent): void => {
    if (!editor.doc || draft) return
    // preventScroll: 포커스가 화면을 스크롤해 캔버스가 메뉴 밑으로 밀려 올라가던 사고 방지 (2026-09-21)
    hostRef.current!.focus({ preventScroll: true })
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const p = info(e)
    if (spaceRef.current.down || e.button === 1) {
      const v = view()
      spaceRef.current.pan = { sx: p.s.x, sy: p.s.y, px: v.panX, py: v.panY }
      setCursor(p)
      return
    }
    if (e.button !== 0) return
    // 이동 도구(또는 Ctrl)로 안내선을 잡으면 안내선을 옮긴다
    if (editor.state.tool === 'move' || e.ctrlKey) {
      const hg = hitGuide(editor.doc, p.s.x, p.s.y, ctx.toScreen)
      if (hg) return startGuideDrag(hg.axis, hg.index, e)
    }
    dragging.current = true
    // Ctrl+끌기 = 임시 이동 도구 (포토샵과 같음) — 선택·자르기·손·돋보기처럼 Ctrl 에 제 뜻이 있는 도구는 제외
    gestureHandler.current = e.ctrlKey && !CTRL_OWN.has(editor.state.tool) ? moveTool : (toolInfo(editor.state.tool)?.handler ?? null)
    // 낮은 해상도 합성은 큰 레이어를 끌 때만 (붓질은 바뀐 영역만 다시 그리므로 필요 없고, 손을 뗄 때 전체를 다시 그리게 된다)
    if (rendererRef.current && editor.state.settings.fastInteract && gestureHandler.current === moveTool) rendererRef.current.interactive = true
    if (rendererRef.current) rendererRef.current.gesture = true
    gestureHandler.current?.down?.(ctx, p)
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
    const h = (dragging.current && gestureHandler.current) || toolInfo(editor.state.tool)?.handler
    for (const ev of events) h?.move?.(ctx, info(ev), dragging.current)
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
    if (rendererRef.current) {
      rendererRef.current.interactive = false
      rendererRef.current.gesture = false
    }
    ;(gestureHandler.current ?? toolInfo(editor.state.tool)?.handler)?.up?.(ctx, info(e))
    gestureHandler.current = null
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
      // 프로젝트·PSD 는 새 탭으로, 이미지는 (문서가 있으면) 레이어로
      if (/\.(shcomp|psd|psb)$/i.test(f.name) || !editor.doc) await editor.busy(`${f.name} 여는 중…`, () => openBytes(f.name, bytes, keepsPath(f.name) ? window.api.pathOf(f) : null))
      else await editor.busy(`${f.name} 가져오는 중…`, () => importAsLayer(bytes, f.name, at))
    }
  }

  const doc = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId)?.history.present ?? null)
  const v = view()

  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'grid',
        // minmax(0, 1fr): 칸이 내용 때문에 창보다 커지지 않게 (커지면 화면 전체가 스크롤된다)
        gridTemplateColumns: showRulers ? `${RULER}px minmax(0, 1fr)` : 'minmax(0, 1fr)',
        gridTemplateRows: showRulers ? `${RULER}px minmax(0, 1fr)` : 'minmax(0, 1fr)',
        bgcolor: color.viewer
      }}
    >
      {showRulers && (
        <>
          <Box sx={{ bgcolor: '#f1f2f4', borderRight: '1px solid #b5b9c2', borderBottom: '1px solid #b5b9c2' }} />
          <Ruler axis="top" onStart={(a, e) => startGuideDrag(a, -1, e)} />
          <Ruler axis="left" onStart={(a, e) => startGuideDrag(a, -1, e)} />
        </>
      )}
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
                // 확정하면 바로 이동·변형할 수 있게 이동 도구로 (핸들이 곧바로 보인다)
                editor.setTool('move')
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
              writingMode: draft.data.vertical ? 'vertical-rl' : 'horizontal-tb',
              letterSpacing: `${(draft.data.tracking / 1000) * draft.data.size * v.zoom}px`,
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
    </Box>
  )
}
