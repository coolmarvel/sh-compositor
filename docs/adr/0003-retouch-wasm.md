---
title: ADR-0003 리터칭 픽셀 연산의 Rust WebAssembly 가속
created: 2026-09-22
status: accepted
---

# ADR-0003: 리터칭의 영역 복사와 Rust WebAssembly

## 맥락

흐림·문지르기·리퀴파이가 붓 자국마다 `live.data.slice()`로 전체 레이어를 복사했다.
원본 Compositor의 흐림은 Core Image, 문지르기는 붓 크기의 작업 버퍼를 사용한다.
Swift 대 TypeScript만의 문제가 아니라 메모리 접근량과 계산 방식이 다르다.
사용자가 저수준 언어를 부분 도입하는 방법의 조사와 적용을 요청했다.

## 결정

- TypeScript 문서·이력·UI와 WebGL2 합성은 유지한다. CPU 픽셀 버퍼가 여전히 진실이다.
- `native/retouch/kernel.rs`: 세 도구의 스칼라 f64 픽셀 커널. Rust 표준 라이브러리만 사용하며 외부 crate가 없다.
- `src/core/retouchWasm.ts`: 표본에 필요한 사각형만 복사하고, 재사용 WASM 메모리에 입력·출력·선택 가중치를 배치한다.
  계산 후 변경 사각형만 기존 JS 비트맵에 돌려준다. WASM 메모리를 문서나 실행취소에 보관하지 않는다.
- `src/core/retouch.ts`: 영역 복사로 개선한 TypeScript 기준 구현. WASM 초기화/실행 실패 시 사용한다.
- 렌더러는 작은 번들 WASM을 시작 시 비동기 로드한다. 인터넷·사용자 시스템의 Rust 설치가 필요 없다.
- 바이너리 `src/renderer/src/assets/retouch.wasm`를 소스와 함께 보관한다. 커널 수정 시
  `rustup target add wasm32-unknown-unknown` 후 `npm run build:retouch`로 재생성한다.
  일반 JS 빌드·Windows 패키징에 Rust 설치를 강제하지 않는다.

## 대안과 한계

- C/C++ Node-API 애드온도 가능하지만 OS/아키텍처별 바이너리와 Electron 패키징 관리가 추가된다.
  현재 main/preload는 Node 기본 모듈만 쓰는 구조이므로 renderer에서 직접 사용할 WASM을 선택했다.
- GPU 셰이더 방식은 CPU 원본과의 동기화·읽어오기·정확도 규약을 더 크게 바꾼다. 이번에는 적용하지 않는다.
- WASM도 동기 연산이다. 매우 큰 붓이나 긴 이동 이벤트는 화면 스레드를 붙잡을 수 있다.
  Worker·작업 분할은 추가 측정 후 판단한다. 전체 레이어를 펼치는 획 시작 비용도 별개다.
- Rust `sqrt`와 JS `hypot`의 마지막 비트 차이에 따라 8비트 반올림 결과가 1 차이 날 수 있다.
  JS 기준과 최대 1 이내를 검증하며, 원본 TS와 영역 복사 TS는 바이트 일치를 검증한다.

## 검증 위치

- `test/retouch-reference.ts`: 변경 전 세 도구의 전체 복사 구현을 보존한 독립 비교 기준.
- `test/retouch.test.ts`: 세 모드·작은/큰 팁·경도·선택 가중치·경계·반복 자국 비교.
- `test/retouch-bench.ts`: 원본/영역 복사 TS/Rust WASM의 계산+전달 비용 비교 (렌더링 제외).
- `test/e2e/editor.mjs` F5: 설치본과 같은 Electron 번들의 WASM 로드·획·undo/redo 검증.
