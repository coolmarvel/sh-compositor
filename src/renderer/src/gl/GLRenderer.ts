/**
 * WebGL2 합성·표시기 (ADR-0002) — 문서의 GPU 거울.
 *
 * 규약 (docs/guides/rendering.md)
 *  - 픽셀의 진실은 CPU Bitmap. 텍스처는 Bitmap 객체를 키로 한 캐시이고, 같은 객체면 다시 올리지 않는다.
 *    칠하는 중인 레이어는 "살아 있는" Bitmap(데이터가 바뀌는 사본)을 넘기고 `uploadRect` 로 바뀐 사각형만 올린다.
 *  - 합성은 문서 해상도 FBO 두 장을 번갈아(ping-pong) 쓴다: 대상 ← 배경 복사(blit) → 레이어를 배경과 섞어 그림.
 *    폴더는 임시 FBO 에 격리 합성, 클리핑은 기준 레이어만 따로 그린 FBO 의 알파를 곱한다(CPU render.ts 와 같은 규칙).
 *  - 문서가 바뀔 때만 다시 합성하고, 팬/줌은 결과 텍스처를 다시 그리기만 한다(8K 도 가볍다).
 *  - 문서가 GPU 최대 텍스처보다 크면 합성 해상도를 줄인다(화면용). 내보내기·병합은 CPU 합성기가 원본 해상도로.
 */
import { QUAD_VS, LAYER_FS, OVER_FS, COPY_FS, ADJUST_FS, PRESENT_FS } from './shaders'
import { BLEND_MODES, layerMatrix, renderEffects, hasEffects, adjustmentTables, transformBounds, hasFilters, flattenDoc, type Bitmap, type Doc, type Layer, type LayerTransform } from '@core/index'

