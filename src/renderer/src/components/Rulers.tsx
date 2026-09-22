import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import { editor, useEditor } from '../editor/store'
import { useCursor } from '../editor/cursor'
import type { Axis } from '../editor/guides'
import { ui } from '../theme'

const { color, chrome, font } = ui
export const RULER = 18

/** 배율에 맞는 눈금 간격 (문서 px) — 큰 눈금 사이가 화면에서 60px 이상 */
function step(zoom: number): number {
  const want = 60 / zoom
  const p = Math.pow(10, Math.floor(Math.log10(want)))
  for (const m of [1, 2, 5, 10]) if (p * m >= want) return p * m
  return p * 10
}

/**
 * 눈금자 한 줄 (위 = 가로 눈금, 왼쪽 = 세로 눈금). 문서 px 단위, 캔버스와 같은 보기를 따라 움직인다.
 * 눌러 끌면 안내선이 생긴다 (onStart). 커서 위치는 작은 표시로.
 */
export function Ruler({ axis, onStart }: { axis: 'top' | 'left'; onStart: (axis: Axis, e: React.PointerEvent) => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const view = useEditor((s) => s.tabs.find((t) => t.id === s.activeTabId)?.view ?? null)
  const cursor = useCursor()
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth
    const h = cv.clientHeight
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    }
    const g = cv.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.fillStyle = getComputedStyle(cv).getPropertyValue('--ruler-bg') || '#f1f2f4'
    g.fillRect(0, 0, w, h)
    if (!view) return
    const top = axis === 'top'
    const len = top ? w : h
    const pan = top ? view.panX : view.panY
    const st = step(view.zoom)
    const minor = st / (String(st)[0] === '5' ? 5 : 10)
    const from = Math.floor(-pan / view.zoom / minor) * minor
    const to = (len - pan) / view.zoom
    g.strokeStyle = '#8a919e'
    g.fillStyle = '#5c6370'
    g.font = `10px ${getComputedStyle(document.body).fontFamily}`
    g.lineWidth = 1
    g.beginPath()
    for (let v = from; v <= to; v += minor) {
      const s = Math.round(pan + v * view.zoom) + 0.5
      const major = Math.abs(v / st - Math.round(v / st)) < 1e-6
      const half = !major && Math.abs((v * 2) / st - Math.round((v * 2) / st)) < 1e-6
      const tick = major ? RULER : half ? 7 : 4
      if (top) {
        g.moveTo(s, RULER)
        g.lineTo(s, RULER - tick)
      } else {
        g.moveTo(RULER, s)
        g.lineTo(RULER - tick, s)
      }
      if (major) {
        const label = String(Math.round(v))
        if (top) g.fillText(label, s + 2, 9)
        else {
          g.save()
          g.translate(9, s + 2)
          g.rotate(-Math.PI / 2)
          g.textAlign = 'right'
          g.fillText(label, 0, 0)
          g.restore()
        }
      }
    }
    g.stroke()
    // 경계선
    g.strokeStyle = '#b5b9c2'
    g.beginPath()
    if (top) {
      g.moveTo(0, RULER - 0.5)
      g.lineTo(w, RULER - 0.5)
    } else {
      g.moveTo(RULER - 0.5, 0)
      g.lineTo(RULER - 0.5, h)
    }
    g.stroke()
    // 커서 위치
    if (cursor) {
      const s = Math.round(pan + (top ? cursor.x : cursor.y) * view.zoom) + 0.5
      g.strokeStyle = color.accent
      g.beginPath()
      if (top) {
        g.moveTo(s, 0)
        g.lineTo(s, RULER)
      } else {
        g.moveTo(0, s)
        g.lineTo(RULER, s)
      }
      g.stroke()
    }
  })
  return (
    <Box
      component="canvas"
      ref={ref}
      data-testid={`ruler-${axis}`}
      title="끌어서 안내선 만들기"
      onPointerDown={(e: React.PointerEvent) => {
        if (!editor.doc) return
        onStart(axis === 'top' ? 'h' : 'v', e)
      }}
      sx={{
        display: 'block',
        width: '100%',
        height: '100%',
        cursor: axis === 'top' ? 'row-resize' : 'col-resize',
        borderRight: axis === 'left' ? `1px solid ${chrome.frame}` : 'none',
        borderBottom: axis === 'top' ? `1px solid ${chrome.frame}` : 'none',
        fontSize: font.xs
      }}
    />
  )
}
