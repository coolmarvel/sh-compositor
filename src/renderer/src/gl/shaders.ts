/**
 * WebGL2 셰이더 — 합성 모드 수식은 `core/doc/blend.ts`(W3C = Photoshop)와 **같아야 한다**.
 * 텍스처는 프리멀티플라이드로 올리고, 셰이더 안에서 스트레이트로 풀어 수식을 적용한 뒤 다시 프리멀티플라이드로 쓴다.
 */

export const QUAD_VS = `#version 300 es
in vec2 aPos;          // 0..1 단위 사각형
uniform mat3 uToClip;  // 단위 → 클립 공간
uniform mat3 uToUV;    // 단위 → 레이어 텍스처 좌표
out vec2 vUV;
void main() {
  vec3 p = uToClip * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = (uToUV * vec3(aPos, 1.0)).xy;
}`

const BLEND_GLSL = `
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipColor(vec3 c) {
  float l = lum(c); float n = min(min(c.r, c.g), c.b); float x = max(max(c.r, c.g), c.b);
  if (n < 0.0) c = l + (c - l) * l / (l - n);
  if (x > 1.0) c = l + (c - l) * (1.0 - l) / (x - l);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
vec3 setSat(vec3 c, float s) {
  float mx = max(max(c.r, c.g), c.b); float mn = min(min(c.r, c.g), c.b);
  if (mx <= mn) return vec3(0.0);
  return (c - mn) * s / (mx - mn);
}
float dodge(float b, float s) { if (b <= 0.0) return 0.0; if (s >= 1.0) return 1.0; return min(1.0, b / (1.0 - s)); }
float burn(float b, float s) { if (b >= 1.0) return 1.0; if (s <= 0.0) return 0.0; return 1.0 - min(1.0, (1.0 - b) / s); }
float hard(float b, float s) { return s <= 0.5 ? b * 2.0 * s : b + (2.0 * s - 1.0) - b * (2.0 * s - 1.0); }
float soft(float b, float s) {
  if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
  float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
  return b + (2.0 * s - 1.0) * (d - b);
}
// 순서 = core/doc/types BLEND_MODES 인덱스
vec3 blendFn(int m, vec3 b, vec3 s) {
  if (m == 1) return min(b, s);
  if (m == 2) return b * s;
  if (m == 3) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
  if (m == 4) return max(b, s);
  if (m == 5) return b + s - b * s;
  if (m == 6) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
  if (m == 7) return vec3(hard(s.r, b.r), hard(s.g, b.g), hard(s.b, b.b));
  if (m == 8) return vec3(soft(b.r, s.r), soft(b.g, s.g), soft(b.b, s.b));
  if (m == 9) return vec3(hard(b.r, s.r), hard(b.g, s.g), hard(b.b, s.b));
  if (m == 10) return abs(b - s);
  if (m == 11) return b + s - 2.0 * b * s;
  if (m == 12) return setLum(setSat(s, sat(b)), lum(b));
  if (m == 13) return setLum(setSat(b, sat(s)), lum(b));
  if (m == 14) return setLum(s, lum(b));
  if (m == 15) return setLum(b, lum(s));
  return s;
}
`

/**
 * 레이어 한 장을 배경(backdrop) 위에 합성.
 * 입력: 레이어 텍스처(프리멀티), 배경 텍스처(프리멀티, 같은 FBO 크기), 마스크(R), 클리핑 기준 알파.
 */
export const LAYER_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uLayer;
uniform sampler2D uBackdrop;
uniform sampler2D uMask;
uniform sampler2D uClip;
uniform bool uHasMask;
uniform bool uHasClip;
uniform float uOpacity;
uniform int uBlend;
uniform vec2 uTarget;  // FBO 크기
out vec4 outColor;
${BLEND_GLSL}
void main() {
  vec2 fc = gl_FragCoord.xy / uTarget;
  vec4 bp = texture(uBackdrop, fc);
  if (vUV.x < 0.0 || vUV.y < 0.0 || vUV.x > 1.0 || vUV.y > 1.0) { outColor = bp; return; }
  vec4 sp = texture(uLayer, vUV);
  float as = sp.a * uOpacity;
  if (uHasMask) as *= texture(uMask, vUV).r;
  if (uHasClip) as *= texture(uClip, fc).a;
  if (as <= 0.0) { outColor = bp; return; }
  vec3 cs = sp.a > 0.0 ? sp.rgb / sp.a : vec3(0.0);
  float ab = bp.a;
  vec3 cb = ab > 0.0 ? bp.rgb / ab : vec3(0.0);
  vec3 B = uBlend == 0 ? cs : clamp(blendFn(uBlend, cb, cs), 0.0, 1.0);
  vec3 mixed = (1.0 - ab) * cs + ab * B;
  float ao = as + ab * (1.0 - as);
  vec3 co = as * mixed + (1.0 - as) * ab * cb; // 프리멀티
  outColor = vec4(co, ao);
}`

/** 텍스처 복사 (프리멀티 그대로) — 폴더 결과를 레이어처럼 쓰기 전 등 */
export const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = texture(uTex, vUV); }`

