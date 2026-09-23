---
title: 웹 로컬 편집기·headless 서버·MCP
created: 2026-09-22
updated: 2026-09-22
domain: development
---

# 웹 로컬 편집기·headless 서버·MCP

## 개요

v1.1.0부터 같은 core·application 코드로 세 가지 실행 방식을 만든다. 구조 결정은 [ADR-0005](../adr/0005-application-layer.md), 남은 과제는 [todo](../todo.md) P2.

| 실행 방식 | 문서의 권위 | 만드는 명령 | 결과물 |
|---|---|---|---|
| Windows 데스크톱 (기존) | 편집기 탭 | `npm run dist:win` | NSIS 인스톨러 |
| 웹 로컬 편집기 | 브라우저 탭 (복구본은 IndexedDB) | `npm run build:web` | `out/web` 정적 파일 |
| headless 서버 + MCP | 서버 메모리 (owner별) | `npm run build:server` | `out/server/index.mjs`·`taskWorker.mjs` |

서버는 브라우저의 로컬 파일을 볼 수 없고, 웹 탭의 문서와 서버 문서는 따로 있다. 둘을 잇는 방법은 파일 가져오기·내보내기뿐이다.

## 웹 로컬 편집기

- `window.api`가 없으면 `src/renderer/src/platform/index.ts`가 `platform/web.ts`의 브라우저 구현을 넣는다. `window.api.platform === 'web'`.
- 파일: File System Access가 있으면(Chromium 계열) 저장 대화상자를 한 번 열고 같은 파일에 다시 저장한다. 없으면 `<input type=file>`로 열고 다운로드로 저장한다.
  "경로"는 그 탭 안에서만 통하는 토큰(`web-file:…`)이다. 새로 고친 뒤 최근 파일로는 다시 열 수 없다.
- 자동 저장·복구: IndexedDB `sh-compositor/recovery` (같은 출처의 브라우저 탭이 함께 쓴다 — 다른 탭에 열려 있는 문서의 복구본도 새 탭의 복구 목록에 보인다). 용량이 모자라면 "브라우저 저장 공간이 부족해 자동 저장하지 못했습니다" 알림을 띄운다. 편집은 계속된다.
- 페이지를 떠날 때 저장하지 않은 문서가 있으면 브라우저 기본 확인 창이 뜬다 (사용자 정의 대화상자는 불가).
- 창 버튼은 전체 화면 전환만 남는다. 파일 ▸ 끝내기는 숨긴다. Ctrl+N·Ctrl+W는 브라우저가 먼저 가로채므로 메뉴를 쓴다.
- 모델: `out/web/models/sam/`(`resources/sam`이 있으면 복사), 배경 제거 오프라인 데이터는 `WEB_BGRM=1`일 때만 `models/bgrm/`으로 복사한다(약 350MB). 기본은 온라인 모델.
- 리터칭 WASM을 못 받으면 TS 기준 경로로 동작한다.
- 확인: `npm run build:web && npm run e2e:web` (헤드리스 Chromium, 15건). 개발 서버 `npm run dev:web` (포트 5190), 미리보기 `npm run preview:web` (5191).

## headless 서버

```bash
npm run build:server
SHC_TOKENS="me:<32자 이상 비밀>" npm run server        # HTTP 127.0.0.1:8787 (+ /mcp)
node out/server/index.mjs --stdio                      # 로컬 MCP (stdio, 사용자 한 명)
```

| 환경 변수 | 기본 | 뜻 |
|---|---|---|
| `SHC_TOKENS` | (필수, HTTP) | `owner:token[:read|write|all]` 를 `;`로 구분 (그 밖의 scope·토큰 속 `:` 는 시작 실패). `read`면 조회만. 또는 `SHC_TOKENS_FILE`=JSON `[{owner,token,scopes}]` |
| `SHC_HOST`·`SHC_PORT` | 127.0.0.1·8787 | 바인드 주소 |
| `SHC_PUBLIC_URL` | `http://host:port` | 다운로드 링크·보호 자원 메타데이터의 바깥 주소 |
| `SHC_ALLOWED_ORIGINS` | 없음 | `Origin` 헤더가 붙은 요청은 여기 있을 때만 허용 (CORS는 인증이 아니다) |
| `SHC_AUTH_SERVERS` | 없음 | 보호 자원 메타데이터에 알릴 OAuth 인가 서버 (공지만, 토큰 검증은 정적 토큰) |
| `SHC_MAX_UPLOAD_MB`·`SHC_MAX_PIXELS`·`SHC_MAX_LAYERS` | 32·40,000,000·64 | 업로드 바이트·디코딩 픽셀·레이어 수 |
| `SHC_MAX_DOCS`·`SHC_MAX_ASSET_MB` | 20·512 | owner별 문서 수·보관 파일 용량 |
| `SHC_MAX_CONCURRENT_JOBS`·`SHC_MAX_QUEUED_JOBS`·`SHC_JOB_TIMEOUT_MS` | 2·8·60000 | 동시 실행·owner별 대기·작업 기한 |
| `SHC_DOC_TTL_MIN`·`SHC_ASSET_TTL_MIN`·`SHC_OPERATION_TTL_MIN` | 1440·60·1440 | 문서·파일·끝난 작업/operationId 보관 |
| `SHC_HISTORY_LIMIT`·`SHC_HISTORY_BUDGET_MB` | 30·512 | 문서별 실행취소 단계·메모리 |
| `SHC_WORKER_HEAP_MB`·`SHC_MAX_INLINE_UPLOAD_KB` | 512·4096 | 작업 스레드 V8 힙·base64 업로드 한도 |
| `SHC_STDIO_OWNER` | local | stdio 모드의 owner |

