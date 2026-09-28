/** Rust 픽셀 커널 → WASM (단일 파일 rustc, 의존성 없음). 결과: src/renderer/src/assets/kernels.wasm (소스와 함께 보관, 서버 번들도 이 파일을 읽는다) */
const { execFileSync } = require('node:child_process')
const { resolve } = require('node:path')
execFileSync(
  'rustc',
  ['--edition=2021', '--crate-type=cdylib', '--target=wasm32-unknown-unknown', '-C', 'opt-level=3', '-C', 'panic=abort', '-C', 'strip=symbols', resolve('native/kernels/kernel.rs'), '-o', resolve('src/renderer/src/assets/kernels.wasm')],
  { stdio: 'inherit' }
)
