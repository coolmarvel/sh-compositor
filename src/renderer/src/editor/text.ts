/**
 * 문자 레이어 렌더링 — Compositor `TypeTool`/`InlineTextEditor`: 문단 상자 폭으로 줄바꿈, 글꼴·크기·색·정렬·줄 간격·자간.
 * 픽셀은 이 데이터로 언제든 다시 그린다(레이어에 text 를 보관) → 문자 도구로 클릭하면 다시 편집.
 */
import type { Bitmap, TextData } from '@core/index'

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

/** 상자 폭으로 줄바꿈 (한글은 글자 단위, 영문은 단어 단위) */
export function wrapLines(ctx: OffscreenCanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    const tokens = para.match(/[A-Za-z0-9]+|\s+|./gu) ?? ['']
    for (const tk of tokens) {
      const next = line + tk
      if (line && ctx.measureText(next).width > width) {
        out.push(line.trimEnd())
        line = tk.trimStart()
      } else line = next
    }
    out.push(line)
  }
  return out
}

/** 문자 데이터 → 비트맵 (상자 크기 = 비트맵 크기) */
export function renderText(t: TextData): Bitmap {
  const w = Math.max(1, Math.ceil(t.boxWidth))
  const measure = new OffscreenCanvas(1, 1).getContext('2d')!
  measure.font = fontCss(t)
  ;(measure as unknown as { letterSpacing: string }).letterSpacing = `${(t.tracking / 1000) * t.size}px`
  const lines = wrapLines(measure, t.text, w)
  const lh = t.size * t.lineHeight
  const h = Math.max(1, Math.ceil(Math.max(t.boxHeight, lines.length * lh + t.size * 0.3)))
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')!
  g.font = fontCss(t)
  ;(g as unknown as { letterSpacing: string }).letterSpacing = `${(t.tracking / 1000) * t.size}px`
  g.fillStyle = t.color
  g.textBaseline = 'alphabetic'
  g.textAlign = t.align
  const x = t.align === 'left' ? 0 : t.align === 'center' ? w / 2 : w
  lines.forEach((ln, i) => g.fillText(ln, x, t.size + i * lh))
  return { width: w, height: h, data: g.getImageData(0, 0, w, h).data }
}
