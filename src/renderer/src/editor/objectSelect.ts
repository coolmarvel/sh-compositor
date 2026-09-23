import { WorkerClient } from '../util/workerClient'
/**
 * 개체 선택 (포토샵 Object Selection · 갤럭시 올가미 자동 맞춤) — Segment Anything(SlimSAM) 을 일꾼에서 돌린다.
 *
 * 흐름: 사용자가 대충 그린 영역(사각·올가미) 또는 클릭한 점 → 점 프롬프트(영역 안 양성 1개 + 바깥 음성 8개)
 *       → 마스크 후보 3장 중 "영역 안에 거의 다 들어가는 가장 큰 것" → 구멍 메우기·부스러기 제거 → 가장자리 다듬기(GuidedMatte)
 *       → 영역 밖 잘라 내기 → 문서 크기로 키워 선택 영역.
 * 이어서 Shift+클릭(더 잡기)·Alt+클릭(빼기)로 같은 개체를 다듬고, 옵션 줄의 확장·축소·부드럽게로 테두리를 조절한다.
 * 그림 특징(embedding)은 문서 레이어가 그대로면 다시 계산하지 않는다 → 두 번째 선택부터 빠르다.
 */
import { editor } from './store'
import { docThumbnail } from './commands'
import { mergedBitmap } from './io'
import { makeSelection, combine, growSelection, featherSelection, guidedFilter, type Doc, type Layer, type Selection, type SelectMode } from '@core/index'

/** 모델 위치 — 데스크톱은 aimodel://, 웹은 배포 경로 아래 models/sam/ (platform 이 정한다) */
const modelBase = (): string => window.api?.samAssetsUrl ?? 'aimodel://assets/'
const MAX_SIDE = 1024 // SAM 입력은 긴 변 1024 — 그 이상 보내 봐야 줄여서 쓴다

type Pt = { x: number; y: number }

// ── 일꾼 ──
const client = new WorkerClient<string>(
  () => new Worker(new URL('./samWorker.ts', import.meta.url), { type: 'module' }),
  '개체 선택 일꾼이 멈췄습니다.',
  () => {
    emb = null
  }
)
/** 모델 준비·분석이 멈춘 경우의 기한 — 첫 분석(모델 불러오기 포함)은 느린 PC 에서도 이 안에 끝난다 */
const EMBED_TIMEOUT = 180_000
const DECODE_TIMEOUT = 30_000
const call = <T>(msg: Record<string, unknown>, progress?: (label: string) => void, transfer: Transferable[] = []): Promise<T> =>
  client.request<T>(msg, { progress, transfer, timeoutMs: msg.op === 'embed' ? EMBED_TIMEOUT : DECODE_TIMEOUT })

// ── 그림 특징 (문서 레이어가 같으면 다시 쓴다) ──
let emb: { layers: Layer[]; W: number; H: number; key: string; w: number; h: number; guide: Float32Array } | null = null
let keySeq = 0

async function ensureEmbedding(doc: Doc, progress: (l: string) => void): Promise<NonNullable<typeof emb>> {
  if (emb && emb.layers === doc.layers && emb.W === doc.width && emb.H === doc.height) return emb
  // GPU 합성 축소본 (보이는 그대로) — 없으면 CPU 합성을 줄인다
  let img = docThumbnail(MAX_SIDE)
  if (!img) {
    const flat = mergedBitmap(doc)
    const s = Math.min(1, MAX_SIDE / Math.max(flat.width, flat.height))
    const c = new OffscreenCanvas(Math.max(1, Math.round(flat.width * s)), Math.max(1, Math.round(flat.height * s)))
    const src = new OffscreenCanvas(flat.width, flat.height)
    src.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(flat.data), flat.width, flat.height), 0, 0)
    const g = c.getContext('2d')!
    g.drawImage(src, 0, 0, c.width, c.height)
    img = g.getImageData(0, 0, c.width, c.height)
  }
  // 투명한 곳은 흰색 위로 (모델은 RGB 만 본다)
  const rgba = new Uint8ClampedArray(img.data)
  const guide = new Float32Array(img.width * img.height)
  for (let i = 0; i < guide.length; i++) {
    const a = rgba[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) rgba[i * 4 + c] = rgba[i * 4 + c] * a + 255 * (1 - a)
    rgba[i * 4 + 3] = 255
    guide[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255
  }
  const key = `k${++keySeq}`
  await call({ op: 'embed', key, w: img.width, h: img.height, rgba, base: modelBase() }, progress, [rgba.buffer])
  emb = { layers: doc.layers, W: doc.width, H: doc.height, key, w: img.width, h: img.height, guide }
  return emb
}