/**
 * 조정 레이어 — 배경 전체에 보정(톤 LUT·색조/채도 응답표·그라데이션 맵·그레인)을 걸고 불투명도·마스크·클리핑만큼 섞는다.
 * 수식은 core/adjust.ts applyAdjustments 와 같다.
 */
export const ADJUST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uBackdrop;
uniform sampler2D uTone;     // 256×1 RGBA8 — R/G/B 채널 LUT
uniform sampler2D uHue;      // 361×1 RGBA32F — (색조 이동, 채도 %, 밝기 %)
uniform sampler2D uGrad;     // 256×1 RGBA8 — 그라데이션 맵
uniform sampler2D uMask;
uniform sampler2D uClip;
uniform bool uHasMask;
uniform bool uHasClip;
uniform bool uDoHsl;
uniform bool uColorize;
uniform vec3 uColorizeHSL;   // (색조 도, 채도 0~1, 밝기 −1~1)
uniform bool uHasGrad;
uniform float uGrain;
uniform float uOpacity;
uniform vec2 uTarget;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h2r(float p, float q, float t) {
  if (t < 0.0) t += 1.0; if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}
void main() {
  vec2 fc = gl_FragCoord.xy / uTarget;
  vec4 bp = texture(uBackdrop, fc);
  if (bp.a <= 0.0) { outColor = bp; return; }
  vec3 c = bp.rgb / bp.a;
  vec3 i = floor(c * 255.0 + 0.5) / 255.0;
  c = vec3(texture(uTone, vec2((i.r * 255.0 + 0.5) / 256.0, 0.5)).r,
           texture(uTone, vec2((i.g * 255.0 + 0.5) / 256.0, 0.5)).g,
           texture(uTone, vec2((i.b * 255.0 + 0.5) / 256.0, 0.5)).b);
  if (uDoHsl) {
    float hi = max(max(c.r, c.g), c.b); float lo = min(min(c.r, c.g), c.b);
    float l = (hi + lo) * 0.5; float d = hi - lo; float h = 0.0; float s = 0.0;
    if (d > 0.0) {
      s = min(1.0, d / (1.0 - abs(2.0 * l - 1.0)));
      if (hi == c.r) h = (c.g - c.b) / d; else if (hi == c.g) h = (c.b - c.r) / d + 2.0; else h = (c.r - c.g) / d + 4.0;
      h *= 60.0; if (h < 0.0) h += 360.0;
    }
    float amount;
    if (uColorize) { h = uColorizeHSL.x; s = uColorizeHSL.y; amount = uColorizeHSL.z; }
    else {
      vec3 r = texture(uHue, vec2((floor(h + 0.5) + 0.5) / 361.0, 0.5)).rgb;
      h = mod(h + r.x, 360.0); s = clamp(s * (1.0 + r.y / 100.0), 0.0, 1.0); amount = clamp(r.z / 100.0, -1.0, 1.0);
    }
    l = clamp(amount >= 0.0 ? l + (1.0 - l) * amount : l * (1.0 + amount), 0.0, 1.0);
    if (s <= 0.0) c = vec3(l);
    else {
      float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s; float p = 2.0 * l - q; float hh = h / 360.0;
      c = vec3(h2r(p, q, hh + 1.0/3.0), h2r(p, q, hh), h2r(p, q, hh - 1.0/3.0));
    }
  }
  if (uHasGrad) {
    float y = floor(dot(c * 255.0, vec3(0.299, 0.587, 0.114)) + 0.5);
    c = texture(uGrad, vec2((y + 0.5) / 256.0, 0.5)).rgb;
  }
  if (uGrain > 0.0) c = clamp(c + (hash(gl_FragCoord.xy) - 0.5) * uGrain * 1.6 / 255.0, 0.0, 1.0);
  float k = uOpacity;
  if (uHasMask) k *= texture(uMask, vUV).r;
  if (uHasClip) k *= texture(uClip, fc).a;
  vec3 base = bp.rgb / bp.a;
  outColor = vec4(mix(base, c, k) * bp.a, bp.a);
}`

/**
 * 화면 표시 — 문서 텍스처를 뷰포트 변환으로, 투명 부분은 체커보드, 확대 시 픽셀 그리드.
 */
export const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uDoc;
uniform float uZoom;       // 문서 1px 당 화면 px
uniform vec2 uDocSize;
uniform bool uGrid;
uniform vec3 uCheckA;
uniform vec3 uCheckB;
out vec4 outColor;
void main() {
  vec4 d = texture(uDoc, vUV);
  // 체커보드: 화면 8px 칸 (문서 좌표로 환산해 팬/줌에 붙어 다닌다)
  vec2 docPx = vUV * uDocSize;
  vec2 cell = floor(docPx * uZoom / 8.0);
  vec3 bg = mod(cell.x + cell.y, 2.0) < 1.0 ? uCheckA : uCheckB;
  vec3 c = d.rgb + bg * (1.0 - d.a);
  if (uGrid && uZoom >= 8.0) {
    vec2 f = fract(docPx);
    float line = step(f.x, 1.0 / uZoom) + step(f.y, 1.0 / uZoom);
    c = mix(c, vec3(0.5), clamp(line, 0.0, 1.0) * 0.45);
  }
  outColor = vec4(c, 1.0);
}`
