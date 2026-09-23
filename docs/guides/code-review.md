---
title: 실행 경로 검수 결과와 웹 전환 경계
created: 2026-09-22
updated: 2026-09-22
domain: development
---

# 검수 범위와 결과

v1.0.4는 입력→도구→문서/이력→CPU/GPU 합성→저장/복구 흐름을 기준으로 검수했다.
정적 미사용 검사, 비용이 큰 루프·복사·비동기 경합 점검, 이전 구현과 차등 비교, 기능 E2E를 사용한다.
모든 입력 조합의 무결점이나 모든 성능 병목 제거를 뜻하지 않는다. 측정 환경과 수치는 session-log가 기준이다.

| 경로 | 확인한 문제·처리 | 코드 |
|---|---|---|
| CPU 합성·변형 | 원래 크기 정수 이동에도 보간, 픽셀 결과 배열 반복 생성, 불필요한 클리핑 버퍼 → 행 복사·재사용·필요 시 생성 | `core/doc/render.ts`, `blend.ts` |
| 선택 | 올가미 가로 구간마다 왼쪽 여백부터 순회 → 해당 구간만 표본 수 계산. 긴 점 목록 spread 제거 | `core/doc/selection.ts` |
| 필터·리터칭 | 필터의 전체 출력 버퍼와 획의 원본 보존은 기능상 필요. 리터칭의 기존 영역 복사/WASM 경로 유지 | `core/filters.ts`, `retouch.ts`, `tools/paint.ts` |
| GPU·미리보기 | dispose 누락 자원(프로그램·정점 버퍼·VAO·LUT·scratch·prefix) 정리, 사용하지 않는 zero/empty 제거 | `gl/GLRenderer.ts` |
| 저장·이력 | 저장 완료를 캡처한 탭·버전에 반영. 새로운 편집을 저장한 것으로 오인하지 않음 | `editor/io.ts`, `store.ts` |
| 자동 저장 | 동시 tick 공유, 비동기 처리 뒤 탭 생존 확인, 종료 쓰기와 복구 삭제 순서 보장 | `util/recoveryWriter.ts`, `editor/autosave.ts` |
| Worker | 요청·진행·오류 처리 공통화, 종료/전송 예외 정리, 같은 스냅샷 동시 인코딩 공유 | `util/workerClient.ts`, `editor/{pack,bgremove,objectSelect}.ts` |
| 셸·구독 | IPC 등록 해제 함수 반환, App/TitleBar cleanup·자동 저장 타이머 정리 | `preload/index.ts`, `App.tsx`, `TitleBar.tsx` |
| 파일·모델 | 기존 파일을 먼저 덮어쓰지 않는 교체 저장, 모델 서빙 중복 제거와 형제 폴더 경계 차단 | `main/files.ts`, `main/index.ts` |
| 이미지·프로젝트 입력 | PNG/TIFF 크기 검사, PNG 청크/픽셀/필터 검사, 프로젝트 최대 크기 상수 중복 제거. 기존 PSD 크기 선검사 유지 | `core/png.ts`, `core/doc/{project,psd}.ts`, `editor/io.ts` |
| UI·패널·문서 구조 | 패널의 지연 축소본 처리와 effect cleanup 확인. 대화상자는 길이만을 이유로 분할하지 않음. 미사용 import·매개변수 제거 | `components/`, `tsconfig.{node,web}.json` |

## 웹으로 옮길 때

Rust 커널은 운영체제 DLL이 아니라 `wasm32-unknown-unknown` WebAssembly이다.
`WebAssembly.instantiate`로 브라우저에서 호출하며, 기존 React·TypeScript·WebGL2·Web Worker와 함께 재사용할 수 있다.
Electron 제거만으로 완성된 웹 앱이 되는 것은 아니다. 다음 경계를 웹용으로 연결해야 한다.

| 현재 데스크톱 경계 | 웹에서 필요한 구현 |
|---|---|
| `window.api.open/read/saveAs/write/chooseDir/openCompFolder` | 파일 입력·다운로드 또는 지원 브라우저의 File System Access, 폴더 형식은 별도 UX |
| `window.api.clipboard` | 브라우저 Clipboard API 및 권한·사용자 동작 조건 처리 |
| `window.api.recovery` | IndexedDB/OPFS 등 브라우저 로컬 저장소, 용량·삭제 정책 |
| `window.api.win`, 파일 연결·pendingOpen·실제 경로 | 웹용 셸·닫기 경고, 데스크톱 창 버튼/파일 연결 대체 |
| `bgrm://`, `aimodel://`와 개발용 `/@fs` URL | 서버 정적 모델 URL·CORS/CSP·모델 캐시/오프라인 다운로드 정책 |
| electron-vite/NSIS 빌드 | 웹용 Vite 엔트리·배포 base 경로·서버 설정, 브라우저 E2E |

v1.0.4 검수 시점에는 웹을 구현하지 않았다. v1.1.0에서 위 경계를 `src/renderer/src/platform/web.ts`로 구현했다. 실행·제약은 [웹·MCP 가이드](web-mcp.md), 구조 결정은 [ADR-0005](../adr/0005-application-layer.md).

## 추가 측정 대상

- 초대형 붓의 동기 계산, 획 시작 시 큰 레이어 펼치기/사본 생성.
- 큰 PNG/PSD 열기와 PNG 내보내기의 동기 인코딩·디코딩.
- CPU 스포이트 폴백은 GPU를 사용할 수 없을 때 전체 합성한다. 우선 범위 합성/캐시의 메모리 비용을 비교해야 한다.
- 대화상자 파일의 책임별 분리는 향후 해당 기능 변경 시 판단한다. 현재 기능 경계를 무작정 재배치하지 않는다.

검증: `test/review-*.test.ts`(회귀/경합), `test/review-bench.ts`(CPU 전후), `test/e2e/editor.mjs`(앱 전체).
