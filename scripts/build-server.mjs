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
  // PSD 는 core/doc/psd.ts 가 Node 에서 캔버스 스텁을 넣는다
  banner: { js: `// SH Compositor server ${pkg.version}\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);` },
  define: { 'process.env.SHC_VERSION': JSON.stringify(pkg.version) },
  logLevel: 'info'
})

// 서버 번들에 React·렌더러 코드가 들어오면 실패 (ADR-0005). PSD 는 ag-psd 의 useImageData 로 캔버스 없이 동작한다
const bad = Object.keys(result.metafile.inputs).filter((f) => /node_modules\/react|renderer\/src/.test(f))
if (bad.length) {
  console.error('서버 번들에 들어오면 안 되는 모듈:', bad.join(', '))
  process.exit(1)
}
