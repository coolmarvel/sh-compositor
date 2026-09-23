---
title: ADR-0005 UI 독립 명령 계층과 플랫폼 경계 (웹·headless 서버·MCP)
created: 2026-09-22
status: accepted
---

# ADR-0005: UI 독립 명령 계층과 플랫폼 경계

## 상태

Accepted (v1.1.0). 계획 [0004](../plans/0004-web-mcp.md) 1~5단계를 MVP 범위로 구현하며 채택했다.

## 맥락

편집 동작(`editor/actions.ts`)은 전역 `editor`의 **활성 탭**을 읽고 쓴다. 이 때문에 두 문제가 있었다.

- 배경 제거·피사체 선택·내용 인식처럼 오래 걸리는 작업이 끝나기 전에 탭을 바꾸면 결과가 **다른 탭에 커밋**됐다. 진행 표시가 상태 줄에만 있고 화면을 막지 않는다.
- 웹·외부 자동화(MCP)가 같은 편집을 부를 수 없었다. `store.ts`는 React·활성 탭에 묶여 있어 서버에서 공유할 수 없다.

## 결정

1. **`src/application/`** = UI·플랫폼과 독립된 문서 명령 계층. React·전역 `editor`·`window.api`·대화상자를 import하지 않는다.
   - `commands/*.ts`: `parse(raw)`(문서를 보지 않는 입력 검증) + `run(doc, input, ctx?)`(새 Doc). v1.1.1 부터 36개 — 이미지·레이어·선택·픽셀(붓·그라데이션·리터칭·복제·복구·도형)·보정·필터. 등록부 `commands/index.ts`, 도구 설명 `catalog.ts`.
   - `service.ts`: 서버용 진입점. Principal(owner·scope), `docId`·`expectedRevision`·`operationId`, 작업(job) 큐·기한·취소, 보관 기간, 한도.
   - `repository.ts`·`assets.ts`·`jobs.ts`: 문서 저장소(버전 비교 커밋), 자산 저장소, 작업 실행기 계약. 메모리 구현만 있다.
   - `errors.ts`: 오류 코드 9종 (`INVALID_INPUT`·`NOT_FOUND`·`FORBIDDEN`·`REVISION_CONFLICT`·`RESOURCE_LIMIT`·`CANCELLED`·`TIMEOUT`·`UNSUPPORTED_CAPABILITY`·`INTERNAL`).
2. 픽셀 편집 규약 `bakeLayer`·`editPixels`·`adjustLayer`는 순수 함수라 **`core/doc/pixels.ts`로 옮겼다**. `editor/pixels.ts`는 재수출만 한다.
3. 편집기(데스크톱·웹)는 **탭 ID + revision**으로 커밋한다. `Tab.revision`은 이력에 남는 변경(기록·실행취소·다시 실행·끌기)마다 1 오른다. 활성 레이어 바꾸기 같은 `quiet` 변화는 올리지 않는다.
   `editor/commandBridge.ts`의 `capture()`→`land()`(=`commitTo`)는 탭이 닫혔으면 버리고, 문서가 바뀌었으면 결과를 버린 뒤 알린다.
   이미지 크기·이름 바꾸기는 application 명령을 그대로 부른다(`runCommand`). 명령을 늘릴 때 UI와 서버가 같은 결과를 내도록 이 경로를 쓴다.
4. **플랫폼 경계는 `window.api` 모양 그대로** 둔다. Electron은 preload가 넣고, 없으면 `renderer/src/platform/web.ts`가 브라우저 구현을 넣는다.
   웹 빌드는 `vite.web.config.ts`(같은 렌더러 소스). application을 브라우저 탭 저장소로 다시 감싸지는 않았다. 웹 로컬 편집기의 문서 권위는 편집기 탭이다.
