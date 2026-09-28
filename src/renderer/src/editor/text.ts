/**
 * 문자 레이어 렌더링 — Compositor `TypeTool`/`InlineTextEditor`: 문단 상자 폭으로 줄바꿈, 글꼴·크기·색·정렬·줄 간격·자간.
 * 픽셀은 이 데이터로 언제든 다시 그린다(레이어에 text 를 보관) → 문자 도구로 클릭하면 다시 편집.
 * v1.2: 글자별 서식(`runs`) — 구간마다 굵게·기울임·색·크기·글꼴. 줄 높이는 그 줄에서 가장 큰 글자 기준.
 */
import { segments, type Bitmap, type TextData, type RunStyle } from '@core/index'

export const DEFAULT_TEXT: Omit<TextData, 'text' | 'boxWidth' | 'boxHeight'> = {
  font: 'Malgun Gothic',
  size: 48,
  color: '#000000',
  bold: false,
  italic: false,
  align: 'left',
  lineHeight: 1.25,
  tracking: 0
}

export const fontCss = (t: Pick<TextData, 'font' | 'size' | 'bold' | 'italic'>): string => `${t.italic ? 'italic ' : ''}${t.bold ? '700 ' : '400 '}${t.size}px "${t.font}", "Malgun Gothic", sans-serif`

/** 구간 서식을 기본값 위에 얹은 글꼴 정보 */
const styled = (t: TextData, s: RunStyle): Pick<TextData, 'font' | 'size' | 'bold' | 'italic' | 'color'> => ({
  font: s.font ?? t.font,
  size: s.size ?? t.size,
  bold: s.bold ?? t.bold,
  italic: s.italic ?? t.italic,
  color: s.color ?? t.color
})

type Piece = { text: string; style: Pick<TextData, 'font' | 'size' | 'bold' | 'italic' | 'color'>; width: number }

function setFont(ctx: OffscreenCanvasRenderingContext2D, t: TextData, st: Piece['style']): void {
  ctx.font = fontCss(st)
  ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${(t.tracking / 1000) * st.size}px`
}

/** 한 문단을 상자 폭으로 줄바꿈 — 각 줄은 서식 조각 목록 (한글은 글자 단위, 영문은 단어 단위) */
function layoutParagraph(ctx: OffscreenCanvasRenderingContext2D, t: TextData, para: string, offset: number, width: number): Piece[][] {
  const lines: Piece[][] = []
  let line: Piece[] = []
  let lineW = 0
  const push = (piece: Piece): void => {
    const last = line[line.length - 1]
    if (last && last.style === piece.style) {
      last.text += piece.text
      last.width += piece.width
    } else line.push(piece)
    lineW += piece.width
  }
  const measure = (text: string, st: Piece['style']): number => {
    setFont(ctx, t, st)
    return ctx.measureText(text).width
  }
  for (const seg of segments(para, t.runs, offset, offset + para.length)) {
    const st = styled(t, seg.style)
    const chunk = para.slice(seg.start - offset, seg.end - offset)
    const tokens = chunk.match(/[A-Za-z0-9]+|\s+|./gu) ?? []
    for (const tk of tokens) {
      const w = measure(tk, st)
      if (line.length && lineW + w > width && !/^\s+$/.test(tk)) {
        // 줄 끝 공백 정리
        const l = line[line.length - 1]
        l.text = l.text.trimEnd()
        l.width = measure(l.text, l.style)
        lines.push(line)
        line = []
        lineW = 0
        const lead = tk.trimStart()
        if (lead) push({ text: lead, style: st, width: measure(lead, st) })
      } else push({ text: tk, style: st, width: w })
    }
  }
  lines.push(line)
  return lines
}

/** 세로쓰기: 상자 높이로 단을 나눈다 (글자 단위, 글자별 서식은 색·크기·굵기만) */
function renderVertical(t: TextData): Bitmap {
  const colW = t.size * t.lineHeight
  const step = t.size * (1 + t.tracking / 1000)
  const maxH = Math.max(t.size, t.boxHeight)
  const perCol = Math.max(1, Math.floor(maxH / step))
  const cols: { ch: string; st: Piece['style'] }[][] = []
  let offset = 0
  for (const para of t.text.split('\n')) {
    const chars: { ch: string; st: Piece['style'] }[] = []
    for (const seg of segments(para, t.runs, offset, offset + para.length)) {
      const st = styled(t, seg.style)
      for (const ch of Array.from(para.slice(seg.start - offset, seg.end - offset))) chars.push({ ch, st })
    }
    offset += para.length + 1
    if (!chars.length) cols.push([])
    for (let i = 0; i < chars.length; i += perCol) cols.push(chars.slice(i, i + perCol))
  }
  const w = Math.max(1, Math.ceil(Math.max(t.boxWidth, cols.length * colW + t.size * 0.2)))
  const h = Math.max(1, Math.ceil(maxH))
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.textAlign = 'center'
  g.textBaseline = 'top'
  cols.forEach((col, ci) => {
    const x = w - (ci + 0.5) * colW
    const used = col.length * step
    const y0 = t.align === 'center' ? (h - used) / 2 : t.align === 'right' ? h - used : 0 // 세로쓰기에서 정렬 = 위·가운데·아래
    col.forEach(({ ch, st }, i) => {
      g.font = fontCss(st)
      g.fillStyle = st.color
      g.fillText(ch, x, y0 + i * step)
    })
  })
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data }
}

/** 문자 데이터 → 비트맵 (상자 크기 = 비트맵 크기) */
export function renderText(t: TextData): Bitmap {
  if (t.vertical) return renderVertical(t)
  const w = Math.max(1, Math.ceil(t.boxWidth))
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!
  const lines: Piece[][] = []
  let offset = 0
  for (const para of t.text.split('\n')) {
    lines.push(...layoutParagraph(measure, t, para, offset, w))
    offset += para.length + 1
  }
  // 줄 높이 = 그 줄에서 가장 큰 글자 × 줄 간격 (빈 줄은 기본 크기)
  const heights = lines.map((ln) => Math.max(t.size, ...ln.map((p) => p.style.size)) * t.lineHeight)
  const total = heights.reduce((a, b) => a + b, 0)
  const h = Math.max(1, Math.ceil(Math.max(t.boxHeight, total + t.size * 0.3)))
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'
  let y = 0
  lines.forEach((ln, i) => {
    const lh = heights[i]
    const ascent = Math.max(t.size, ...ln.map((p) => p.style.size))
    const width = ln.reduce((a, p) => a + p.width, 0)
    let x = t.align === 'left' ? 0 : t.align === 'center' ? (w - width) / 2 : w - width
    for (const p of ln) {
      setFont(g, t, p.style)
      g.fillStyle = p.style.color
      g.fillText(p.text, x, y + ascent)
      x += p.width
    }
    y += lh
  })
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data }
}
