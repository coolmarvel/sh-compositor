/**
 * 개체 선택 도구 (포토샵 Object Selection) — 사각형이나 올가미로 개체를 넉넉히 감싸면 AI 가 테두리에 딱 맞게 잡는다.
 *  - 끌기(사각/올가미) = 새 개체 · Shift+끌기 = 더하기 · Alt+끌기 = 빼기
 *  - 클릭 = 그 자리 개체 · Shift+클릭 = 방금 잡은 개체에 여기도 포함 · Alt+클릭 = 여기는 빼기
 *  - 옵션 줄: 테두리 확장/축소 · 부드럽게 (방금 잡은 개체에 바로 적용)
 */
import { editor } from '../editor/store'
import { selectObject, refineObject, objectSession, endObjectSession, paintSelect } from '../editor/objectSelect'
import { antsStroke, type ToolHandler, type Pt } from './types'

let drag: { start: Pt; cur: Pt; pts: Pt[]; mode: 'replace' | 'add' | 'subtract'; s0: Pt; far: number } | null = null
let running = false

const modeOf = (p: { shift: boolean; alt: boolean }): 'replace' | 'add' | 'subtract' => (p.shift ? 'add' : p.alt ? 'subtract' : 'replace')

export const objectSelectTool: ToolHandler = {
  down(_c, p) {
    if (running) return
    drag = { start: p.p, cur: p.p, pts: [p.p], mode: modeOf(p), s0: p.s, far: 0 }
  },
  move(c, p, dragging) {
    if (!dragging || !drag) return
    drag.cur = p.p
    // 올가미는 시작점으로 돌아와 끝나므로 '끝-시작' 거리가 아니라 가장 멀리 간 거리로 클릭/끌기를 가른다
    drag.far = Math.max(drag.far, Math.hypot(p.s.x - drag.s0.x, p.s.y - drag.s0.y))
    if (editor.state.settings.objectMode !== 'rect') drag.pts.push(p.p)
    c.redraw()
  },
  up(c, p) {
    const d = drag
    drag = null
    c.redraw()
    if (!d || running) return
    const doc = c.doc()
    if (!doc) return
    const moved = Math.max(d.far, Math.hypot(p.s.x - d.s0.x, p.s.y - d.s0.y))
    running = true
    const done = (): void => {
      running = false
      c.redraw()
    }
    // 칠해서 잡기: 문지른 자리(클릭도 한 점) — 그냥 칠하면 이어서 넓히고, Alt 면 빼기
    if (editor.state.settings.objectMode === 'paint') {
      void paintSelect(d.pts.length ? d.pts : [p.p], !p.alt, false).finally(done)
      return
    }
    if (moved < 4) {
      // 클릭: 개체가 잡혀 있으면 Shift/Alt 로 다듬기, 아니면 그 자리 개체
      if (objectSession() && (p.shift || p.alt)) void refineObject(p.p, p.shift).finally(done)
      else void selectObject({ point: p.p, mode: d.mode }).finally(done)
      return
    }
    const poly =
      editor.state.settings.objectMode === 'lasso'
        ? d.pts
        : [
            { x: Math.min(d.start.x, p.p.x), y: Math.min(d.start.y, p.p.y) },
            { x: Math.max(d.start.x, p.p.x), y: Math.min(d.start.y, p.p.y) },
            { x: Math.max(d.start.x, p.p.x), y: Math.max(d.start.y, p.p.y) },
            { x: Math.min(d.start.x, p.p.x), y: Math.max(d.start.y, p.p.y) }
          ]
    void selectObject({ polygon: poly, mode: d.mode }).finally(done)
  },
  cancel(c) {
    drag = null
    endObjectSession()
    c.redraw()
  },
  leave() {
    endObjectSession()
  },
  overlay(c, g) {
    const s = objectSession()
    // 다듬기 점 (초록 = 포함, 빨강 = 빼기) — 작은 해상도 좌표라 문서로 되돌린다. 영역 바깥 자동 음성 점은 안 그린다
    if (s && !drag) {
      const dot = (q: Pt, on: boolean): void => {
        const sp = c.toScreen(q.x / s.k, q.y / s.k)
        g.fillStyle = on ? '#2fb344' : '#e03131'
        g.strokeStyle = '#fff'
        g.lineWidth = 2
        g.beginPath()
        g.arc(sp.x, sp.y, 5, 0, Math.PI * 2)
        g.fill()
        g.stroke()
      }
      s.pos.forEach((q) => dot(q, true))
      if (!s.region) s.neg.forEach((q) => dot(q, false))
    }
    if (!drag) return
    const a = c.toScreen(drag.start.x, drag.start.y)
    const b = c.toScreen(drag.cur.x, drag.cur.y)
    antsStroke(g, () => {
      g.beginPath()
      if (editor.state.settings.objectMode === 'paint') {
        g.save()
        g.lineWidth = 12
        g.lineCap = 'round'
        g.lineJoin = 'round'
        g.strokeStyle = drag!.mode === 'subtract' ? 'rgba(224,49,49,0.5)' : 'rgba(47,179,68,0.5)'
        g.beginPath()
        drag!.pts.forEach((q, i) => {
          const s2 = c.toScreen(q.x, q.y)
          if (i) g.lineTo(s2.x, s2.y)
          else g.moveTo(s2.x, s2.y)
        })
        g.stroke()
        g.restore()
        return
      }
      if (editor.state.settings.objectMode === 'lasso') {
        drag!.pts.forEach((q, i) => {
          const s2 = c.toScreen(q.x, q.y)
          if (i) g.lineTo(s2.x, s2.y)
          else g.moveTo(s2.x, s2.y)
        })
      } else g.rect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    })
  },
  cursor: () => (running ? 'progress' : 'crosshair')
}
