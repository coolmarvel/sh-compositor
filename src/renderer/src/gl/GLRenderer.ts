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
import { QUAD_VS, LAYER_FS, COPY_FS, ADJUST_FS, PRESENT_FS } from './shaders'
import { BLEND_MODES, layerMatrix, renderEffects, hasEffects, adjustmentTables, type Bitmap, type Doc, type Layer, type LayerTransform } from '@core/index'

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
  private progCopy: Prog
  private progAdjust: Prog
  private progPresent: Prog
  private textures = new Map<Bitmap, WebGLTexture>()
  private effectsCache = new WeakMap<Bitmap, { key: unknown; mask: unknown; bitmap: Bitmap; inset: number }>()
  private zero: WebGLTexture
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
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('이 PC 에서 WebGL2 를 쓸 수 없습니다. 그래픽 드라이버를 업데이트해 주세요.')
    this.gl = gl
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    this.vao = vao
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    this.progLayer = this.program(QUAD_VS, LAYER_FS)
    this.progCopy = this.program(QUAD_VS, COPY_FS)
    this.progAdjust = this.program(QUAD_VS, ADJUST_FS)
    this.progPresent = this.program(QUAD_VS, PRESENT_FS)
    this.zero = this.solidTexture([0, 0, 0, 0])
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
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
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
  }

  /** 문서에 없는 비트맵의 텍스처를 버린다 (메모리) */
  private collect(keep: Set<Bitmap>): void {
    for (const [b, t] of this.textures)
      if (!keep.has(b)) {
        this.gl.deleteTexture(t)
        this.textures.delete(b)
      }
  }

  // ── 문서 ──
  /** 표시할 문서 (칠하는 중이면 store.preview). 같은 문서면 다시 합성하지 않는다 — 개미 행진·오버레이만 다시 그릴 때 */
  setDoc(doc: Doc | null): void {
    if (doc !== this.doc) this.dirty = true
    this.doc = doc
  }

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

  /**
   * dst ← backdrop 위에 레이어(텍스처 + 변형)를 합성. backdrop 과 dst 는 서로 다른 FBO.
   * 합성 전에 backdrop 을 dst 로 복사하므로, 레이어가 덮지 않는 곳은 배경 그대로다.
   */
  private drawLayerInto(
    dst: Target,
    backdrop: Target,
    tex: WebGLTexture,
    mats: { toClip: Float32Array; toUV: Float32Array },
    opts: { opacity: number; blend: number; mask: WebGLTexture | null; clip: Target | null }
  ): void {
    const gl = this.gl
    this.blit(backdrop, dst)
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
    gl.viewport(0, 0, dst.w, dst.h)
    const { p, u } = this.progLayer
    gl.useProgram(p)
    gl.uniformMatrix3fv(u.uToClip, false, mats.toClip)
    gl.uniformMatrix3fv(u.uToUV, false, mats.toUV)
    this.bindTex(0, tex, u.uLayer)
    this.bindTex(1, backdrop.tex, u.uBackdrop)
    this.bindTex(2, opts.mask ?? this.white, u.uMask)
    this.bindTex(3, opts.clip?.tex ?? this.white, u.uClip)
    gl.uniform1i(u.uHasMask, opts.mask ? 1 : 0)
    gl.uniform1i(u.uHasClip, opts.clip ? 1 : 0)
    gl.uniform1f(u.uOpacity, opts.opacity)
    gl.uniform1i(u.uBlend, opts.blend)
    gl.uniform2f(u.uTarget, dst.w, dst.h)
    this.drawQuad()
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
   * 한 부모의 자식들을 cur 에 합성. cur/other 는 번갈아 쓰는 두 FBO — 결과가 들어 있는 쪽을 돌려준다.
   * 규칙은 core/doc/render.ts compositeChildren 과 같다.
   */
  private compositeChildren(parentId: string | null, cur: Target, other: Target, keep: Set<Bitmap>): Target {
    const doc = this.doc!
    const W = cur.w
    const H = cur.h
    const kids = doc.layers.filter((l) => l.parentId === parentId)
    let base: Target | null = null
    const dropBase = (): void => {
      if (base) this.release(base)
      base = null
    }
    for (const l of kids) {
      const clip = l.clip ? base : null
      if (!l.clip) dropBase()
      if (!l.visible) {
        if (!l.clip) {
          base = this.target(W, H)
          this.clear(base)
        }
        continue
      }
      if (l.clip && !clip) continue
      if (l.kind === 'adjustment' && l.adjustment) {
        const maskTex = l.mask?.enabled ? this.texture(l.mask.bitmap) : null
        if (l.mask) keep.add(l.mask.bitmap)
        this.drawAdjustInto(other, cur, l, clip, maskTex)
        ;[cur, other] = [other, cur]
        continue
      }
      let tex: WebGLTexture
      let mats: { toClip: Float32Array; toUV: Float32Array }
      let maskTex: WebGLTexture | null = null
      if (l.kind === 'group') {
        // 격리 합성: 투명 바탕에 자식들
        const g1 = this.target(W, H)
        const g2 = this.target(W, H)
        this.clear(g1)
        this.clear(g2)
        const res = this.compositeChildren(l.id, g1, g2, keep)
        const spare = res === g1 ? g2 : g1
        this.release(spare)
        tex = res.tex
        mats = this.fullMats()
        if (l.mask?.enabled) {
          maskTex = this.texture(l.mask.bitmap)
          keep.add(l.mask.bitmap)
        }
        this.drawLayerInto(other, cur, tex, mats, { opacity: l.opacity, blend: BLEND_INDEX[l.blend] ?? 0, mask: maskTex, clip })
        if (!l.clip) {
          base = this.target(W, H)
          this.clear(base)
          this.drawLayerInto(base, this.emptyTarget(W, H), tex, mats, { opacity: 1, blend: 0, mask: maskTex, clip: null })
        }
        this.release(res)
        ;[cur, other] = [other, cur]
        continue
      }
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
      this.drawLayerInto(other, cur, tex, mats, { opacity: l.opacity, blend: BLEND_INDEX[l.blend] ?? 0, mask: maskTex, clip })
      ;[cur, other] = [other, cur]
      if (!l.clip) {
        base = this.target(W, H)
        this.clear(base)
        this.drawLayerInto(base, this.emptyTarget(W, H), tex, mats, { opacity: 1, blend: 0, mask: maskTex, clip: null })
      }
    }
    dropBase()
    return cur
  }

  private empty: Target | null = null
  private emptyTarget(w: number, h: number): Target {
    if (!this.empty || this.empty.w !== w || this.empty.h !== h) {
      this.freeTarget(this.empty)
      const gl = this.gl
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.params(gl.NEAREST)
      const fb = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      this.empty = { fb, tex, w, h }
      this.clear(this.empty)
    }
    return this.empty
  }

  /** 문서 → FBO (바뀌었을 때만) */
  private composite(): Target | null {
    const doc = this.doc
    if (!doc) return null
    if (!this.dirty && this.A) return this.A
    const s = Math.min(1, this.maxTex / Math.max(doc.width, doc.height))
    this.scale = s
    const W = Math.max(1, Math.round(doc.width * s))
    const H = Math.max(1, Math.round(doc.height * s))
    if (!this.A || this.A.w !== W || this.A.h !== H) {
      this.freeTarget(this.A)
      this.freeTarget(this.B)
      for (const t of this.pool) this.freeTarget(t)
      this.pool = []
      this.A = this.target(W, H)
      this.B = this.target(W, H)
    }
    this.clear(this.A)
    this.clear(this.B!)
    const keep = new Set<Bitmap>()
    const res = this.compositeChildren(null, this.A, this.B!, keep)
    if (res !== this.A) [this.A, this.B] = [res, this.A]
    this.collect(keep)
    this.dirty = false
    this.mipDirty = true
    return this.A
  }

  /** 화면 그리기 */
  render(view: View, grid: boolean, checker: { a: [number, number, number]; b: [number, number, number] }, bg: [number, number, number]): void {
    const gl = this.gl
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
    }
    const docT = this.composite()
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, cw, ch)
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (!docT || !this.doc) return
    // 축소 표시는 밉맵으로 (자글거림 방지) — 확대는 가장 가까운 이웃(픽셀이 또렷하게)
    gl.bindTexture(gl.TEXTURE_2D, docT.tex)
    if (view.zoom < 1) {
      if (this.mipDirty) {
        gl.generateMipmap(gl.TEXTURE_2D)
        this.mipDirty = false
      }
      this.params(gl.LINEAR, true)
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
    this.freeTarget(this.empty)
    for (const t of this.pool) this.freeTarget(t)
  }
}
