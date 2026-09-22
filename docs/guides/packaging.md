---
title: 배포 패키징 가이드
created: 2026-09-21
updated: 2026-09-22
domain: packaging
---

# 배포 패키징

규칙은 파일 변환기 `docs/guides/packaging.md` 를 이식 (원본 `~/project-seed/guides/desktop-packaging.md`).

## 공통

- 릴리스 전: `npm run typecheck && npm test && npm run build` + `npm run e2e` (112건, Xvfb).
- `release/` 는 git 에 올리지 않는다. AI 배경 제거 모델(~354MB)이 extraResources(`bgrm-data`)로 들어가 설치 파일이 큼.
- `@imgly/background-removal`·`-data` 는 **1.4.5 정확히 고정** — 신버전은 모델 이름이 달라(`isnet_fp16`) 오프라인 데이터와 안 맞는다.
  최신 모델은 별칭 `@imgly/background-removal-online`(=1.7.0)로 따로 — 모델은 CDN(staticimgly.com, CSP 허용)에서 받는다.
- **AI 개체 선택 모델**: `scripts/fetch-models.cjs`(`npm run models`, `dist:win` 이 먼저 부름)가 Hugging Face 에서 SlimSAM q8(비전 30MB + 프롬프트 5MB)을
  `resources/sam/Xenova/slimsam-50-uniform/` 로 받고, onnxruntime-web 의 `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` 을 `resources/sam/ort/` 로 복사한다.
  extraResources `resources/sam → sam`. 실행 중에는 main 의 `aimodel://assets/` 프로토콜로 서빙(개발: `<앱>/resources/sam`, 설치본: `resources/sam`) — 인터넷 불필요.
  `resources/sam/` 은 git 제외. 더 큰 fp32 가 필요하면 `SAM_FULL=1 npm run models`.

## 설치본에 싣는 것 (`build.files`)

`out/**` + `package.json` 만. `!node_modules/**/*` 로 node_modules 는 싣지 않는다 — 화면 쪽 라이브러리는 vite 가 묶고, main·preload 는 Node 기본 모듈만 쓴다.
main·preload 에서 npm 패키지를 import 하게 되면 이 규칙을 먼저 고칠 것(설치본에서 모듈을 못 찾아 시작 즉시 죽는다).
모델은 extraResources: `bgrm-data`(212MB)·`sam`(60MB).

## 난독화 (`scripts/obfuscate.cjs`, `npm run build` 에 연결)

- **bytecodePlugin 금지** (WSL 빌드 → Windows `cachedDataRejected` 즉사, pdf-editor 사고).
- 보수 설정: 식별자 hex + 문자열 배열만. 제외 청크(`SKIP = /^bgremove|…/`): `bgremove-*`(두 imgly 버전 + onnxruntime — `manualChunks`)·`bgremoveWorker-*`(배경 제거 일꾼)·`samWorker-*`(개체 선택 일꾼 — transformers.js)·`ort.*` · `heic2any-*`·`UTIF-*`.
- 일꾼(Web Worker)은 `worker: { format: 'es' }` — 동적 import 를 쓰는 일꾼은 기본 iife 로 묶이지 않는다.
- 설치 폴더에 `LICENSE.txt`·`THIRD_PARTY_NOTICES.md` (package.json `extraFiles`).
  청크 이름이 바뀌면 SKIP 을 함께 고친다.

## Windows

- `npm run dist:win` (WSL + Wine) → `release/SH-Compositor-Setup-<version>.exe`. App ID `xyz.chungmu.shcompositor`.
- 파일 연결: `.shcomp` (package.json `build.fileAssociations`). 실행 인자·두 번째 실행의 파일은 `app:openFiles` 로 연다.
- 설치 화면 자산: `build/{icon.ico,icon.png,installerSidebar.bmp,installerHeader.bmp,uninstallerSidebar.bmp,license.txt}`.
  재생성: `npm i --no-save @resvg/resvg-js png-to-ico jimp@0.22 && node scripts/gen-branding-assets.js` (겹친 레이어 아이콘, 사진 없음).

## macOS (미실행)

내부 이름 ASCII(`SH Compositor` 는 이미 ASCII), ad-hoc 서명 — 맥에서 첫 빌드 시 파일 변환기 가이드의 체크리스트대로.

## 리터칭 WASM (v1.0.3)

`src/renderer/src/assets/retouch.wasm`은 Vite가 해시 이름의 에셋으로 묶어 app.asar에 넣는다.
사용자의 PC에는 Rust·외부 DLL·네트워크가 필요 없다.
`native/retouch/kernel.rs` 수정 시 개발 환경에서 Rust의 `wasm32-unknown-unknown` 타깃을 설치하고
`npm run build:retouch`를 실행한다. 소스와 생성 WASM을 함께 관리하고 차등 테스트를 통과시킨다.
일반 `npm run build`는 저장된 WASM을 사용한다(ADR-0003).
