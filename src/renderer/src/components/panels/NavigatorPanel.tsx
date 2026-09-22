import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Slider from '@mui/material/Slider'
import ButtonBase from '@mui/material/ButtonBase'
import ZoomInRounded from '@mui/icons-material/ZoomInRounded'
import ZoomOutRounded from '@mui/icons-material/ZoomOutRounded'
import { editor, useEditor, useDoc } from '../../editor/store'
import { docThumbnail, runCommand } from '../../editor/commands'
import { ui } from '../../theme'

const { color, space } = ui

/**
 * 내비게이터 — 문서 축소본 위에 지금 보고 있는 영역(빨간 상자). 상자를 끌면 화면이 따라가고, 아래 막대로 배율을 바꾼다
 * (포토샵 Navigator 패널). 축소본은 GPU 합성 결과를 줄여 받으므로 큰 문서도 가볍다.
 */
export default function NavigatorPanel(): JSX.Element {
  const doc = useDoc()
  const view = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId)?.view ?? null)
  const boxRef = useRef<HTMLDivElement>(null)
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 240, h: 160 })

  // 패널 크기
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 축소본 — 문서가 바뀌면 잠시 뒤에 (끄는 중엔 렌더러가 null 을 주므로 다음 번에)
  const [thumb, setThumb] = useState<ImageData | null>(null)
  useEffect(() => {
    if (!doc) return setThumb(null)
    let tries = 0
    let t: ReturnType<typeof setTimeout>
    const load = (): void => {
      const im = docThumbnail(Math.max(size.w, size.h))
      if (im) setThumb(im)
      else if (++tries < 20) t = setTimeout(load, 300)
    }
    t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [doc, size.w, size.h])

  // 그리기
  const fit = doc ? Math.min((size.w - 8) / doc.width, (size.h - 8) / doc.height) : 1
  const ox = doc ? (size.w - doc.width * fit) / 2 : 0
  const oy = doc ? (size.h - doc.height * fit) / 2 : 0
  useEffect(() => {
    const cv = cvRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = color.viewer
    g.fillRect(0, 0, size.w, size.h)
    if (!doc) return
    // 투명 체커
    const W = doc.width * fit
    const H = doc.height * fit
    for (let y = 0; y < H; y += 6)
      for (let x = 0; x < W; x += 6) {
        g.fillStyle = ((x + y) / 6) % 2 ? '#3a3d45' : '#2a2c32'
        g.fillRect(ox + x, oy + y, Math.min(6, W - x), Math.min(6, H - y))
      }
    if (thumb) {
      const tmp = document.createElement('canvas')
      tmp.width = thumb.width
      tmp.height = thumb.height
      tmp.getContext('2d')!.putImageData(thumb, 0, 0)
      g.imageSmoothingQuality = 'high'
      g.drawImage(tmp, ox, oy, W, H)
    }
    if (view?.cw && view.ch) {
      const x = ox + (-view.panX / view.zoom) * fit
      const y = oy + (-view.panY / view.zoom) * fit
      const w = (view.cw / view.zoom) * fit
      const h = (view.ch / view.zoom) * fit
      g.strokeStyle = '#e03131'
      g.lineWidth = 2
      g.strokeRect(Math.round(x) + 1, Math.round(y) + 1, Math.round(w) - 2, Math.round(h) - 2)
    }
  }, [doc, thumb, view, size, fit, ox, oy])

  // 빨간 상자 끌기 → 그 자리가 화면 가운데로
  const panTo = (e: React.PointerEvent): void => {
    if (!doc || !view?.cw || !view.ch) return
    const r = e.currentTarget.getBoundingClientRect()
    const dx = (e.clientX - r.left - ox) / fit
    const dy = (e.clientY - r.top - oy) / fit
    editor.setView({ ...view, fit: false, panX: Math.round(view.cw / 2 - dx * view.zoom), panY: Math.round(view.ch / 2 - dy * view.zoom) })
  }
  const zoomTo = (z: number): void => {
    if (!doc || !view?.cw || !view.ch) return
    const cx = (view.cw / 2 - view.panX) / view.zoom
    const cy = (view.ch / 2 - view.panY) / view.zoom
    editor.setView({ ...view, fit: false, zoom: z, panX: Math.round(view.cw / 2 - cx * z), panY: Math.round(view.ch / 2 - cy * z) })
  }
  const zoom = view?.zoom ?? 1
  const toSlider = (z: number): number => Math.log2(z)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }} aria-label="내비게이터">
      <Box ref={boxRef} sx={{ flex: 1, minHeight: 60, position: 'relative' }}>
        <Box
          component="canvas"
          ref={cvRef}
          data-testid="navigator"
          onPointerDown={(e: React.PointerEvent<HTMLCanvasElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            panTo(e)
          }}
          onPointerMove={(e: React.PointerEvent<HTMLCanvasElement>) => e.buttons & 1 && panTo(e)}
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'move' }}
        />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: `${space.sm}px`, px: `${space.sm}px`, height: 26, flexShrink: 0, borderTop: `1px solid ${color.border}` }}>
        <Box component="span" className="tnum" sx={{ width: 44, textAlign: 'right' }}>
          {Math.round(zoom * 1000) / 10}%
        </Box>
        <ButtonBase aria-label="축소" onClick={() => runCommand('zoomOut')} sx={{ '& svg': { fontSize: 16 } }}>
          <ZoomOutRounded />
        </ButtonBase>
        <Slider size="small" aria-label="배율" min={toSlider(0.02)} max={toSlider(32)} step={0.01} value={toSlider(zoom)} onChange={(_, v) => zoomTo(Math.pow(2, v as number))} sx={{ flex: 1 }} />
        <ButtonBase aria-label="확대" onClick={() => runCommand('zoomIn')} sx={{ '& svg': { fontSize: 16 } }}>
          <ZoomInRounded />
        </ButtonBase>
      </Box>
    </Box>
  )
}
