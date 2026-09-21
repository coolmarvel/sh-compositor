/**
 * 배포 소스 보호: main/preload/renderer 번들 난독화 (file-converter scripts/obfuscate.cjs 이식).
 *
 * ⚠ V8 바이트코드(bytecodePlugin)는 쓰지 않는다 — 컴파일 플랫폼에 종속이라 WSL 빌드 → Windows 실행 시
 * cachedDataRejected 로 앱이 죽는다 (pdf-editor v1.4.2 사고). 난독화된 JS 는 플랫폼 무관.
 *
 * 보수 설정 원칙: 기능·성능에 영향 주는 옵션(controlFlowFlattening, deadCodeInjection,
 * selfDefending)은 끄고, 문자열 숨김 + 식별자 hex 화만 적용.
 *
 * 대형 공개 라이브러리 청크는 제외한다 — 공개 코드라 보호 가치가 없고 성능만 깎는다:
 *   heic2any-* / UTIF-* (이미지 디코더) /
 *   bgremove-* · ort.* (imgly·onnxruntime — eval/wasm 사용이라 난독화 시 동작 위험도 있음)
 * 우리 코드는 index-*(엔트리+공유 청크)·대화상자 청크에 들어 있다.
 *
 * 실행: npm run build 파이프라인에서 자동 (electron-vite build 직후)
 */
const fs = require('fs')
const path = require('path')
const JavaScriptObfuscator = require('javascript-obfuscator')

const out = (...seg) => path.join(__dirname, '..', 'out', ...seg)
const assetsDir = out('renderer', 'assets')

const SKIP = /^bgremove-|^ort\.|^heic2any-|^UTIF-|^fflate/

const targets = [
  out('main', 'index.js'),
  out('preload', 'index.js'),
  ...fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js') && !SKIP.test(f))
    .map((f) => path.join(assetsDir, f))
]

for (const p of targets) {
  const f = path.relative(out(), p)
  const src = fs.readFileSync(p, 'utf8')
  const t0 = Date.now()
  const result = JavaScriptObfuscator.obfuscate(src, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    stringArray: true,
    stringArrayThreshold: 0.6,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayEncoding: [],
    splitStrings: false,
    unicodeEscapeSequence: false,
    sourceMap: false
  }).getObfuscatedCode()
  fs.writeFileSync(p, result)
  console.log(`obfuscated ${f}: ${(src.length / 1024).toFixed(0)}KB → ${(result.length / 1024).toFixed(0)}KB (${Date.now() - t0}ms)`)
}