한도 숫자는 기본값일 뿐 실측으로 정한 값이 아니다. 운영 전 실제 메모리·동시성으로 조정한다.

### HTTP

| 경로 | 설명 |
|---|---|
| `POST /v1/assets` | PNG 원문 (`Content-Type: image/png`, 선택 `X-Filename`) → 201 AssetInfo. 형식은 내용으로 판정 |
| `GET /v1/assets/:id` | 자신의 업로드·결과 파일. 남의 것은 404 |
| `POST/GET/DELETE /mcp` | MCP Streamable HTTP (stateless, JSON 응답) |
| `GET /healthz` | `{ ok, jobsRunning, jobsQueued, jobsKept, workerThreads }` (인증 없음, 내용 없음) |
| `GET /.well-known/oauth-protected-resource` | 보호 자원 메타데이터. 401 응답의 `WWW-Authenticate`가 이 주소를 알린다 |

오류 본문은 `{ error: { code, message, details? } }`. 상태 코드: 400 INVALID_INPUT · 401 토큰 · 403 FORBIDDEN/Origin · 404 NOT_FOUND · 409 REVISION_CONFLICT/CANCELLED · 413 RESOURCE_LIMIT · 415 UNSUPPORTED_CAPABILITY · 504 TIMEOUT.
로그(stderr JSON 한 줄): 요청 ID·경로·상태·시간·owner·도구·문서/작업 ID·오류 코드. 토큰·이미지·도구 인자는 남기지 않는다.

## MCP 도구 (16)

`compositor_capabilities` · `compositor_document_{create,import,get,delete,undo,redo}` · `compositor_asset_upload_base64` · `compositor_layer_{list,update}` ·
`compositor_image_{resize,crop}` · `compositor_filter_apply` · `compositor_export` · `compositor_job_{get,cancel}`. 결과 파일은 리소스 `compositor://assets/{assetId}`로도 읽는다.

- 변경은 모두 `docId`·`expectedRevision`·`operationId`. 같은 operationId + 같은 입력 = 같은 작업·결과(재실행 없음), 다른 입력 = `INVALID_INPUT`(`details.reason = OPERATION_ID_REUSED`).
- 변경 도구는 작업을 시작하고 `waitMs`(기본 10초, 최대 30초)만큼 기다린다. 못 끝나면 작업 상태를 돌려주고 `compositor_job_get`으로 이어 본다.
- 커밋 직전에 revision·취소·기한을 다시 검사한다. 앞선 편집이 있으면 `REVISION_CONFLICT`, 기한을 넘기면 타이머가 늦게 깨어나도 `TIMEOUT`으로 버린다.
- 이미지는 도구 인자로 주고받지 않는다: HTTP 업로드 → assetId, 결과는 `resource_link` + `downloadUrl`(같은 Bearer 토큰). stdio만 작은 base64 업로드를 쓴다.
- 스키마(zod → JSON Schema)는 안내용이다. application이 다시 검증하고 스키마 밖 키도 거절한다. 호출자는 인증 정보에서만 정한다 (인자에 owner를 넣어도 거절).

Claude Code 연결 예:

```bash
claude mcp add --transport http sh-compositor http://127.0.0.1:8787/mcp --header "Authorization: Bearer <토큰>"
claude mcp add sh-compositor -- node /절대경로/out/server/index.mjs --stdio
```

확인: `npm run build:server && npm run e2e:mcp` (공식 SDK 클라이언트로 HTTP·stdio 15건). Claude 앱 등 실제 AI 클라이언트에서의 연결은 아직 사람이 확인하지 않았다.

## 관련 코드

- 명령·서비스: `src/application/{commands,service,repository,assets,jobs,codecs,errors,validate,info}.ts`
- 편집기 연결: `src/renderer/src/editor/commandBridge.ts`, `store.ts` (`revision`·`commitTo`·`tabSignal`)
- 웹: `src/renderer/src/platform/{index,web,idb}.ts`, `vite.web.config.ts`, `scripts/web-assets.cjs`, `test/e2e/web.mjs`
- 서버: `src/server/{main,http,mcp,auth,config,workerRunner,taskWorker}.ts`, `scripts/build-server.mjs`, `test/e2e/mcp.mjs`, `test/server.test.ts`