// ── 마스크 다듬기 (작은 해상도에서) ──

/** 4-연결 성분 라벨링 — 값이 v 인 칸들 */
function components(bin: Uint8Array, w: number, h: number, v: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let i = 0; i < bin.length; i++) {
    if (bin[i] !== v || label[i] >= 0) continue
    const id = sizes.length
    let n = 0
    stack.push(i)
    label[i] = id
    while (stack.length) {
      const p = stack.pop()!
      n++
      const x = p % w
      const y = (p / w) | 0
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of nb)
        if (q >= 0 && bin[q] === v && label[q] < 0) {
          label[q] = id
          stack.push(q)
        }
    }
    sizes.push(n)
  }
  return { label, sizes }
}

/**
 * 구멍 메우기(테두리에 닿지 않는 작은 빈 곳) + 떨어진 조각 정리:
 * 양성 점이 닿은 덩어리(= 잡으려는 개체)는 남기고, 떨어진 다른 조각은 그 덩어리의 25% 이상일 때만 남긴다
 * (뒤 배경의 커튼 자락 같은 것이 따라 잡히던 문제 — 2026-09-21 고양이 사진).
 */
function clean(bin: Uint8Array, w: number, h: number, seeds: Pt[]): Uint8Array {
  const out = bin.slice()
  const area = out.reduce((a, v) => a + v, 0)
  const holes = components(out, w, h, 0)
  const touches = new Set<number>()
  for (let x = 0; x < w; x++) {
    touches.add(holes.label[x])
    touches.add(holes.label[(h - 1) * w + x])
  }
  for (let y = 0; y < h; y++) {
    touches.add(holes.label[y * w])
    touches.add(holes.label[y * w + w - 1])
  }
  for (let i = 0; i < out.length; i++) {
    const l = holes.label[i]
    if (l >= 0 && !touches.has(l) && holes.sizes[l] < area * 0.08) out[i] = 1
  }
  const isl = components(out, w, h, 1)
  if (!isl.sizes.length) return out
  const seeded = new Set<number>()
  for (const p of seeds) {
    const l = isl.label[Math.min(h - 1, Math.max(0, Math.round(p.y))) * w + Math.min(w - 1, Math.max(0, Math.round(p.x)))]
    if (l >= 0) seeded.add(l)
  }
  // 양성 점이 개체 밖에 떨어졌으면 가장 큰 덩어리를 기준으로
  if (!seeded.size) seeded.add(isl.sizes.reduce((best, size, i) => (size > isl.sizes[best] ? i : best), 0))
  const main = [...seeded].reduce((max, label) => Math.max(max, isl.sizes[label]), 0)
  for (let i = 0; i < out.length; i++) {
    const l = isl.label[i]
    if (l >= 0 && !seeded.has(l) && isl.sizes[l] < main * 0.25) out[i] = 0
  }
  return out
}

