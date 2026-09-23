/** 이미지·캔버스 명령 — 크기·자르기·캔버스 크기·회전·반전·투명 여백·병합·안내선 */
import type { Doc } from '../../core/doc/types'
import { resizeImage, cropDoc, resizeCanvas, rotateCanvas90, flipCanvas, flattenImage } from '../../core/doc/ops'
import { canvasTarget, anchorOffset, ANCHORS, CONTENT_FILL, type Anchor } from '../../core/canvassize'
import { trimToCanvas, editPixels } from '../../core/doc/pixels'
import { flattenDoc } from '../../core/doc/render'
import { contentFill } from '../../core/contentfill'
import { checkLimits, MAX_SIDE } from '../../core/limits'
import { invalid, limit } from '../errors'
import { object, onlyKeys, int, num, bool, oneOf } from '../validate'
import type { DocCommand } from './types'
import { colorOf } from './types'

// ── image.resize ──
export interface ResizeInput {
  width: number
  height: number
  resolution?: number
  resampling: 'bilinear'
}
export const resizeCommand: DocCommand<ResizeInput> = {
  name: 'image.resize',
  // 변형 값만 바꾼다 (픽셀 복사 없음) — 결과 크기는 계산 전에 검사한다
  resultSize: (i) => ({ width: i.width, height: i.height }),
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['width', 'height', 'resolution', 'resampling'])
    const width = int(o, 'width', 1, MAX_SIDE)
    const height = int(o, 'height', 1, MAX_SIDE)
    const lim = checkLimits(width, height)
    if (lim) throw limit(lim, { width, height })
    return { width, height, resolution: num(o, 'resolution', 1, 10000, undefined), resampling: oneOf(o, 'resampling', ['bilinear'] as const, 'bilinear')! }
  },
  run(doc, i) {
    const next = resizeImage(doc, i.width, i.height, i.resolution ?? doc.resolution)
    return { doc: next, label: '이미지 크기', summary: `${doc.width}×${doc.height} → ${i.width}×${i.height}`, warnings: [] }
  }
}

// ── image.crop ──
export interface CropInput {
  x: number
  y: number
  width: number
  height: number
  deleteCropped: boolean
}
export const cropCommand: DocCommand<CropInput> = {
  name: 'image.crop',
  // 잘린 픽셀 삭제는 모든 레이어를 굽는다
  heavy: true,
  resultSize: (i) => ({ width: i.width, height: i.height }),
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['x', 'y', 'width', 'height', 'deleteCropped'])
    return {
      x: int(o, 'x', 0, MAX_SIDE),
      y: int(o, 'y', 0, MAX_SIDE),
      width: int(o, 'width', 1, MAX_SIDE),
      height: int(o, 'height', 1, MAX_SIDE),
      deleteCropped: bool(o, 'deleteCropped', false)!
    }
  },
  run(doc, i) {
    if (i.x + i.width > doc.width || i.y + i.height > doc.height) throw invalid(`자를 영역이 문서(${doc.width}×${doc.height}) 밖으로 나갑니다.`, { width: doc.width, height: doc.height })
    let next: Doc = { ...cropDoc(doc, { x: i.x, y: i.y, w: i.width, h: i.height }), selection: null }
    if (i.deleteCropped) next = trimToCanvas(next)
    return { doc: next, label: '자르기', summary: `(${i.x}, ${i.y}) ${i.width}×${i.height} 로 자름`, warnings: [] }
  }
}

// ── image.canvasSize ──
export interface CanvasSizeInput {
  width: number
  height: number
  anchor: Anchor
  /** null = 투명, '#rrggbb' = 그 색, 'content' = 내용 인식 */
  background: string | null
}
export const canvasSizeCommand: DocCommand<CanvasSizeInput> = {
  name: 'image.canvasSize',
  heavy: true,
  resultSize: (i) => ({ width: i.width, height: i.height }),
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['width', 'height', 'anchor', 'background'])
    const width = int(o, 'width', 1, MAX_SIDE)
    const height = int(o, 'height', 1, MAX_SIDE)
    const lim = checkLimits(width, height)
    if (lim) throw limit(lim, { width, height })
    let background: string | null = null
    if (o.background !== undefined && o.background !== null) {
      if (o.background === CONTENT_FILL) background = CONTENT_FILL
      else
        background =
          '#' +
          colorOf(o, 'background')
            .map((v) => v.toString(16).padStart(2, '0'))
            .join('')
    }
    return { width, height, anchor: oneOf(o, 'anchor', ANCHORS, 'c')!, background }
  },
  run(doc, i) {
    const t = canvasTarget(doc.width, doc.height, { mode: 'absolute', width: i.width, height: i.height, anchor: i.anchor, background: i.background } as never)
    if (t.width === doc.width && t.height === doc.height) throw invalid('지금 크기와 같습니다.')
    let next = resizeCanvas(doc, t.width, t.height, i.anchor)
    const bottom = next.layers.find((l) => l.parentId === null && (l.kind === 'pixel' || l.kind === 'text') && l.visible)
    if (i.background !== null && bottom) {
      const { dx, dy } = anchorOffset(doc.width, doc.height, t.width, t.height, i.anchor)
      const inOld = (x: number, y: number): boolean => x >= dx && y >= dy && x < dx + doc.width && y < dy + doc.height
      const content = i.background === CONTENT_FILL
      const rgb = content ? [0, 0, 0] : colorOf({ c: i.background }, 'c')
      next = editPixels({ ...next, selection: null }, bottom.id, 'layer', { x: 0, y: 0, w: t.width, h: t.height }, (px, w, h, ox, oy) => {
        const target = new Uint8Array(w * h)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            if (inOld(x + ox, y + oy)) continue
            const o = (y * w + x) * 4
            if (content) target[y * w + x] = 1
            else if (px[o + 3] < 255) {
              const a = px[o + 3] / 255
              for (let c = 0; c < 3; c++) px[o + c] = px[o + c] * a + rgb[c] * (1 - a)
              px[o + 3] = 255
            }
          }
        if (content) contentFill(px, target, w, h)
      })
    }
    return { doc: next, label: '캔버스 크기', summary: `${doc.width}×${doc.height} → ${t.width}×${t.height} (${i.anchor})`, warnings: [] }
  }
}

