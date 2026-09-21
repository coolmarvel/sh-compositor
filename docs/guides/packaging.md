---
title: 배포 패키징 가이드
created: 2026-09-21
updated: 2026-09-21
domain: packaging
---

# 배포 패키징

규칙은 파일 변환기 `docs/guides/packaging.md` 를 이식 (원본 `~/project-seed/guides/desktop-packaging.md`).

## 공통

- 릴리스 전: `npm run typecheck && npm test && npm run build` + `node test/e2e/editor.mjs` (58건).
- `release/` 는 git 에 올리지 않는다. AI 배경 제거 모델(~354MB)이 extraResources(`bgrm-data`)로 들어가 설치 파일이 큼.
- `@imgly/background-removal`·`-data` 는 **1.4.5 정확히 고정** — 신버전은 모델 이름이 달라(`isnet_fp16`) 오프라인 데이터와 안 맞는다.
  최신 모델은 별칭 `@imgly/background-removal-online`(=1.7.0)로 따로 — 모델은 CDN(staticimgly.com, CSP 허용)에서 받는다.

## 난독화 (`scripts/obfuscate.cjs`, `npm run build` 에 연결)

- **bytecodePlugin 금지** (WSL 빌드 → Windows `cachedDataRejected` 즉사, pdf-editor 사고).
- 보수 설정: 식별자 hex + 문자열 배열만. 제외 청크(`SKIP`): `bgremove-*`(두 imgly 버전 + onnxruntime — `electron.vite.config.ts manualChunks` 가 이름을 붙임)·`ort.*` · `heic2any-*`·`UTIF-*`.
  청크 이름이 바뀌면 SKIP 을 함께 고친다.

## Windows

- `npm run dist:win` (WSL + Wine) → `release/SH-Compositor-Setup-<version>.exe`. App ID `xyz.chungmu.shcompositor`.
- 파일 연결: `.shcomp` (package.json `build.fileAssociations`). 실행 인자·두 번째 실행의 파일은 `app:openFiles` 로 연다.
- 설치 화면 자산: `build/{icon.ico,icon.png,installerSidebar.bmp,installerHeader.bmp,uninstallerSidebar.bmp,license.txt}`.
  재생성: `npm i --no-save @resvg/resvg-js png-to-ico jimp@0.22 && node scripts/gen-branding-assets.js` (겹친 레이어 아이콘, 사진 없음).

## macOS (미실행)

내부 이름 ASCII(`SH Compositor` 는 이미 ASCII), ad-hoc 서명 — 맥에서 첫 빌드 시 파일 변환기 가이드의 체크리스트대로.