/** 작은 해상도 0~1 마스크 → 문서 크기 0~255 (쌍선형) */
function upscale(m: Float32Array, w: number, h: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H)
  const sx = w / W
  const sy = h / H
  for (let y = 0; y < H; y++) {
    const fy = Math.min(h - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(h - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < W; x++) {
      const fx = Math.min(w - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(w - 1, x0 + 1)
      const tx = fx - x0
      const v = (m[y0 * w + x0] * (1 - tx) + m[y0 * w + x1] * tx) * (1 - ty) + (m[y1 * w + x0] * (1 - tx) + m[y1 * w + x1] * tx) * ty
      out[y * W + x] = Math.round(Math.min(1, Math.max(0, v)) * 255)
    }
  }
  return out
}

// ── 세션 (같은 개체를 클릭으로 다듬기·옵션 줄의 확장/축소/부드럽게) ──

export interface ObjSession {
  key: string
  /** 이 개체를 잡기 전의 선택 (여기에 모드대로 합친다) */
  before: Selection | null
  mode: SelectMode
  pos: Pt[]
  neg: Pt[]
  /** 사용자가 그린 영역 (작은 해상도, 1=안) — 클릭으로 시작했으면 null */
  region: Uint8Array | null
  /** 잡은 개체 (문서 크기 0~255, 확장·부드럽게 전) */
  mask: Uint8Array
  grow: number
  feather: number
  /** 작은 해상도 ÷ 문서 (점 좌표를 문서로 되돌릴 때) */
  k: number
}
let session: ObjSession | null = null
let endTimer: ReturnType<typeof setTimeout> | null = null
export const objectSession = (): ObjSession | null => session
export function endObjectSession(): void {
  session = null
  editor.requestRender()
}

/** 영역 안에서 가운데에 가까운 점 (오목한 올가미면 무게중심이 밖일 수 있다) */
function insidePoint(region: Uint8Array, w: number): Pt {
  let sx = 0
  let sy = 0
  let n = 0
  for (let i = 0; i < region.length; i++)
    if (region[i]) {
      sx += i % w
      sy += (i / w) | 0
      n++
    }
  const c = { x: sx / n, y: sy / n }
  if (region[Math.round(c.y) * w + Math.round(c.x)]) return c
  let best = c
  let bd = Infinity
  for (let i = 0; i < region.length; i++)
    if (region[i]) {
      const d = ((i % w) - c.x) ** 2 + (((i / w) | 0) - c.y) ** 2
      if (d < bd) {
        bd = d
        best = { x: i % w, y: (i / w) | 0 }
      }
    }
  return best
}

async function decodeAndPick(e: NonNullable<typeof emb>, pos: Pt[], neg: Pt[], region: Uint8Array | null): Promise<Uint8Array | null> {
  const points: [number, number][] = [...pos.map((p) => [p.x, p.y] as [number, number]), ...neg.map((p) => [p.x, p.y] as [number, number])]
  const labels = [...pos.map(() => 1), ...neg.map(() => 0)]
  const r = await call<{ logits: Float32Array; scores: number[]; w: number; h: number }>({ op: 'decode', key: e.key, points, labels })
  const n = r.w * r.h
  // 후보 고르기: 영역이 있으면 영역 안에 85% 이상 들어가는 후보만. 그중 모델 확신도(IoU 점수)가 가장 높은 것,
  // 점수가 거의 같으면(0.05 이내) 더 큰 것 (개체 전체 쪽)
  const cands: { k: number; area: number; score: number; posHit: number; negHit: number }[] = []
  const at = (k: number, q: Pt): boolean => r.logits[k * n + Math.min(r.h - 1, Math.max(0, Math.round(q.y))) * r.w + Math.min(r.w - 1, Math.max(0, Math.round(q.x)))] > 0
  for (let k = 0; k < 3; k++) {
    let area = 0
    let inside = 0
    for (let i = 0; i < n; i++)
      if (r.logits[k * n + i] > 0) {
        area++
        if (region?.[i]) inside++
      }
    if (!area) continue
    if (region && inside / area < 0.85) continue
    cands.push({ k, area, score: r.scores[k], posHit: pos.filter((q) => at(k, q)).length, negHit: neg.filter((q) => at(k, q)).length })
  }
  if (!cands.length) return null
  // 1) 양성 점(개체)을 가장 많이 덮고 음성 점(바깥)을 가장 적게 덮는 후보만 — 이 모델은 "개체를 뺀 나머지" 후보를 내기도 한다
  const bestPos = Math.max(...cands.map((c) => c.posHit))
  const pool1 = cands.filter((c) => c.posHit === bestPos)
  const leastNeg = Math.min(...pool1.map((c) => c.negHit))
  const pool = pool1.filter((c) => c.negHit === leastNeg)
  let best: number
  if (region) {
    // 2) 감싼 영역: 확신도가 크게 낮지 않으면(0.2 이내) 더 큰 후보 = 개체 전체 쪽 (작은 후보는 보통 개체의 일부)
    const top = Math.max(...pool.map((c) => c.score))
    best = pool.filter((c) => c.score >= top - 0.2).reduce((a, b) => (b.area > a.area ? b : a)).k
  } else {
    // 2) 점만 있을 때: 화면 절반 넘게 덮는 후보(배경까지 먹은 것)는 다른 후보가 있으면 빼고, 확신도가 가장 높은 것
    const sane = pool.filter((c) => c.area <= n * 0.5)
    best = (sane.length ? sane : pool).reduce((a, b) => (b.score > a.score ? b : a)).k
  }
  const bin = new Uint8Array(n)
  for (let i = 0; i < n; i++) bin[i] = r.logits[best * n + i] > 0 ? 1 : 0
  const cleaned = clean(bin, r.w, r.h, pos)
  // 가장자리: 원본 밝기를 길잡이로 가이드 필터 (머리카락·털 쪽을 조금 더 살린다) → 영역 밖 잘라 내기
  let soft: Float32Array = Float32Array.from(cleaned)
  soft = guidedFilter(soft, e.guide, r.w, r.h, 2, 1e-3)
  if (region) {
    // 영역을 2px 넓혀 그 밖은 버린다
    const grown = new Uint8Array(n)
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++) {
        if (!region[y * r.w + x]) continue
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx >= 0 && yy >= 0 && xx < r.w && yy < r.h) grown[yy * r.w + xx] = 1
          }
      }
    for (let i = 0; i < n; i++) if (!grown[i]) soft[i] = 0
  }
  return upscale(soft, r.w, r.h, e.W, e.H)
}

