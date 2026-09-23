/**
 * 웹 로컬 편집기 빌드 (plans/0004 3단계) — Electron 없이 정적 호스팅. `npm run build:web` → out/web.
 * 렌더러 소스는 데스크톱과 같다. window.api 가 없으면 platform/web.ts 가 브라우저 구현을 넣는다.
 * 모델(SlimSAM·배경 제거 오프라인 데이터)은 scripts/web-assets.cjs 가 out/web/models 로 복사한다 (없으면 해당 기능만 안내 후 거절·온라인 모델).
 */
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  root: resolve('src/renderer'),
  // 어느 하위 경로에 올려도 동작하게 상대 경로
  base: './',
  resolve: {
    alias: {
      '@core': resolve('src/core'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  worker: { format: 'es' },
  define: {
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(pkg.version),
    // 웹은 platform 의 bgAssetsUrl(models/bgrm/)을 쓴다
    __BG_ASSETS_DEV__: JSON.stringify('')
  },
  server: { port: 5190, strictPort: true, fs: { allow: [resolve('.')] } },
  preview: { port: 5191, strictPort: true },
  build: {
    outDir: resolve('out/web'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@imgly/background-removal-online/')) return 'bgremove-online'
          if (id.includes('node_modules/@imgly/background-removal/')) return 'bgremove-offline'
          if (id.includes('node_modules/onnxruntime-web/') || id.includes('node_modules/onnxruntime-common/')) return 'bgremove-ort'
          return undefined
        }
      }
    }
  }
})