// ── image.rotate / image.flip ──
export interface RotateInput {
  angle: 90 | -90 | 180
}
export const rotateCommand: DocCommand<RotateInput> = {
  name: 'image.rotate',
  heavy: true,
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['angle'])
    const angle = int(o, 'angle', -90, 180)
    if (angle !== 90 && angle !== -90 && angle !== 180) throw invalid('angle 은 90, -90, 180 중 하나여야 합니다.', { field: 'angle' })
    return { angle }
  },
  run(doc, i) {
    const next = i.angle === 180 ? rotateCanvas90(rotateCanvas90(doc, 1), 1) : rotateCanvas90(doc, i.angle === 90 ? 1 : -1)
    return { doc: next, label: `캔버스 ${i.angle}° 회전`, summary: `${i.angle}° 회전`, warnings: [] }
  }
}
export interface FlipInput {
  axis: 'horizontal' | 'vertical'
  /** 없으면 캔버스 전체 */
  layerId?: string
}
export const flipCommand: DocCommand<FlipInput> = {
  name: 'image.flip',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['axis'])
    return { axis: oneOf(o, 'axis', ['horizontal', 'vertical'] as const) }
  },
  run(doc, i) {
    return { doc: flipCanvas(doc, i.axis === 'horizontal'), label: i.axis === 'horizontal' ? '캔버스 좌우 반전' : '캔버스 상하 반전', summary: `${i.axis} 반전`, warnings: [] }
  }
}

// ── image.trim ──
export const trimCommand: DocCommand<Record<string, never>> = {
  name: 'image.trim',
  heavy: true,
  parse(raw) {
    onlyKeys(object(raw), [])
    return {}
  },
  run(doc) {
    const flat = flattenDoc(doc)
    let x0 = doc.width
    let y0 = doc.height
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < doc.height; y++)
      for (let x = 0; x < doc.width; x++)
        if (flat.data[(y * doc.width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) throw invalid('보이는 픽셀이 없습니다.')
    if (x0 === 0 && y0 === 0 && x1 === doc.width - 1 && y1 === doc.height - 1) throw invalid('잘라낼 투명 여백이 없습니다.')
    const next = cropDoc(doc, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 })
    return { doc: next, label: '투명 여백 자르기', summary: `${next.width}×${next.height} 로 줄임`, warnings: [] }
  }
}

// ── image.flatten ──
export const flattenCommand: DocCommand<Record<string, never>> = {
  name: 'image.flatten',
  heavy: true,
  parse(raw) {
    onlyKeys(object(raw), [])
    return {}
  },
  run(doc) {
    if (doc.layers.length < 2 && doc.layers[0]?.kind === 'pixel') throw invalid('병합할 레이어가 없습니다.')
    return { doc: flattenImage(doc), label: '이미지 병합', summary: `${doc.layers.length}장 → 1장`, warnings: [] }
  }
}

// ── document.guides ──
export interface GuidesInput {
  vertical: number[]
  horizontal: number[]
}
const guideList = (o: Record<string, unknown>, key: string): number[] => {
  const v = o[key] ?? []
  if (!Array.isArray(v) || v.length > 200 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) throw invalid(`${key}는 숫자 200개 이하의 배열이어야 합니다.`, { field: key })
  return v as number[]
}
export const guidesCommand: DocCommand<GuidesInput> = {
  name: 'document.guides',
  parse(raw) {
    const o = object(raw)
    onlyKeys(o, ['vertical', 'horizontal'])
    return { vertical: guideList(o, 'vertical'), horizontal: guideList(o, 'horizontal') }
  },
  run(doc, i) {
    const v = i.vertical.filter((x) => x >= 0 && x <= doc.width)
    const h = i.horizontal.filter((y) => y >= 0 && y <= doc.height)
    return { doc: { ...doc, guides: v.length || h.length ? { v, h } : undefined }, label: '안내선', summary: `세로 ${v.length}·가로 ${h.length}`, warnings: [] }
  }
}