/** 세션 결과(확장·부드럽게 포함)를 문서 선택으로 */
function apply(label: string, gesture = false): void {
  const s = session
  const d = editor.doc
  if (!s || !d) return
  let sel: Selection | null = makeSelection(d.width, d.height, s.mask)
  if (sel && s.grow) sel = growSelection(sel, s.grow)
  if (sel && s.feather) sel = featherSelection(sel, s.feather)
  const out = combine(s.before, d.width, d.height, sel?.mask ?? new Uint8Array(d.width * d.height), s.mode)
  if (gesture) editor.commitGesture({ ...d, selection: out }, label)
  else editor.commit({ ...d, selection: out }, label)
}

/**
 * 새 개체 잡기. region: 문서 좌표 다각형(사각이면 네 점), 없으면 point 하나로.
 * 반환 false = 찾지 못함.
 */
export async function selectObject(opts: { polygon?: Pt[]; point?: Pt; mode: SelectMode }): Promise<boolean> {
  const d = editor.doc
  if (!d) return false
  let ok = false
  await editor.busy('개체 찾는 중…', async () => {
    const e = await ensureEmbedding(d, (label) => editor.set({ progress: { label } }))
    editor.set({ progress: { label: '개체 테두리 맞추는 중…' } })
    const k = e.w / e.W
    let region: Uint8Array | null = null
    const pos: Pt[] = []
    const neg: Pt[] = []
    if (opts.polygon && opts.polygon.length >= 3) {
      const poly = opts.polygon.map((p) => ({ x: p.x * k, y: p.y * k }))
      const c = new OffscreenCanvas(e.w, e.h)
      const g = c.getContext('2d')!
      g.beginPath()
      poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)))
      g.closePath()
      g.fill()
      const a = g.getImageData(0, 0, e.w, e.h).data
      region = new Uint8Array(e.w * e.h)
      for (let i = 0; i < region.length; i++) region[i] = a[i * 4 + 3] > 127 ? 1 : 0
      if (!region.some((v) => v)) return
      pos.push(insidePoint(region, e.w))
      // 바깥 음성 점: 영역 경계 상자에서 조금 밖 8곳 (그림 안으로 자르고, 영역 안에 떨어진 것은 뺀다)
      const xs = poly.map((p) => p.x)
      const ys = poly.map((p) => p.y)
      const m = Math.max(4, Math.min(e.w, e.h) * 0.01)
      const [x0, x1, y0, y1] = [Math.min(...xs) - m, Math.max(...xs) + m, Math.min(...ys) - m, Math.max(...ys) + m]
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      for (const [x, y] of [
        [x0, y0],
        [cx, y0],
        [x1, y0],
        [x1, cy],
        [x1, y1],
        [cx, y1],
        [x0, y1],
        [x0, cy]
      ]) {
        const px = Math.max(0, Math.min(e.w - 1, x))
        const py = Math.max(0, Math.min(e.h - 1, y))
        if (!region[Math.round(py) * e.w + Math.round(px)]) neg.push({ x: px, y: py })
      }
    } else if (opts.point) pos.push({ x: opts.point.x * k, y: opts.point.y * k })
    else return
    const mask = await decodeAndPick(e, pos, neg, region)
    if (!mask) return
    const cur = editor.doc
    if (!cur) return
    session = { key: e.key, before: cur.selection, mode: opts.mode, pos, neg, region, mask, grow: 0, feather: 0, k }
    apply('개체 선택')
    ok = true
  })
  if (!ok && !editor.state.toast) editor.toast('info', '개체를 찾지 못했습니다. 개체를 조금 더 넉넉히 감싸 보세요.')
  return ok
}

