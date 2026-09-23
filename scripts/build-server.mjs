/**
 * headless 서버 번들 — src/server/main.ts·taskWorker.ts → out/server/*.mjs (esbuild, Node 20+).
 * MCP SDK·zod·fflate 까지 한 파일로 묶는다 (배포 시 node_modules 불필요). Electron 인스톨러에는 들어가지 않는다.
 */
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const result = await build({
  metafile: true,
  entryPoints: { index: 'src/server/main.ts', taskWorker: 'src/server/taskWorker.ts' },
  outdir: 'out/server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: true,
  legalComments: 'linked',
  // ag-psd 등 캔버스가 필요한 모듈은 서버 경로에서 import 하지 않는다 (application 은 core 의 순수 모듈만)
  banner: { js: `// SH Compositor server ${pkg.version}\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);` },
  define: { 'process.env.SHC_VERSION': JSON.stringify(pkg.version) },
  logLevel: 'info'
})

// 서버 경로에 캔버스가 필요한 PSD 모듈이 들어오면 실패 (core/index 같은 모음 import 를 쓰면 딸려 온다 — ADR-0005)
const bad = Object.keys(result.metafile.inputs).filter((f) => /core\/doc\/psd\.ts|node_modules\/ag-psd\/|node_modules\/react/.test(f))
if (bad.length) {
  console.error('서버 번들에 들어오면 안 되는 모듈:', bad.join(', '))
  process.exit(1)
}