/** 두 레이어 객체가 화면상 같은가 — 필드가 모두 같은 객체(또는 내용이 같은 비트맵 사본)면 다시 그리지 않는다 */
function sameLayer(a: Layer, b: Layer, same: WeakMap<Bitmap, Bitmap>): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Layer>) {
    if (a[k] === b[k]) continue
    if (k === 'bitmap' && a.bitmap && b.bitmap && same.get(b.bitmap) === a.bitmap) continue
    return false
  }
  return true
}

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Target {
  fb: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

export interface View {
  /** 문서 1px 당 CSS px */
  zoom: number
  /** 문서 원점의 화면 위치 (CSS px) */
  panX: number
  panY: number
  /** true = "화면에 맞춤" 상태 — 창·문서 크기가 바뀌면 다시 맞춘다. 사용자가 팬·줌하면 풀린다 */
  fit?: boolean
  /** 이 보기를 계산할 때의 캔버스 영역 크기 (창 크기가 바뀌면 중심을 유지하려고) */
  cw?: number
  ch?: number
}

const BLEND_INDEX = Object.fromEntries(BLEND_MODES.map((b, i) => [b.key, i])) as Record<string, number>

export class GLRenderer {
  readonly gl: WebGL2RenderingContext
  private quad: WebGLBuffer
  private vao: WebGLVertexArrayObject
  private progLayer: Prog
  private progOver: Prog
  private progCopy: Prog
  private progAdjust: Prog
  private progPresent: Prog
  private textures = new Map<Bitmap, WebGLTexture>()
  private effectsCache = new WeakMap<Bitmap, { key: unknown; mask: unknown; bitmap: Bitmap; inset: number }>()
  private white: WebGLTexture
  private pool: Target[] = []
  private A: Target | null = null
  private B: Target | null = null
  private doc: Doc | null = null
  private dirty = true
  private mipDirty = true
  /** 합성 해상도 배율 (최대 텍스처를 넘는 큰 문서만 < 1) */
  scale = 1
  readonly maxTex: number
  private lutTone: WebGLTexture
  private lutHue: WebGLTexture
  private lutGrad: WebGLTexture

  constructor(readonly canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer 끔: 켜면 프레임마다 화면 버퍼를 한 번 더 복사한다 (소프트웨어 렌더링에선 프레임당 수십 ms)
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('이 PC 에서 WebGL2 를 쓸 수 없습니다. 그래픽 드라이버를 업데이트해 주세요.')
    this.gl = gl
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    this.gpuName = name
    // GPU 가 없어 CPU 로 그리는 환경(가상 머신·원격 데스크톱·드라이버 차단): 브라우저가 매 프레임 화면을 CPU 로 읽어 가므로 끄는 중엔 화면 해상도를 낮춘다
    this.software = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic/i.test(name)
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    this.vao = vao
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    this.progLayer = this.program(QUAD_VS, LAYER_FS)
    this.progOver = this.program(QUAD_VS, OVER_FS)
    this.progCopy = this.program(QUAD_VS, COPY_FS)
    this.progAdjust = this.program(QUAD_VS, ADJUST_FS)
    this.progPresent = this.program(QUAD_VS, PRESENT_FS)
    this.white = this.solidTexture([255, 255, 255, 255])
    this.lutTone = this.solidTexture([0, 0, 0, 0])
    this.lutHue = gl.createTexture()!
    this.lutGrad = this.solidTexture([0, 0, 0, 0])
    gl.disable(gl.BLEND)
  }

  // ── GL 기초 ──
  private program(vs: string, fs: string): Prog {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`셰이더 컴파일 실패: ${gl.getShaderInfoLog(s)}`)
      return s
    }
    const p = gl.createProgram()!
    const vertex = compile(gl.VERTEX_SHADER, vs)
    const fragment = compile(gl.FRAGMENT_SHADER, fs)
    gl.attachShader(p, vertex)
    gl.attachShader(p, fragment)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    gl.bindAttribLocation(p, 0, 'aPos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`셰이더 링크 실패: ${gl.getProgramInfoLog(p)}`)
    const u: Record<string, WebGLUniformLocation | null> = {}
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i)!
      u[info.name] = gl.getUniformLocation(p, info.name)
    }
    return { p, u }
  }

  private solidTexture(rgba: number[]): WebGLTexture {
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba))
    this.params(gl.NEAREST)
    return t
  }

  private params(filter: number, mip = false): void {
    const gl = this.gl
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private target(w: number, h: number): Target {
    const i = this.pool.findIndex((t) => t.w === w && t.h === h)
    if (i >= 0) return this.pool.splice(i, 1)[0]
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    this.params(gl.LINEAR)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fb, tex, w, h }
  }
  private release(t: Target): void {
    this.pool.push(t)
  }
  private freeTarget(t: Target | null): void {
    if (!t) return
    this.gl.deleteFramebuffer(t.fb)
    this.gl.deleteTexture(t.tex)
  }

  private clear(t: Target): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.viewport(0, 0, t.w, t.h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private blit(from: Target, to: Target): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fb)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.fb)
    gl.blitFramebuffer(0, 0, from.w, from.h, 0, 0, to.w, to.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  }

  // ── 텍스처 ──
  /** Bitmap → 텍스처 (같은 객체면 캐시) */
  texture(b: Bitmap): WebGLTexture {
    let t = this.textures.get(b)
    if (t) return t
    const gl = this.gl
    t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, b.width, b.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength))
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    this.params(gl.LINEAR)
    this.textures.set(b, t)
    return t
  }

  /**
   * 같은 내용의 새 비트맵(칠하기 시작할 때의 사본)에 GPU 에서 텍스처를 복제해 준다 — 큰 레이어를 다시 올리지 않게.
   * 원본 텍스처는 그대로 두므로 실행취소로 돌아가도 다시 올릴 필요가 없다.
   */
  cloneTexture(from: Bitmap, to: Bitmap): void {
    const src = this.textures.get(from)
    if (!src || this.textures.has(to) || from.width !== to.width || from.height !== to.height) return
    const gl = this.gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, to.width, to.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    this.params(gl.LINEAR)
    const rf = gl.createFramebuffer()!
    const df = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, rf)
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src, 0)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, df)
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
    const sc = gl.isEnabled(gl.SCISSOR_TEST)
    gl.disable(gl.SCISSOR_TEST)
    gl.blitFramebuffer(0, 0, to.width, to.height, 0, 0, to.width, to.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    if (sc) gl.enable(gl.SCISSOR_TEST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.deleteFramebuffer(rf)
    gl.deleteFramebuffer(df)
    this.textures.set(to, t)
    this.sameAs.set(to, from)
    this.repaint()
  }
  /** 내용이 같은 비트맵 짝 (복제한 사본 → 원본) — 영역 합성에서 "바뀐 것 없음"으로 본다 */
  private sameAs = new WeakMap<Bitmap, Bitmap>()

  /** 살아 있는 비트맵(칠하는 중)의 바뀐 사각형만 올린다 */
  uploadRect(b: Bitmap, r: { x: number; y: number; w: number; h: number }): void {
    const t = this.textures.get(b)
    if (!t) {
      this.texture(b)
      this.dirty = true
      return
    }
    const gl = this.gl
    const x = Math.max(0, r.x)
    const y = Math.max(0, r.y)
    const w = Math.min(b.width, r.x + r.w) - x
    const h = Math.min(b.height, r.y + r.h) - y
    if (w <= 0 || h <= 0) return
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, b.width)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength))
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    this.dirty = true
    this.uploads.push({ b, r: { x, y, w, h } })
  }

  /** 칠하는 중 부분 업로드된 사각형들 (비트맵 좌표) — 다음 합성에서 그 영역만 다시 그린다 */
  private uploads: { b: Bitmap; r: { x: number; y: number; w: number; h: number } }[] = []
  /** 마지막으로 전체가 올바르게 합성된 문서 (영역 합성의 기준) */
  private composed: Doc | null = null

  /** 레이어가 문서에서 차지하는 경계 (효과 여백 포함) */
  private layerBounds(l: Layer): { x: number; y: number; w: number; h: number } | null {
    if (l.kind === 'group' || l.kind === 'adjustment' || !l.bitmap) return null
    return transformBounds(this.drawable(l, l.bitmap).transform)
  }

  /**
   * 직전 합성 문서와 비교해 다시 그릴 문서 영역. null = 전체, 'none' = 그릴 것 없음(선택 영역만 바뀜 등).
   * 레이어 추가·삭제·순서·폴더/조정 레이어 변화는 전체로 (드물고 계산이 복잡).
   */
  private dirtyRegion(prev: Doc | null, doc: Doc): { x: number; y: number; w: number; h: number } | null | 'none' {
    if (!prev || prev.width !== doc.width || prev.height !== doc.height || prev.layers.length !== doc.layers.length) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    const add = (r: { x: number; y: number; w: number; h: number } | null): void => {
      if (!r) return
      x0 = Math.min(x0, r.x)
      y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w)
      y1 = Math.max(y1, r.y + r.h)
    }
    for (let i = 0; i < doc.layers.length; i++) {
      const a = prev.layers[i]
      const b = doc.layers[i]
      if (a === b) continue
      if (sameLayer(a, b, this.sameAs)) continue
      if (a.id !== b.id || a.parentId !== b.parentId || a.kind !== b.kind || b.kind === 'group' || b.kind === 'adjustment' || a.clip !== b.clip) return null
      const ra = this.layerBounds(a)
      const rb = this.layerBounds(b)
      if (!ra || !rb) return null
      add(ra)
      add(rb)
    }
    for (const u of this.uploads) {
      const l = doc.layers.find((k) => k.bitmap === u.b || k.mask?.bitmap === u.b)
      if (!l) return null
      const t = l.transform
      const kx = t.width / u.b.width
      const ky = t.height / u.b.height
      if (t.rotation || t.flipH || t.flipV) return null
      add({ x: t.x + u.r.x * kx, y: t.y + u.r.y * ky, w: u.r.w * kx, h: u.r.h * ky })
    }
    if (x0 === Infinity) return 'none'
    const r = { x: Math.max(0, Math.floor(x0) - 2), y: Math.max(0, Math.floor(y0) - 2), w: 0, h: 0 }
    r.w = Math.min(doc.width, Math.ceil(x1) + 2) - r.x
    r.h = Math.min(doc.height, Math.ceil(y1) + 2) - r.y
    if (r.w <= 0 || r.h <= 0) return 'none'
    if (r.w * r.h > doc.width * doc.height * 0.6) return null // 거의 전체면 그냥 전체
    return r
  }

  /** 문서에 없는 비트맵의 텍스처를 버린다 (메모리) */
  private collect(keep: Set<Bitmap>): void {
    // 한 세대 더 둔다: 방금 안 쓰인 텍스처는 실행취소로 곧 다시 쓰일 수 있다 (큰 레이어를 다시 올리지 않게)
    for (const [b, t] of this.textures) {
      if (keep.has(b)) {
        this.unused.delete(b)
        continue
      }
      const age = (this.unused.get(b) ?? 0) + 1
      if (age >= 3) {
        this.gl.deleteTexture(t)
        this.textures.delete(b)
        this.unused.delete(b)
      } else this.unused.set(b, age)
    }
  }
  private unused = new Map<Bitmap, number>()

  // ── 문서 ──
  /** 표시할 문서 (칠하는 중이면 store.preview). 같은 문서면 다시 합성하지 않는다 — 개미 행진·오버레이만 다시 그릴 때 */
  setDoc(doc: Doc | null): void {
    if (doc !== this.doc) this.dirty = true
    this.doc = doc
  }

  /** 포인터로 끄는 중(도구 무관) — 매 프레임 밉맵(문서 전체 축소 사슬)을 다시 만들지 않는다. 손을 떼면 한 번 만든다 */
  gesture = false

  /** 레이어를 끄는 중이면 true — 합성 해상도를 화면 배율까지 낮춘다 (붓질은 바뀐 영역만 그리므로 쓰지 않음) */
  get interactive(): boolean {
    return this.inter
  }
  set interactive(v: boolean) {
    if (this.inter === v) return
    this.inter = v
    if (!v && this.A && this.doc && this.A.w !== Math.round(this.doc.width * Math.min(1, this.maxTex / Math.max(this.doc.width, this.doc.height)))) this.dirty = true
  }
  private inter = false
  /** WebGL 렌더러 이름 (정보 창·진단용) */
  readonly gpuName: string
  /** 소프트웨어 렌더링 여부 */
  readonly software: boolean
  /** 화면 1px 당 문서 px 배율 (render 가 기록) */
  private viewScale = 1

  invalidate(): void {
    this.dirty = true
  }

  private bitmapOf(l: Layer): Bitmap | null {
    return l.bitmap
  }

  /** 마스크·효과가 있으면 CPU 로 미리 입힌 비트맵과 넓어진 변형 (Compositor LayerEffectsRenderer.cached) */
  private drawable(l: Layer, b: Bitmap): { bitmap: Bitmap; transform: LayerTransform; maskInShader: boolean } {
    if (!l.effects || !hasEffects(l.effects)) return { bitmap: b, transform: l.transform, maskInShader: !!l.mask?.enabled }
    const mask = l.mask?.enabled ? l.mask.bitmap : null
    let c = this.effectsCache.get(b)
    if (!c || c.key !== l.effects || c.mask !== mask) {
      let src = b.data
      if (mask) {
        src = b.data.slice()
        for (let i = 0; i < src.length; i += 4) src[i + 3] = (src[i + 3] * mask.data[i]) / 255
      }
      const r = renderEffects(src, b.width, b.height, l.effects)
      c = { key: l.effects, mask, bitmap: { width: r.width, height: r.height, data: r.data }, inset: r.inset }
      this.effectsCache.set(b, c)
    }
    const t = l.transform
    const kx = t.width / b.width
    const ky = t.height / b.height
    const cx = t.x + t.width / 2
    const cy = t.y + t.height / 2
    const w = c.bitmap.width * kx
    const h = c.bitmap.height * ky
    return { bitmap: c.bitmap, transform: { ...t, x: cx - w / 2, y: cy - h / 2, width: w, height: h }, maskInShader: false }
  }

  /**
   * 단위 사각형을 레이어 위치로 보내는 행렬들 (FBO 픽셀 → 클립).
   * 단위 (u,v) 는 텍스처 좌표이기도 하다(0..1).
   */
  private layerMats(t: LayerTransform, bw: number, bh: number, tw: number, th: number): { toClip: Float32Array; toUV: Float32Array } {
    const m = layerMatrix(t, bw, bh) // 비트맵 px → 문서 px
    const s = this.scale
    // 단위 → 비트맵 px: (u·bw, v·bh). 문서 px → FBO 클립: x·s/tw·2−1, (y·s/th·2−1) (FBO 는 위가 y=0 이도록 뒤집어 쓴다)
    const a = m[0] * bw
    const b = m[1] * bw
    const c = m[2] * bh
    const d = m[3] * bh
    const e = m[4]
    const f = m[5]
    const kx = (2 * s) / tw
    const ky = (2 * s) / th
    // mat3 (열 우선): [a' b' 0, c' d' 0, e' f' 1]
    const toClip = new Float32Array([a * kx, b * ky, 0, c * kx, d * ky, 0, e * kx - 1, f * ky - 1, 1])
    const toUV = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    return { toClip, toUV }
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null | undefined): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(loc ?? null, unit)
  }

  private drawQuad(): void {
    const gl = this.gl
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  /** 전체 FBO 를 덮는 행렬 */
  private fullMats(): { toClip: Float32Array; toUV: Float32Array } {
    return { toClip: new Float32Array([2, 0, 0, 0, 2, 0, -1, -1, 1]), toUV: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) }
  }

  /** 변형 행렬로 그려질 FBO 픽셀 경계 (단위 사각형의 네 모서리) */
  private quadBounds(mats: { toClip: Float32Array }, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
    const m = mats.toClip
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]) {
      const cx = ((m[0] * u + m[3] * v + m[6] + 1) / 2) * w
      const cy = ((m[1] * u + m[4] * v + m[7] + 1) / 2) * h
      x0 = Math.min(x0, cx)
      y0 = Math.min(y0, cy)
      x1 = Math.max(x1, cx)
      y1 = Math.max(y1, cy)
    }
    const bx = Math.max(0, Math.floor(x0) - 1)
    const by = Math.max(0, Math.floor(y0) - 1)
    const bw = Math.min(w, Math.ceil(x1) + 1) - bx
    const bh = Math.min(h, Math.ceil(y1) + 1) - by
    return bw > 0 && bh > 0 ? { x: bx, y: by, w: bw, h: bh } : null
  }

  /** 합성용 예비 FBO (배경 영역 복사본) */
  private scratch: Target | null = null
  private scratchFor(w: number, h: number): Target {
    if (!this.scratch || this.scratch.w !== w || this.scratch.h !== h) {
      this.freeTarget(this.scratch)
      this.scratch = this.target(w, h)
    }
    return this.scratch
  }

  /**
   * dst 위에 레이어(텍스처 + 변형)를 **제자리에서** 합성한다.
   *  - 표준 혼합: 하드웨어 블렌딩 (배경 복사 없음)
   *  - 그 외 혼합: 레이어가 덮는 영역만 예비 FBO 로 복사해 배경으로 읽는다 (화면 전체 복사 없음)
   */
  private drawLayerInto(
    dst: Target,
    tex: WebGLTexture,
    mats: { toClip: Float32Array; toUV: Float32Array },
    opts: { opacity: number; blend: number; mask: WebGLTexture | null; clip: Target | null }
  ): void {
    const gl = this.gl
    if (opts.blend === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
      gl.viewport(0, 0, dst.w, dst.h)
      const { p, u } = this.progOver
      gl.useProgram(p)
      gl.uniformMatrix3fv(u.uToClip, false, mats.toClip)
      gl.uniformMatrix3fv(u.uToUV, false, mats.toUV)
      this.bindTex(0, tex, u.uLayer)
      this.bindTex(2, opts.mask ?? this.white, u.uMask)
      this.bindTex(3, opts.clip?.tex ?? this.white, u.uClip)
      gl.uniform1i(u.uHasMask, opts.mask ? 1 : 0)
      gl.uniform1i(u.uHasClip, opts.clip ? 1 : 0)
      gl.uniform1f(u.uOpacity, opts.opacity)
      gl.uniform2f(u.uTarget, dst.w, dst.h)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      this.drawQuad()
      gl.disable(gl.BLEND)
      return
    }
    const r = this.quadBounds(mats, dst.w, dst.h)
    if (!r) return
    const sc = this.scratchFor(dst.w, dst.h)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dst.fb)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.fb)
    gl.blitFramebuffer(r.x, r.y, r.x + r.w, r.y + r.h, r.x, r.y, r.x + r.w, r.y + r.h, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
    gl.viewport(0, 0, dst.w, dst.h)
    const { p, u } = this.progLayer
    gl.useProgram(p)
    gl.uniformMatrix3fv(u.uToClip, false, mats.toClip)
    gl.uniformMatrix3fv(u.uToUV, false, mats.toUV)
    this.bindTex(0, tex, u.uLayer)
    this.bindTex(1, sc.tex, u.uBackdrop)
    this.bindTex(2, opts.mask ?? this.white, u.uMask)
    this.bindTex(3, opts.clip?.tex ?? this.white, u.uClip)
    gl.uniform1i(u.uHasMask, opts.mask ? 1 : 0)
    gl.uniform1i(u.uHasClip, opts.clip ? 1 : 0)
    gl.uniform1f(u.uOpacity, opts.opacity)
    gl.uniform1i(u.uBlend, opts.blend)
    gl.uniform2f(u.uTarget, dst.w, dst.h)
    this.drawQuad()
  }

  /** 조정 레이어: 배경 전체를 예비 FBO 로 복사해 읽고 dst 에 쓴다 */
  private adjustInPlace(dst: Target, l: Layer, clip: Target | null, maskTex: WebGLTexture | null): void {
    const sc = this.scratchFor(dst.w, dst.h)
    this.blit(dst, sc)
    this.drawAdjustInto(dst, sc, l, clip, maskTex)
  }

  private drawAdjustInto(dst: Target, backdrop: Target, l: Layer, clip: Target | null, maskTex: WebGLTexture | null): void {
    const gl = this.gl
    const adj = l.adjustment!
    const tb = adjustmentTables(adj.settings)
    gl.bindTexture(gl.TEXTURE_2D, this.lutTone)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, tb.tone)
    this.params(gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, this.lutHue)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 361, 1, 0, gl.RGBA, gl.FLOAT, tb.hue)
    this.params(gl.NEAREST)
    if (tb.grad) {
      gl.bindTexture(gl.TEXTURE_2D, this.lutGrad)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, tb.grad)
      this.params(gl.NEAREST)
    }
    this.blit(backdrop, dst)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
    gl.viewport(0, 0, dst.w, dst.h)
    const { p, u } = this.progAdjust
    gl.useProgram(p)
    const full = this.fullMats()
    gl.uniformMatrix3fv(u.uToClip, false, full.toClip)
    gl.uniformMatrix3fv(u.uToUV, false, full.toUV)
    this.bindTex(0, backdrop.tex, u.uBackdrop)
    this.bindTex(1, this.lutTone, u.uTone)
    this.bindTex(2, this.lutHue, u.uHue)
    this.bindTex(3, this.lutGrad, u.uGrad)
    this.bindTex(4, maskTex ?? this.white, u.uMask)
    this.bindTex(5, clip?.tex ?? this.white, u.uClip)
    gl.uniform1i(u.uHasMask, maskTex ? 1 : 0)
    gl.uniform1i(u.uHasClip, clip ? 1 : 0)
    gl.uniform1i(u.uDoHsl, tb.doHsl ? 1 : 0)
    gl.uniform1i(u.uColorize, tb.colorize ? 1 : 0)
    gl.uniform3f(u.uColorizeHSL, ...tb.colorizeHSL)
    gl.uniform1i(u.uHasGrad, tb.grad ? 1 : 0)
    gl.uniform1f(u.uGrain, tb.grain)
    gl.uniform1f(u.uOpacity, l.opacity)
    gl.uniform2f(u.uTarget, dst.w, dst.h)
    this.drawQuad()
  }

  /**
   * 한 부모의 자식들을 cur 에 **제자리** 합성. 규칙은 core/doc/render.ts compositeChildren 과 같다.
   * from = 이 인덱스부터 (앞은 캐시에서 복원됨), snapAt = 이 인덱스를 그리기 직전 cur 을 prefix 캐시에 떠 둔다.
   */
  private compositeChildren(parentId: string | null, cur: Target, keep: Set<Bitmap>, from = 0, snapAt = -1): void {
    const doc = this.doc!
    const W = cur.w
    const H = cur.h
    const kids = doc.layers.filter((l) => l.parentId === parentId)
    let base: Target | null = null
    const dropBase = (): void => {
      if (base) this.release(base)
      base = null
    }
    /** 바로 위 형제가 이 레이어에 클리핑되는가 — 아니면 기준 알파 버퍼를 만들 필요가 없다 */
    const needsBase = (i: number): boolean => !!kids[i + 1]?.clip
    for (let i = from; i < kids.length; i++) {
      const l = kids[i]
      if (i === snapAt) this.snapshotPrefix(cur)
      const clip = l.clip ? base : null
      if (!l.clip) dropBase()
      if (!l.visible) {
        if (!l.clip && needsBase(i)) {
          base = this.target(W, H)
          this.clear(base)
        }
        continue
      }
      if (l.clip && !clip) continue
      if (l.kind === 'adjustment' && l.adjustment) {
        const maskTex = l.mask?.enabled ? this.texture(l.mask.bitmap) : null
        if (l.mask) keep.add(l.mask.bitmap)
        this.adjustInPlace(cur, l, clip, maskTex)
        continue
      }
      let tex: WebGLTexture
      let mats: { toClip: Float32Array; toUV: Float32Array }
      let maskTex: WebGLTexture | null = null
      let groupRes: Target | null = null
      if (l.kind === 'group') {
        // 격리 합성: 투명 바탕에 자식들
        groupRes = this.target(W, H)
        this.clear(groupRes)
        this.compositeChildren(l.id, groupRes, keep)
        tex = groupRes.tex
        mats = this.fullMats()
        if (l.mask?.enabled) {
          maskTex = this.texture(l.mask.bitmap)
          keep.add(l.mask.bitmap)
        }
      } else {
        const b = this.bitmapOf(l)
        if (!b) continue
        const dr = this.drawable(l, b)
        keep.add(b)
        keep.add(dr.bitmap)
        tex = this.texture(dr.bitmap)
        mats = this.layerMats(dr.transform, dr.bitmap.width, dr.bitmap.height, W, H)
        if (dr.maskInShader && l.mask) {
          maskTex = this.texture(l.mask.bitmap)
          keep.add(l.mask.bitmap)
        }
      }
      this.drawLayerInto(cur, tex, mats, { opacity: l.opacity, blend: BLEND_INDEX[l.blend] ?? 0, mask: maskTex, clip })
      if (!l.clip && needsBase(i)) {
        base = this.target(W, H)
        this.clear(base)
        this.drawLayerInto(base, tex, mats, { opacity: 1, blend: 0, mask: maskTex, clip: null })
      }
      if (groupRes) this.release(groupRes)
    }
    dropBase()
  }

  // ── 아래 레이어 캐시 ──
  // 끄는 중·칠하는 중엔 활성 레이어만 바뀐다. 그 아래(최상위 기준)까지의 합성 결과를 떠 두고 다음 프레임에 복원한다.
  private prefix: { t: Target; key: Layer[]; n: number; scale: number } | null = null
  private cpuFlat: { doc: Doc; bmp: Bitmap } | null = null
  private pendingKey: { key: Layer[]; n: number } | null = null

  private snapshotPrefix(cur: Target): void {
    if (!this.pendingKey) return
    if (!this.prefix || this.prefix.t.w !== cur.w || this.prefix.t.h !== cur.h) {
      if (this.prefix) this.freeTarget(this.prefix.t)
      const gl = this.gl
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cur.w, cur.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.params(gl.NEAREST)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.prefix = { t: { fb, tex, w: cur.w, h: cur.h }, key: [], n: 0, scale: this.scale }
    }
    this.blit(cur, this.prefix.t)
    this.prefix.key = this.pendingKey.key
    this.prefix.n = this.pendingKey.n
    this.prefix.scale = this.scale
  }

  /** 활성 레이어 아래 최상위 레이어 수 n 과, 그 레이어들(자손 포함)의 목록 = 캐시 키 */
  private prefixKey(doc: Doc): { key: Layer[]; n: number } | null {
    const top = doc.layers.filter((l) => l.parentId === null)
    let a = doc.layers.find((l) => l.id === doc.activeId) ?? null
    while (a && a.parentId) a = doc.layers.find((l) => l.id === a!.parentId) ?? null
    if (!a) return null
    let n = top.indexOf(a)
    while (n > 0 && top[n].clip) n-- // 클리핑 레이어면 기준 레이어부터 다시 그린다
    if (n <= 0) return null
    const ids = new Set(top.slice(0, n).map((l) => l.id))
    const inPrefix = (l: Layer): boolean => {
      let c: Layer | null = l
      while (c && c.parentId) c = doc.layers.find((k) => k.id === c!.parentId) ?? null
      return !!c && ids.has(c.id)
    }
    return { key: doc.layers.filter(inPrefix), n }
  }

  private composite(): Target | null {
    const doc = this.doc
    if (!doc) return null
    if (!this.dirty && this.A) return this.A
    const gl = this.gl
    // 끄는 중엔 화면에 보이는 해상도까지만 (2의 거듭제곱 단계) — 축소 보기에서 픽셀 수가 1/4~1/16 로 준다
    const inter = this.interactive && this.viewScale < 1 ? Math.min(1, Math.pow(2, Math.ceil(Math.log2(Math.max(1 / 64, this.viewScale))))) : 1
    const s = Math.min(1, this.maxTex / Math.max(doc.width, doc.height)) * inter
    const W = Math.max(1, Math.round(doc.width * s))
    const H = Math.max(1, Math.round(doc.height * s))
    let region = this.A && this.A.w === W && this.A.h === H && this.scale === s ? this.dirtyRegion(this.composed, doc) : null
    this.scale = s
    // 칠해서 내용이 달라진 사본은 더는 원본과 같다고 보면 안 된다 (다시 실행 때 옛 그림이 보이는 사고 방지).
    // 영역 계산에 쓴 뒤에 지운다 — 먼저 지우면 칠하기 시작할 때마다 문서 전체를 다시 그린다
    for (const u of this.uploads) this.sameAs.delete(u.b)
    this.uploads = []
    if (!this.A || this.A.w !== W || this.A.h !== H) {
      this.freeTarget(this.A)
      this.freeTarget(this.B)
      for (const t of this.pool) this.freeTarget(t)
      this.pool = []
      this.A = this.target(W, H)
      this.B = this.target(W, H)
      region = null
    }
    if (region === 'none') {
      this.composed = doc
      this.dirty = false
      return this.A
    }
    // 필터가 걸린 조정 레이어는 셰이더 경로가 없다 → 그 문서는 CPU 합성(진실)을 통째로 올린다 (.comp·PSD 에서만 생김)
    if (doc.layers.some((l) => l.visible && l.kind === 'adjustment' && hasFilters(l.adjustment?.filters))) {
      if (this.cpuFlat?.doc !== doc) this.cpuFlat = { doc, bmp: flattenDoc({ ...doc, selection: null }) }
      const bmp = this.cpuFlat.bmp
      this.clear(this.A)
      this.drawLayerInto(this.A, this.texture(bmp), this.fullMats(), { opacity: 1, blend: 0, mask: null, clip: null })
      this.collect(new Set([bmp]))
      if (this.prefix) this.freeTarget(this.prefix.t)
      this.prefix = null
      this.composed = null
      this.dirty = false
      this.mipDirty = true
      return this.A
    }
    const keep = new Set<Bitmap>()
    const pk = this.prefixKey(doc)
    const p = this.prefix
    const hit = !!pk && !!p && p.n === pk.n && p.scale === s && p.t.w === W && p.t.h === H && p.key.length === pk.key.length && p.key.every((l, i) => l === pk.key[i])
    if (region) {
      // 바뀐 영역만: 가위(scissor) 안에서만 복원·지우기·그리기가 일어난다
      const x = Math.floor(region.x * s)
      const y = Math.floor(region.y * s)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(x, y, Math.ceil((region.x + region.w) * s) - x, Math.ceil((region.y + region.h) * s) - y)
    }
    if (hit) {
      // 아래 레이어는 그대로 — 캐시를 복원하고 활성 레이어부터 그린다
      this.blit(p!.t, this.A)
      this.pendingKey = null
      this.compositeChildren(null, this.A, keep, pk!.n)
    } else {
      this.clear(this.A)
      // 영역 합성 중엔 캐시를 새로 뜨지 않는다 (영역 밖이 옛 내용일 수 있음)
      this.pendingKey = region ? null : pk
      this.compositeChildren(null, this.A, keep, 0, region || !pk ? -1 : pk.n)
      this.pendingKey = null
      if (!region) this.collect(keep) // 전체를 그린 프레임에서만 쓰지 않는 텍스처를 버린다
    }
    gl.disable(gl.SCISSOR_TEST)
    this.composed = doc
    this.dirty = false
    this.mipDirty = true
    return this.A
  }

  /** 화면 그리기 */
  render(view: View, grid: boolean, checker: { a: [number, number, number]; b: [number, number, number] }, bg: [number, number, number]): void {
    this.lastRender = [view, grid, checker, bg]
    const gl = this.gl
    // 소프트웨어 렌더링 + 끄는 중 = 캔버스 해상도 절반 (CSS 가 늘려 보여 준다) — 손을 떼면 원래대로
    const dpr = (window.devicePixelRatio || 1) * (this.software && this.inter ? 0.5 : 1)
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
    }
    this.viewScale = view.zoom * dpr
    const docT = this.composite()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, cw, ch)
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!docT || !this.doc) return
    // 축소 표시는 밉맵으로 (자글거림 방지) — 확대는 가장 가까운 이웃(픽셀이 또렷하게)
    gl.bindTexture(gl.TEXTURE_2D, docT.tex)
    if (view.zoom < 1 && (!this.mipDirty || !this.gesture)) {
      if (this.mipDirty) {
        gl.generateMipmap(gl.TEXTURE_2D)
        this.mipDirty = false
      }
      this.params(gl.LINEAR, true)
    } else if (view.zoom < 1) {
      // 끄는 중·칠하는 중: 밉맵(문서 전체 1회 추가 처리)을 매 프레임 만들지 않고 선형 표본으로 — 손을 떼면 다시 만든다
      this.params(gl.LINEAR)
    } else this.params(view.zoom >= 2 ? gl.NEAREST : gl.LINEAR)
    const { p, u } = this.progPresent
    gl.useProgram(p)
    const W = this.doc.width
    const H = this.doc.height
    // 단위 → 화면 클립: x = pan + u·W·zoom (CSS) → ·dpr → 클립 (y 는 아래로)
    const sx = ((W * view.zoom * dpr) / cw) * 2
    const sy = ((H * view.zoom * dpr) / ch) * 2
    const tx = ((view.panX * dpr) / cw) * 2 - 1
    const ty = 1 - ((view.panY * dpr) / ch) * 2
    gl.uniformMatrix3fv(u.uToClip, false, new Float32Array([sx, 0, 0, 0, -sy, 0, tx, ty, 1]))
    gl.uniformMatrix3fv(u.uToUV, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]))
    this.bindTex(0, docT.tex, u.uDoc)
    gl.uniform1f(u.uZoom, view.zoom * dpr)
    gl.uniform2f(u.uDocSize, W, H)
    gl.uniform1i(u.uGrid, grid ? 1 : 0)
    gl.uniform3f(u.uCheckA, ...checker.a)
    gl.uniform3f(u.uCheckB, ...checker.b)
    this.drawQuad()
    // 파이프라인 강제 동기화는 하지 않는다 — 다음 프레임에 자연히 반영
    gl.bindTexture(gl.TEXTURE_2D, null)
    void this.progCopy
  }

  /**
   * 합성 결과의 축소본 (내비게이터용) — GPU 에서 작은 FBO 로 줄인 뒤 그것만 읽는다 (큰 문서도 몇 ms).
   * 끄는 중(저해상도 합성)이면 null — 손을 뗀 뒤 다시 부른다.
   */
  thumbnail(maxSide: number): ImageData | null {
    if (this.inter) return null
    const t = this.composite()
    if (!t || !this.doc) return null
    const s = Math.min(1, maxSide / Math.max(this.doc.width, this.doc.height))
    const w = Math.max(1, Math.round(this.doc.width * s))
    const h = Math.max(1, Math.round(this.doc.height * s))
    const gl = this.gl
    const small = this.target(w, h)
    // 2배씩 줄여 가며 (한 번에 크게 줄이면 자글거린다) — 밉맵과 같은 발상
    let src: Target = t
    const temps: Target[] = []
    while (src.w / 2 > w * 1.5 && src.h / 2 > h * 1.5) {
      const half = this.target(Math.ceil(src.w / 2), Math.ceil(src.h / 2))
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, half.fb)
      gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, half.w, half.h, gl.COLOR_BUFFER_BIT, gl.LINEAR)
      temps.push(half)
      src = half
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fb)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, small.fb)
    gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR)
    const px = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, small.fb)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    for (const tt of temps) this.release(tt)
    this.release(small)
    // 프리멀티 → 스트레이트 (FBO 는 행이 문서 위→아래 순서)
    const out = new ImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      const a = px[i * 4 + 3]
      if (!a) continue
      out.data[i * 4] = (px[i * 4] * 255) / a
      out.data[i * 4 + 1] = (px[i * 4 + 1] * 255) / a
      out.data[i * 4 + 2] = (px[i * 4 + 2] * 255) / a
      out.data[i * 4 + 3] = a
    }
    this.repaint()
    return out
  }

  /**
   * 그리기 밖에서 GPU 를 쓴 뒤(픽셀 읽기·축소본·텍스처 복제) 같은 순간에 화면을 다시 그린다.
   * preserveDrawingBuffer 를 끈 WebGL 은 그런 작업 뒤 비어 있는 화면 버퍼를 한 프레임 내보내서 검게 번쩍인다 (2026-09-21 깜빡임).
   */
  private lastRender: Parameters<GLRenderer['render']> | null = null
  private repaint(): void {
    if (this.lastRender) this.render(...this.lastRender)
  }

  /** 합성 결과의 한 픽셀 (스포이트 "모든 레이어" 표본) — 스트레이트 RGBA */
  readPixel(x: number, y: number): [number, number, number, number] | null {
    const t = this.composite()
    if (!t) return null
    const px = Math.floor(x * this.scale)
    const py = Math.floor(y * this.scale)
    if (px < 0 || py < 0 || px >= t.w || py >= t.h) return null
    const gl = this.gl
    const out = new Uint8Array(4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.repaint()
    const a = out[3]
    if (!a) return [0, 0, 0, 0]
    return [Math.round((out[0] * 255) / a), Math.round((out[1] * 255) / a), Math.round((out[2] * 255) / a), a]
  }

  dispose(): void {
    const gl = this.gl
    for (const t of this.textures.values()) gl.deleteTexture(t)
    this.textures.clear()
    this.freeTarget(this.A)
    this.freeTarget(this.B)
    this.freeTarget(this.scratch)
    if (this.prefix) this.freeTarget(this.prefix.t)
    this.A = this.B = this.scratch = null
    this.prefix = null
    for (const t of [this.white, this.lutTone, this.lutHue, this.lutGrad]) gl.deleteTexture(t)
    for (const p of [this.progLayer, this.progOver, this.progCopy, this.progAdjust, this.progPresent]) gl.deleteProgram(p.p)
    gl.deleteBuffer(this.quad)
    gl.deleteVertexArray(this.vao)
    this.unused.clear()
    this.doc = null
    for (const t of this.pool) this.freeTarget(t)
    this.pool = []
  }
}