/**
 * 칠해서 잡기 (포토샵 빠른 선택) — 문지른 자리들을 양성 점(Alt 면 음성)으로 넘긴다.
 * 이어서 칠하면 같은 개체에 점이 더해져 넓어진다 (세션 유지).
 */
export async function paintSelect(stroke: Pt[], include: boolean, fresh: boolean): Promise<void> {
  const d = editor.doc
  if (!d || !stroke.length) return
  await editor.busy('칠한 곳의 개체 찾는 중…', async () => {
    const e = await ensureEmbedding(d, (label) => editor.set({ progress: { label } }))
    const k = e.w / e.W
    // 획을 따라 일정 간격(작은 해상도 12px)으로 점을 뽑는다 (최대 16개 — 점이 너무 많으면 모델이 오히려 흔들린다)
    const pts: Pt[] = []
    let last: Pt | null = null
    for (const q of stroke) {
      const p = { x: q.x * k, y: q.y * k }
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 12) {
        pts.push(p)
        last = p
      }
    }
    const sample = pts.length > 16 ? pts.filter((_, i) => i % Math.ceil(pts.length / 16) === 0) : pts
    let s = session
    if (fresh || !s || s.key !== e.key || s.region) {
      if (!include) return
      s = session = { key: e.key, before: editor.doc?.selection ?? null, mode: 'replace', pos: [], neg: [], region: null, mask: new Uint8Array(0), grow: 0, feather: 0, k }
      if (fresh) s.before = null
    }
    if (include) s.pos.push(...sample)
    else s.neg.push(...sample)
    if (!s.pos.length) return
    const mask = await decodeAndPick(e, s.pos, s.neg, null)
    if (!mask) return
    s.mask = mask
    apply(include ? '칠해서 잡기' : '칠해서 빼기')
  })
}

/** 같은 개체 다듬기 — Shift+클릭(여기도 포함) · Alt+클릭(여기는 빼기) */
export async function refineObject(at: Pt, include: boolean): Promise<void> {
  const s = session
  const d = editor.doc
  if (!s || !d || !emb || emb.key !== s.key || emb.layers !== d.layers) return void (await selectObject({ point: at, mode: include ? 'add' : 'subtract' }))
  await editor.busy('개체 다듬는 중…', async () => {
    const k = emb!.w / emb!.W
    const p = { x: at.x * k, y: at.y * k }
    if (include) s.pos.push(p)
    else s.neg.push(p)
    // 클릭으로 넓히는 중에는 처음 그린 영역에 묶지 않는다 (영역 밖을 더 잡을 수도 있게)
    if (include) s.region = null
    const mask = await decodeAndPick(emb!, s.pos, s.neg, s.region)
    if (!mask) return
    s.mask = mask
    apply(include ? '개체 선택 더하기' : '개체 선택 빼기')
  })
}

/** 옵션 줄: 테두리 확장/축소(px)·부드럽게(px) — 끄는 동안은 실행취소 한 칸 */
export function adjustObject(patch: { grow?: number; feather?: number }, gesture: boolean): void {
  if (!session) return
  Object.assign(session, patch)
  apply('개체 선택 다듬기', gesture)
  // 막대를 멈추면 실행취소 한 칸을 닫는다 (다음 동작이 이 칸을 덮어쓰지 않게)
  if (gesture) {
    if (endTimer) clearTimeout(endTimer)
    endTimer = setTimeout(() => editor.endGesture(), 400)
  }
}
