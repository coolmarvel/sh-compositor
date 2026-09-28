/**
 * 펜 도구 (P) — 베지어 패스 그리기·고치기 (포토샵 펜 + 직접 선택의 단순판).
 *  - 클릭 = 꼭짓점 앵커, 끌기 = 곡선 앵커(대칭 핸들), 첫 앵커 클릭 = 닫기, Enter = 열린 채 끝내기, Esc = 취소, Backspace = 마지막 앵커 지우기
 *  - 앵커·핸들을 끌면 옮긴다 (Alt+핸들 = 한쪽만), Ctrl+클릭 앵커 = 곡선↔꼭짓점 바꾸기
 *  - 패스는 문서(`doc.paths`)에 저장되고 활성 패스는 store.activePathId. 결과는 패스 패널에서 선택·채우기·선·벡터 마스크로 쓴다.
 */
import { editor } from '../editor/store'
import { newPathId, type Doc, type DocPath, type PathAnchor, type SubPath } from '@core/index'
import type { ToolHandler, ToolCtx, Pt } from './types'

const HIT = 7
type Hit = { sp: number; a: number; part: 'anchor' | 'in' | 'out' }
let drag: { hit: Hit; start: Pt; orig: SubPath[]; newAnchor: boolean; alt: boolean } | null = null
let hover: Pt | null = null

function activePath(doc: Doc): DocPath | null {
  const id = editor.state.activePathId
  return doc.paths?.find((p) => p.id === id) ?? null
}
function setPath(doc: Doc, path: DocPath, label: string, gesture = false): void {
  const paths = doc.paths?.some((p) => p.id === path.id) ? doc.paths.map((p) => (p.id === path.id ? path : p)) : [...(doc.paths ?? []), path]
  const next = { ...doc, paths }
  if (gesture) editor.commitGesture(next, label)
  else editor.commit(next, label)
  if (editor.state.activePathId !== path.id) editor.set({ activePathId: path.id })
}
/** 열린 마지막 서브패스 (그리는 중) */
const openSub = (p: DocPath): number => (p.subpaths.length && !p.subpaths[p.subpaths.length - 1].closed ? p.subpaths.length - 1 : -1)

function hitTest(c: ToolCtx, p: DocPath, s: Pt): Hit | null {
  const near = (q: Pt | null | undefined): boolean => {
    if (!q) return false
    const t = c.toScreen(q.x, q.y)
    return Math.hypot(t.x - s.x, t.y - s.y) <= HIT
  }
  for (let sp = p.subpaths.length - 1; sp >= 0; sp--)
    for (let a = p.subpaths[sp].anchors.length - 1; a >= 0; a--) {
      const an = p.subpaths[sp].anchors[a]
      if (near(an.out)) return { sp, a, part: 'out' }
      if (near(an.in)) return { sp, a, part: 'in' }
      if (near(an)) return { sp, a, part: 'anchor' }
    }
  return null
}

function withAnchor(subs: SubPath[], hit: Hit, fn: (a: PathAnchor) => PathAnchor): SubPath[] {
  return subs.map((sp, i) => (i === hit.sp ? { ...sp, anchors: sp.anchors.map((a, k) => (k === hit.a ? fn(a) : a)) } : sp))
}

