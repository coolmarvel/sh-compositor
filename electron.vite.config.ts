import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@core': resolve('src/core'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    // 일꾼(배경 제거·저장)은 동적 import 를 쓰므로 ES 모듈로 묶는다 (기본 iife 는 코드 분할을 못 함)
    worker: { format: 'es' },
    // 일부 라이브러리가 Node 전역(Buffer 등)을 참조해서 브라우저에서 정의해 줌
    define: {
      global: 'globalThis',
      // 도움말 → 정보 대화상자의 버전 표기
      __APP_VERSION__: JSON.stringify(pkg.version),
      // AI 배경 제거 모델 에셋의 dev(순수 브라우저) 폴백 경로 — Electron에선 bgrm:// 프로토콜 사용
      __BG_ASSETS_DEV__: JSON.stringify('/@fs' + resolve('node_modules/@imgly/background-removal-data/dist') + '/')
    },
    build: {
      // 성능 프로파일용: SC_NOMINIFY=1 npx electron-vite build → 함수 이름이 살아 있는 번들 (배포 빌드는 그대로 압축·난독화)
      minify: process.env.SC_NOMINIFY ? false : 'esbuild',
      rollupOptions: {
        output: {
          // 배경 제거 라이브러리(두 버전)를 이름 붙은 청크로 — scripts/obfuscate.cjs 가 이름으로 난독화에서 뺀다 (eval/wasm)
          manualChunks(id) {
            if (id.includes('node_modules/@imgly/background-removal-online/')) return 'bgremove-online'
            if (id.includes('node_modules/@imgly/background-removal/')) return 'bgremove-offline'
            if (id.includes('node_modules/onnxruntime-web/') || id.includes('node_modules/onnxruntime-common/')) return 'bgremove-ort'
            return undefined
          }
        }
      }
    }
  }
})