5. **서버 문서는 브라우저 문서와 별개로 소유**한다. `src/server/`(HTTP + MCP)가 `DocumentService`를 직접 부른다. MCP 어댑터는 HTTP API를 다시 부르지 않는다.
   무거운 명령(필터·자르기)·내보내기는 `worker_threads`(요청마다 스레드, 취소·기한 시 종료)에서, 가벼운 명령(레이어 속성·크기)은 같은 스레드에서 돈다.
   결과 크기를 미리 아는 명령은 계산 전에 픽셀 한도를 검사한다(`resultSize`). 스레드 경계에서 바뀌지 않은 비트맵은 표식으로 바꿔 원래 버퍼를 다시 쓴다(`stripShared`·`restoreShared`) — 복제하면 이력 칸마다 문서 전체가 복사된다.
6. MCP는 공식 TypeScript SDK **1.30.0**(지원 최신 프로토콜 **2025-11-25**)에 고정한다. 계획서가 인용한 2026-07-28 명세는 이 SDK에 아직 없다.
   원격은 Streamable HTTP(stateless — 요청마다 서버·전송 생성), 로컬은 stdio. 인증은 설정 파일의 정적 Bearer 토큰(owner·scope)이다.

## 근거

- `window.api` 모양을 유지하면 기존 렌더러 코드(`io.ts`·`autosave.ts`·대화상자)를 고치지 않고 웹으로 옮길 수 있다. 별도 추상 인터페이스를 새로 만들면 모든 호출부를 바꿔야 한다.
- 전역 스토어를 서버에서 공유하는 대안은 탭·React 의존 때문에 제외했다. 명령만 순수 함수로 뽑아 두 곳에서 부르는 편이 차이가 적다.
- 명령 수만큼 도구를 늘리지 않고, 먼저 계획의 첫 도구 집합(크기·자르기·레이어 속성·필터·내보내기·작업)으로 제한했다. PSD·문자·AI는 서버 런타임에서 검증되지 않아 거절한다.
- revision 비교는 서버에서는 정수, 편집기에서는 탭별 정수로 같은 규칙을 쓴다. 문서가 불변이라 revision이 같으면 이력상 같은 문서다 (편집기의 `quiet` 변화는 예외 — 그 변화는 늦게 온 결과가 덮어도 되는 것만 둔다).
- stateless MCP는 문서 수명이 MCP 세션에 묶이지 않는다는 계획의 요구와 맞는다. 문서·자산·작업의 수명은 service의 TTL이 정한다.

## 결과

- 오래 걸린 작업이 다른 탭·새 편집을 덮던 버그가 없어졌다 (단위 `test/application.test.ts`, E2E N2).
- 웹 로컬 편집기(`npm run build:web`)와 headless 서버·MCP(`npm run build:server`)를 같은 core·application으로 만든다. 설치본(Electron)에는 서버 코드가 들어가지 않는다.
- 서버 문서·자산은 **메모리에만** 있다. 프로세스를 다시 띄우면 사라진다. 영속 저장소·다중 인스턴스·OAuth 인가 서버 연동·라이브 탭 조작은 구현하지 않았다 (todo P2).
- 명령을 추가할 때: `commands.ts`에 parse/run → `COMMANDS`·`CommandName` 등록 → MCP 도구(`server/mcp.ts`) → 단위·MCP E2E. 편집기 UI가 같은 동작을 가지면 `runCommand`로 바꾼다.
- 계약 위반을 막는 규칙: application에서 `window`·`editor`·React를 import하지 않는다. `scripts/build-server.mjs`가 번들에 React·렌더러 코드가 들어오면 실패시킨다. PSD 는 ag-psd 의 `useImageData` + 캔버스 스텁으로 Node 에서 동작해 v1.1.1 부터 서버가 가져오기·내보내기 한다. 도형은 `core/shape.ts` 순수 래스터라이저(편집기와 공유). 렌더러 전용 API(OffscreenCanvas·document)는 core 에 넣지 않는다.