export const penTool: ToolHandler = {
  down(c, p) {
    const doc = c.doc()
    if (!doc) return
    let path = activePath(doc)
    const hit = path ? hitTest(c, path, p.s) : null
    if (path && hit) {
      const cur = path.subpaths[hit.sp]
      const oi = openSub(path)
      // 그리는 중인 서브패스의 첫 앵커를 다시 누르면 닫는다
      if (hit.part === 'anchor' && hit.sp === oi && hit.a === 0 && cur.anchors.length > 2) {
        setPath(doc, { ...path, subpaths: path.subpaths.map((sp, i) => (i === oi ? { ...sp, closed: true } : sp)) }, '패스 닫기')
        c.redraw()
        return
      }
      if (hit.part === 'anchor' && p.ctrl) {
        // 곡선 ↔ 꼭짓점
        const a = cur.anchors[hit.a]
        const toCorner = !!(a.in || a.out)
        const prev = cur.anchors[(hit.a - 1 + cur.anchors.length) % cur.anchors.length]
        const next = cur.anchors[(hit.a + 1) % cur.anchors.length]
        const dx = (next.x - prev.x) / 4
        const dy = (next.y - prev.y) / 4
        setPath(
          doc,
          { ...path, subpaths: withAnchor(path.subpaths, hit, (an) => (toCorner ? { x: an.x, y: an.y } : { ...an, in: { x: an.x - dx, y: an.y - dy }, out: { x: an.x + dx, y: an.y + dy } })) },
          '앵커 바꾸기'
        )
        c.redraw()
        return
      }
      drag = { hit, start: p.p, orig: path.subpaths, newAnchor: false, alt: p.alt }
      return
    }
    // 새 앵커
    if (!path) path = { id: newPathId(), name: `패스 ${(doc.paths?.length ?? 0) + 1}`, subpaths: [] }
    let subs = path.subpaths
    let oi = openSub(path)
    if (oi < 0) {
      subs = [...subs, { closed: false, anchors: [] }]
      oi = subs.length - 1
    }
    const anchor: PathAnchor = { x: p.p.x, y: p.p.y }
    subs = subs.map((sp, i) => (i === oi ? { ...sp, anchors: [...sp.anchors, anchor] } : sp))
    const next = { ...path, subpaths: subs }
    setPath(doc, next, '앵커 추가')
    drag = { hit: { sp: oi, a: subs[oi].anchors.length - 1, part: 'out' }, start: p.p, orig: subs, newAnchor: true, alt: false }
    c.redraw()
  },
  move(c, p, dragging) {
    hover = p.p
    if (!dragging || !drag) {
      c.redraw()
      return
    }
    const doc = c.doc()
    const path = doc && activePath(doc)
    if (!doc || !path) return
    const d = drag
    const dx = p.p.x - d.start.x
    const dy = p.p.y - d.start.y
    let subs: SubPath[]
    if (d.newAnchor) {
      // 새 앵커를 끌면 대칭 핸들 (끌지 않으면 꼭짓점)
      if (Math.hypot(dx, dy) < 2) return
      subs = withAnchor(d.orig, d.hit, (a) => ({ x: a.x, y: a.y, out: { x: a.x + dx, y: a.y + dy }, in: { x: a.x - dx, y: a.y - dy } }))
    } else if (d.hit.part === 'anchor') {
      subs = withAnchor(d.orig, d.hit, (a) => ({
        x: a.x + dx,
        y: a.y + dy,
        in: a.in ? { x: a.in.x + dx, y: a.in.y + dy } : a.in,
        out: a.out ? { x: a.out.x + dx, y: a.out.y + dy } : a.out
      }))
    } else {
      const part = d.hit.part
      subs = withAnchor(d.orig, d.hit, (a) => {
        const h = a[part]!
        const moved = { x: h.x + dx, y: h.y + dy }
        const other = part === 'in' ? 'out' : 'in'
        const o = a[other]
        // 반대 핸들은 같은 길이·반대 방향 (Alt 면 한쪽만)
        if (d.alt || !o) return { ...a, [part]: moved }
        const len = Math.hypot(o.x - a.x, o.y - a.y)
        const ang = Math.atan2(moved.y - a.y, moved.x - a.x) + Math.PI
        return { ...a, [part]: moved, [other]: { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len } }
      })
    }
    setPath(doc, { ...path, subpaths: subs }, d.newAnchor ? '앵커 추가' : '패스 고치기', true)
    c.redraw()
  },
  up() {
    editor.endGesture()
    drag = null
  },
  commit(c) {
    // Enter: 열린 채로 끝 (다음 클릭은 새 서브패스)
    const doc = c.doc()
    const path = doc && activePath(doc)
    if (doc && path && openSub(path) >= 0) {
      const oi = openSub(path)
      const sp = path.subpaths[oi]
      if (sp.anchors.length < 2) setPath(doc, { ...path, subpaths: path.subpaths.filter((_, i) => i !== oi) }, '패스')
      else editor.toast('info', '열린 패스로 두었습니다. 닫으려면 첫 앵커를 누르세요.')
    }
    finishOpen(doc)
    c.redraw()
  },
  cancel(c) {
    const doc = c.doc()
    const path = doc && activePath(doc)
    if (doc && path) {
      const oi = openSub(path)
      if (oi >= 0) setPath(doc, { ...path, subpaths: path.subpaths.filter((_, i) => i !== oi) }, '패스 취소')
    }
    drag = null
    c.redraw()
  },
  key(c, e) {
    const doc = c.doc()
    const path = doc && activePath(doc)
    if (e.key === 'Backspace' && doc && path) {
      const oi = openSub(path)
      if (oi < 0) return false
      const sp = path.subpaths[oi]
      const subs = sp.anchors.length <= 1 ? path.subpaths.filter((_, i) => i !== oi) : path.subpaths.map((s, i) => (i === oi ? { ...s, anchors: s.anchors.slice(0, -1) } : s))
      setPath(doc, { ...path, subpaths: subs }, '앵커 지우기')
      c.redraw()
      return true
    }
    return false
  },
  leave(c) {
    this.commit?.(c)
  },
  overlay(c, g) {
    const doc = c.doc()
    if (!doc?.paths?.length) return
    g.save()
    for (const path of doc.paths) {
      const active = path.id === editor.state.activePathId
      g.strokeStyle = active ? '#2a8dd4' : 'rgba(120,120,120,.7)'
      g.lineWidth = active ? 1.5 : 1
      for (const sp of path.subpaths) {
        if (!sp.anchors.length) continue
        g.beginPath()
        const first = c.toScreen(sp.anchors[0].x, sp.anchors[0].y)
        g.moveTo(first.x, first.y)
        const n = sp.closed ? sp.anchors.length : sp.anchors.length - 1
        for (let i = 0; i < n; i++) {
          const a = sp.anchors[i]
          const b = sp.anchors[(i + 1) % sp.anchors.length]
          const c1 = c.toScreen((a.out ?? a).x, (a.out ?? a).y)
          const c2 = c.toScreen((b.in ?? b).x, (b.in ?? b).y)
          const q = c.toScreen(b.x, b.y)
          g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, q.x, q.y)
        }
        if (sp.closed) g.closePath()
        g.stroke()
        // 그리는 중: 마지막 앵커 → 마우스까지 미리보기
        if (active && !sp.closed && hover && !drag && sp === path.subpaths[path.subpaths.length - 1]) {
          const last = sp.anchors[sp.anchors.length - 1]
          const l = c.toScreen(last.x, last.y)
          const h = c.toScreen(hover.x, hover.y)
          g.save()
          g.setLineDash([3, 3])
          g.beginPath()
          g.moveTo(l.x, l.y)
          g.lineTo(h.x, h.y)
          g.stroke()
          g.restore()
        }
        if (!active) continue
        for (const a of sp.anchors) {
          const s = c.toScreen(a.x, a.y)
          for (const h of [a.in, a.out]) {
            if (!h) continue
            const t = c.toScreen(h.x, h.y)
            g.strokeStyle = 'rgba(42,141,212,.7)'
            g.beginPath()
            g.moveTo(s.x, s.y)
            g.lineTo(t.x, t.y)
            g.stroke()
            g.fillStyle = '#fff'
            g.beginPath()
            g.arc(t.x, t.y, 3, 0, Math.PI * 2)
            g.fill()
            g.stroke()
          }
          g.strokeStyle = '#2a8dd4'
          g.fillStyle = '#fff'
          g.fillRect(Math.round(s.x) - 3, Math.round(s.y) - 3, 6, 6)
          g.strokeRect(Math.round(s.x) - 3 + 0.5, Math.round(s.y) - 3 + 0.5, 5, 5)
        }
      }
    }
    g.restore()
  },
  cursor(c, h) {
    const doc = c.doc()
    const path = doc && activePath(doc)
    if (path && h && hitTest(c, path, h.s)) return 'move'
    return 'crosshair'
  }
}

function finishOpen(doc: Doc | null): void {
  void doc
  drag = null
}
export function hasOpenPath(): boolean {
  const doc = editor.doc
  const p = doc && activePath(doc)
  return !!p && openSub(p) >= 0
}
