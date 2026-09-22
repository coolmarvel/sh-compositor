const { execFileSync } = require('node:child_process')
const { resolve } = require('node:path')
execFileSync(
  'rustc',
  [
    '--edition=2021',
    '--crate-type=cdylib',
    '--target=wasm32-unknown-unknown',
    '-C',
    'opt-level=3',
    '-C',
    'panic=abort',
    '-C',
    'strip=symbols',
    resolve('native/retouch/kernel.rs'),
    '-o',
    resolve('src/renderer/src/assets/retouch.wasm')
  ],
  { stdio: 'inherit' }
)
