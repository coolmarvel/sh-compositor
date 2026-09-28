---
title: 세션 로그
created: 2026-09-21
updated: 2026-09-28
domain: development
---

# 세션 로그 (최신이 위)

이 파일이 **"언제 무슨 일이 있었나"의 SSOT**다. 세션마다 최상단에 블록 추가.
(커밋/푸시는 사용자가 직접·성긴 단위 — git history 를 이력 SSOT 로 삼지 않는다.)

블록 형식: `## YYYY-MM-DD — 제목` 아래에 **요청/피드백 → 수정 → 검증 → 다음** 순서로 간결하게.

## 2026-09-28 — v1.2.1 AI 지우개(LaMa)·간편 AI 메뉴, v1.2.0 커밋·푸시

**요청/피드백**: ① 마법봉으로 영역을 잡은 뒤 문지르기·흐리게·리퀴파이가 안 먹는다(개체 선택 W 뒤에는 된다). ② 갤럭시·구글·애플 AI 지우개처럼 빨간 형광펜으로 칠한 곳을 지우고 배경을 자연스럽게 채우는 기능,
일반인이 쓰기 쉽게 보기와 도움말 사이 또는 왼쪽 패널에서. 기존 배경 제거(투명)와 헷갈리지 않게. ③ 먼저 커밋·푸시.

**수정**
- 커밋·푸시(사용자 지시로 에이전트가 수행): v1.2.0 작업분 `4b0bf0b` → origin/main. 타입 검사·단위 101/101 재확인 후.
- ① 조사 결과 버그 아님: 마법봉은 클릭한 색과 허용 오차 안의 **거의 같은 색**만 고른다 → 그 안을 흐리게·문질러도 같은 색끼리 섞여 변화가 안 보이고, 무늬가 다른 픽셀은 선택 밖이라 막힌다. 개체 선택은 무늬 있는 개체 전체를 잡아 보인 것. 사용자에게 설명.
- ② **AI 지우개**: 모델 비교(IOPaint 철망 앞 사람 사진) — MI-GAN(28MB)은 흰 얼룩, LaMa 는 깨끗 → **LaMa OpenCV 판(92MB, Apache-2.0)**. `npm run models` 가 `resources/sam/inpaint/lama.onnx` 로.
  `core/inpaint.ts`(넓히기 3~20px + 페더, 약 2.2배 정사각 자르기, 512 넓이 평균 축소·쌍선형 확대, 섞기 — 지운 곳 밖·알파 불변) + `editor/inpaintWorker.ts`(ORT 1.31 wasm, 별칭 `@sam-ort`) + `tools/aiEraser.ts`(빨간 반투명 형광펜, 손 떼면 지움, `[ ]`).
  모델을 못 쓰면 내용 인식 채우기로 대신. J 로 스팟 복구와 번갈아, 도구 레일 아이콘, 옵션 줄(크기·선택 영역 지우기).
- 속도: wasm 1스레드 15.5초 → main `enable-features=SharedArrayBuffer` + 8스레드 **4.7초**(출력 동일). WebGPU(SwiftShader)는 결과가 전부 흰색·8분 → 사용 안 함. 웹은 1스레드(약 15초).
- **간편 AI(A) 메뉴** (보기와 도움말 사이): AI 지우개 · 선택 영역을 AI로 지우기 · 배경 흐리게(피사체 마스크 밖 정규화 흐림 — 피사체 색 번짐 없음) · 배경을 흰색으로 · 배경 투명하게(누끼, 기본 설정 배경 제거) · 피사체 선택 · 사진 자동 보정.
- 사용 설명서 칠하기·고치기 탭에 "간편 AI" 표(AI 지우개는 채우고 배경 제거는 비운다), 도구 탭 J 안내. 서버 unsupported 문구에 AI 지우개. ADR-0007.
- 버전 1.2.1 (PATCH).

**검증**: typecheck · 단위 **108/108**(inpaint 7: 팽창·자르기·가중치·섞기·큰 구멍·흐림·흰 배경 + LaMa 실모델로 빨간 사각형 제거) · build ·
Electron E2E **135/135**(P 그룹 6 추가: J 전환, AI 지우개 칠하기·화면 멈춤 800ms 미만·GPU=CPU, 선택 영역 지우기, 흰 배경, 배경 흐리게, 콘솔 오류 0) · 웹 E2E **17/17**(W16 AI 지우개 1스레드) · MCP E2E **25/25** ·
`npm run audit` 88장 중 간편 AI 메뉴·AI 지우개 옵션 줄·설명서 확인 · 잔여 프로세스 0.
인스톨러 v1.2.1 **325MB**(v1.2.0 247MB + LaMa 약 78MB 압축), `resources/sam/inpaint/lama.onnx` 포함 확인, 바탕화면 복사·SHA-256 일치(`d2013911…`), 옛 설치 파일 정리. 이번 작업분은 커밋하지 않았다.
**E2E 에서 잡은 것**: SharedArrayBuffer 를 켜자 배경 제거(imgly, ORT 1.17)가 코어 수(16)만큼 스레드를 띄우며 난독화된 일꾼 청크에서 `ReferenceError`("배경 제거 일꾼이 멈췄습니다") → 배경 제거 일꾼에서만 지워 1스레드 유지.
ORT 스레드 경고가 console.error 로 찍힘 → `logSeverityLevel: 3`. 테스트가 `past.at(-1).label`(이전 단계 이름)을 보던 것 → `history.label`.
**사고**: 진단 한 줄을 빼려고 `git checkout test/e2e/editor.mjs` 를 해 새 P 그룹까지 되돌림 → 다시 작성해 통과 확인.

**다음**: v1.2.1 설치본으로 실제 사진 AI 지우개 품질·시간 확인. 큰 개체를 지우면 흐린 문제(512 한계), 실제 GPU 에서 WebGPU 검증 — todo P2.

## 2026-09-23 — v1.2.0 포토샵 대비 부족 8가지 구현·Rust 커널 확장·서버 JPEG (사용자 선언 MINOR)

**요청**: "포토샵에 비해 부족한 9가지 중 8가지를 다 해 달라, Rust 로 성능도 올려라, 눈에 띄는 개선도 다 적용하고 1.2.0 으로 올리자". 16비트 색은 이번에 하지 않기로 미리 알렸다 (전면 재설계).

**수정**
- 닷지·번·스펀지 (O): `core/tone.ts applyTone`(범위 가중·노출·채도), `tools/paint.ts` Kind 'tone', 옵션 줄, MCP `tone_stroke`.
- 조정 레이어 5종 추가(흑백·색상 균형·활기·포스터화·한계값): `adjustment.more`, CPU `render.ts` + GL `uMore*` 이식, PSD 왕복, 대화상자 레이어 모드, MCP `layer_add`/`layer_update.more`.
- 색상 범위 선택(`selection.set colorRange`, 대화상자 미리보기) + **퀵 마스크(Q)**: `store.quickMask`·`withQuickMask` 임시 레이어(GPU 경로), 브러시/지우개 `target:'selection'`, Q 로 나갈 때 이력 한 단계. 마스크 추가의 Q 단축키는 뗐다.
- 그라데이션 덮기·경사와 엠보스: `core/effects.ts gradientOver/bevelOver`, 효과 대화상자 탭 2개, PSD gradientOverlay/bevel 가져오기·내보내기, MCP `layer_update.effects`.
- 브러시 팁·질감: `BrushSettings.tip/texture`(모양·각도·원형도·간격·흩뿌리기·지터·팁 이미지·질감 PNG), `StrokeCoverage` 결정적 난수(seed), 브러시 설정 대화상자·프리셋 3개, MCP `brush.tip/seed`.
- 글자별 서식: `TextData.runs`(`core/doc/textruns.ts` applyRun/shiftRuns/segments), `editor/text.ts` 줄바꿈·세로쓰기 런 지원, 편집 중 구간 선택 → 굵게·기울임·색·크기·글꼴, "부분 서식 지우기".
  **버그**: textarea `onBlur` 가 옵션 줄 클릭에도 커밋해 부분 서식이 불가능했다 → 초점이 옵션 줄·팝오버로 가면 커밋하지 않음.
- 펜·패스·벡터 마스크: `core/doc/path.ts`(앵커·서브패스·평탄화·`pathMask`·`samplePath`·**`effectiveMask`** = CPU·GL·PSD 공용 마스크), `tools/pen.ts`(클릭·끌기·닫기·Ctrl 꼭짓점 전환·Backspace·Enter·Esc),
  패스 패널(선택으로·채우기·붓으로 선·벡터 마스크·삭제), 메뉴 "벡터 마스크 떼기", .shcomp `shPaths/shVectorMask`, MCP 6도구(`path_{set,delete,to_selection,fill,stroke}`·`layer_vector_mask`). ADR-0006.
- 원근·왜곡은 이미 있음(`move.ts applyDistort`). 격자 메시 워프는 하지 않았다.
- **Rust 커널**: `native/kernels/kernel.rs` 한 파일(리터칭 dab + 가우시안 블러 + 중간값) → `kernels.wasm`. `test/kernel-bench.ts` 로 TS 와 비교해 **중간값 약 2.5배·가우시안 1.3~1.7배** → 채택, 닷지·번·스펀지는 느려서 **미채택**.
  `core/kernels.ts`·`filters.ts setNativeKernels`(폴백·≤1바이트 차등 테스트), 서버 작업 스레드도 같은 wasm(`server/kernels.ts`). 옛 `native/retouch`·`retouch.wasm`·`build-retouch.cjs` 삭제.
- 그 밖의 개선: `adjustLayer` 가 선택 경계(+필터 여백)만 계산, 스팟 복구 근접 일치 `Math.random` → `mulberry32`(결정적), 서버 **JPEG** 가져오기·내보내기(`jpeg-js` 0.4.4 BSD-3, 흰 배경·품질 90, SOF 크기 검사로 디코딩 전 한도),
  업로드 Content-Type 허용 목록(png·jpeg·psd·zip·octet-stream), `layer_list.effects`(켜진 효과 이름), 작업 스레드 예외를 서버 로그에 `task failed` 로 남김(클라이언트엔 INTERNAL 만).
- 사용 설명서(F1): O·P·Q·색상 범위·조정 레이어·글자별 서식 행, MCP 탭은 카탈로그(58)에서 자동.

**검증**: typecheck · 단위 **101/101**(codecs 3·kernels·commands 신규 포함) · build · Electron E2E **129/129**(O 그룹 9 추가: 닷지·번·스펀지, 색상 범위, 퀵 마스크, 브러시 설정, 효과 탭, 조정 레이어 GPU=CPU, 펜·패스·벡터 마스크, 글자별 서식) ·
웹 E2E **15/15** · MCP E2E **25/25**(M19b·M19c 추가, M23 이 58도구 전부 호출, JPEG 왕복) · 잔여 프로세스 0.
**E2E 에서 잡은 것**: Q 를 퀵 마스크로 바꾸면서 옛 C7·I4 가 `press('q')` 로 마스크를 만들던 것 → 메뉴로. MCP "느린 작업"이 Rust 중간값 때문에 기한(2.5초) 안에 끝나 M12 가 깨짐 → 모션 블러(TS, 10초 이상)로.
jpeg-js 결과 `Buffer` 를 그대로 transfer 해 `DataCloneError`(INTERNAL) → 독립 `Uint8Array` 로 복사. 업로드가 image/png 만 받아 JPEG 415 → 허용 목록. 웹 W13 이 `retouch*.wasm` 을 막던 것 → `kernels`.
**`npm run audit` 86장에서 잡은 것**: 브러시 설정 미리보기가 비어 있었다 — MUI Dialog(Portal)는 첫 커밋 뒤에 내용을 붙여 `useRef` 캔버스가 첫 effect 에서 null(콜백 ref 상태로 고침, O4 가 픽셀 검사) + `Box component="canvas"` 의 width/height 가 CSS 로 취급돼 300×150 이던 것.
레이어 효과 탭 7개가 두 줄로 접힘 → 대화상자 600px·탭 `nowrap`. 설명서 MCP 탭 파일 형식에 JPEG 추가.
인스톨러 v1.2.0 바탕화면 복사, 옛 v1.1.1 설치 파일 정리. 커밋은 사용자 지시 대기.

**다음**: v1.2.0 설치본 테스트(펜·퀵 마스크·브러시 팁 체감), 16비트 색(별도 계획 필요), 메시 워프, 닷지·번 Rust 재측정은 필요할 때만 — todo.

## 2026-09-23 — v1.1.1 MCP 도구 51개(편집기 기능 전부)·사용 설명서 MCP 탭·실제 AI 클라이언트 검증

**요청**: v1.1.0 커밋·푸시(사용자 지시로 에이전트가 수행, `62d3932`). MCP 를 로컬에서 쓸 수 있는지, Claude 외 AI 에서도 범용으로 쓸 수 있는지. "제공하는 모든 기능을 MCP tools 로 세팅하고, 사용 설명서에 MCP 탭을 넣고, 싹 테스트해서 결과 보고".

**수정**
- 명령 4 → **36** (`src/application/commands/{image,layers,selection,pixels,adjust,filter,shape}.ts`): 캔버스 크기·회전·반전·투명 여백·병합·안내선 / 레이어 추가(픽셀·폴더·조정·올린 PNG)·속성(효과·조정 설정·변형·도형·마스크 켜기)·삭제·복제·순서·그룹·해제·병합·마스크 5종·활성·반전·복사해서 새 레이어 /
  선택 8종+다듬기 5종 / 채우기·지우기·선 그리기·내용 인식·붓·그라데이션·리터칭 3종·복제 도장·스팟 복구·도형 / 보정(Adjustments 전체)·빠른 보정·흑백 등 5종·필터 8종.
  획은 점 배열 한 번 = 한 실행취소 단계. 편집기 `tools/paint.ts`·`misc.ts` 와 같은 규칙(붓 간격·리터칭 간격·복제 오프셋·내용 인식 복구).
- MCP 도구 16 → **51** (`server/mcp.ts` 는 카탈로그 기반 등록 + zod 스키마 표). 도구 이름·설명 SSOT `application/catalog.ts` — 서버 등록과 사용 설명서 MCP 탭이 같은 표. `test/commands.test.ts` 가 카탈로그↔스키마↔명령 등록부를 대조.
- 서버 코덱: PNG·PSD·.shcomp 가져오기, PNG·.shcomp·PSD 내보내기 (`codecs.ts`, 내용으로 판정). ag-psd 는 Node 에서 캔버스 스텁으로 동작 → 번들 검사에서 psd 금지 해제(React·렌더러만 금지).
- 도형 래스터라이저 `core/shape.ts`(SDF + 4×4 초표본) — 편집기의 OffscreenCanvas 렌더를 이것으로 교체해 편집기·서버 결과 동일. 문서 정보에 선택 경계·안내선, 문서 목록·이름 바꾸기·히스토그램 조회 추가.
- 사용 설명서(F1) **MCP 탭**: MCP 가 무엇인지·연결(stdio·HTTP)·작업 순서·서버에서 못 하는 것·도구 51개 표(카탈로그에서 생성).
- 서버에서 못 하는 것(문자·AI 3종·JPEG/WebP/HEIC/TIFF)은 capabilities.unsupported 와 설명서에 같은 문구.

**검증**: typecheck · 단위 **93/93**(commands 4 추가: 카탈로그 대조·도형·명령 전수 스모크·PSD/shcomp 왕복) · build · Electron E2E **120/120**(L10 이 MCP 탭 포함) · 웹 E2E **15/15** ·
MCP E2E **23/23**(M16~M23: SDK 클라이언트로 도구 51개 전부 호출, 결과 PNG 픽셀 검사, PSD/.shcomp 왕복) · 잔여 프로세스 0.
**실제 AI 클라이언트**: Claude Code(`claude -p --mcp-config`, Sonnet)를 HTTP 로 붙여 "120×80 문서 → 빨간 사각형·파란 타원 → 타원만 블러 → PNG" 지시 → 도구 5회·7턴·$0.14 로 완료, 내려받은 PNG 픽셀(흰 바탕·빨강·파랑·흐린 가장자리) 확인. 로그에 토큰 없음.
사용 설명서 MCP 탭 스크린샷 3장 확인(가로 넘침 0). 인스톨러 v1.1.1 **247MB**, app.asar 버전 1.1.1·web/server 미포함, 바탕화면 복사·SHA-256 일치, v1.1.0 설치 파일 정리. 커밋은 하지 않았다.

**다음**: ChatGPT 등 다른 클라이언트 연결 확인(HTTPS 공개 주소 필요), 문자 레이어 서버 지원(글꼴 래스터화), JPEG 코덱 — todo P2.

## 2026-09-22 — v1.1.0 명령 계층·웹 로컬 편집기·headless 서버·MCP (계획 0004 1~5단계)

**요청**: Codex 인계(handoff·plans/0004)를 받아 이어서 진행. 범위를 묻자 "한 번에 다 해줘". 도중에 **1.1.0 으로 올리자**(사용자 선언), 끝나면 E2E·Playwright 검증 후 인스톨러.

**수정**
- 안정성: `workerClient` 요청별 `signal`(그 요청만 취소, 늦은 답 버림)·`timeoutMs`(일꾼 종료), `SharedJob`(공유 인코딩은 소비자 모두 떠나야 취소), 자동 저장 종료 시 인코딩 취소.
  이력 바이트 예산 `core/doc/history.ts`(공유 버퍼 한 번만 셈, 직전 1단계 유지), 환경 설정 "실행 취소 메모리"(기본 1024MB)·작업 내역 패널 MB 표시.
- 버그: 배경 제거·피사체 선택·내용 인식·캔버스 크기·필터·가져오기가 await 뒤 **활성 탭**에 커밋 → 작업 중 탭을 바꾸면 다른 탭에 들어감.
  `Tab.revision`·`commitTo`·`tabSignal` + `editor/commandBridge.ts capture/land` 로 시작한 탭·revision 에만 커밋, 바뀌었으면 버리고 알림. 탭을 닫으면 그 탭의 추론을 그만 기다림.
- 명령 계층 `src/application/`(commands·service·repository·assets·jobs·codecs·errors·validate), `editor/pixels.ts` → `core/doc/pixels.ts`. 이미지 크기·이름 바꾸기가 명령 경유. ADR-0005.
- 웹: `platform/{index,web,idb}.ts`(File System Access/다운로드, IndexedDB 복구·용량 초과 알림, Clipboard, 전체 화면, 떠나기 확인), `vite.web.config.ts`, 모델 복사 `scripts/web-assets.cjs`. 웹에서 창 닫기·최소화·끝내기 숨김.
- 서버: `src/server/`(HTTP 업로드·다운로드·/mcp, 정적 Bearer 토큰·Origin 검사·보호 자원 메타데이터, worker_threads, 구조화 로그), esbuild 번들 `out/server`.
  MCP 16도구(공식 SDK 1.30.0, 프로토콜 2025-11-25 — 계획서의 2026-07-28 은 SDK 에 없음), stdio·Streamable HTTP(stateless).
- 검토 에이전트 지적 반영: 크기 결과를 계산 전에 픽셀 한도 검사·자르기는 스레드로, `core/doc/pixels` 가 `core/index` 를 거쳐 서버 번들에 ag-psd 를 끌어오던 것(빌드 검사 추가),
  토큰 scope 가 모르는 값이면 쓰기 권한이 되던 것, 대기 중 redo 라벨 오류, 문서 삭제 시 대기 작업이 큐에 남던 것, 잘못된 X-Filename 500·과대 업로드 413 대신 연결 끊김,
  스레드 왕복 뒤 이력 비트맵 공유가 깨지던 것(`stripShared`/`restoreShared`), 레이어 클릭(quiet)만으로 배경 제거 결과가 버려지던 것.
- 서버 기한 타이머가 부하 중 2초 늦게 깨어난 사례(MCP E2E M12) → 커밋 직전에도 기한 검사.

**검증**: typecheck · 단위 **89/89** · build · Electron E2E **120/120**(N 그룹 5 추가, Xvfb) · 웹 E2E **15/15**(헤드리스 Chromium) · MCP E2E **15/15**(SDK 클라이언트 HTTP·stdio) ·
`npm run audit` 79장 중 환경 설정·작업 내역 확인 · 잔여 Electron·서버·브라우저 프로세스 0 (검토 반영 후 전체 재실행 기준).
**인스톨러**: 첫 빌드가 288MB — `build.files` 의 `out/**` 에 웹 빌드(SAM 35MB)·서버 번들이 딸려 들어감 → `!out/web`·`!out/server` 제외 후 **247MB**(v1.0.4 와 같음), app.asar 에 web/server 없음·retouch.wasm 있음.
v1.1.0 바탕화면 복사·SHA-256 일치(`5015f9d8377bcc44…`), 옛 v1.0.4 바탕화면 설치 파일 정리. 커밋·푸시는 하지 않았다.
**사고**: 확인하려고 `npx asar extract-file … package.json` 을 프로젝트 폴더에서 실행 → 빌드용 package.json 이 프로젝트 것을 덮어씀. HEAD 에서 복원 후 변경분 재적용, typecheck·단위·build:server 재확인 (인스톨러는 덮어쓰기 전에 구운 것).

**다음**: v1.1.0 설치본 테스트(배경 제거 중 탭 바꾸기·실행 취소 메모리). MCP 를 실제 AI 클라이언트에 연결해 보기, 서버 한도 실측 — todo P2.

## 2026-09-22 — Claude 인계와 웹·외부 MCP 확장 가이드라인

**요청**: Claude로 이어갈 수 있도록 미흡한 점·보완 우선순위와 향후 웹·외부 MCP 설계 가이드라인 작성.

**수정**: `handoff.md`에 현재 기준점·보존할 계약·다음 세션 지시문을 정리. `plans/0004-web-mcp.md`에 비용/메모리/취소 과제, 브라우저와 서버의 문서 소유권, 공통 명령 계층, 버전·멱등성·job·인증·자산 수명과 단계별 완료 기준 제안. CLAUDE 인덱스·todo 연결. 구현·배포·버전 변경은 없음.
앞선 사용자 커밋·푸시 요청으로 코드 기준 `deccd04`가 origin/main에 반영된 상태에서 작성했다. 아래 이전 블록의 미커밋 표기는 당시 구현 완료 시점의 기록이다.

**검증**: 기존 코드·ADR·검수 가이드와 대조, 공식 MCP 명세와 SDK/클라이언트 지원 버전 구분. 문서 링크·참조 경로와 `git diff --check` 확인. 문서만 변경하여 코드 테스트는 재실행하지 않음; 직전 코드 검증은 아래 블록 참조.

**다음**: `handoff.md`로 인계. 실제 구현 요청 시 계획의 해당 단계부터 진행하고 채택한 구조는 ADR로 기록.

## 2026-09-22 — v1.0.4 실행 경로 검수·성능·저장·자원 수명 리팩토링

**요청**: Rust를 섞어도 웹으로 옮길 수 있는지 확인, 전체 실행 흐름의 비용·중복·미사용 코드 검수와 리팩토링.

**수정**: CPU 합성의 정수 이동/원래 크기는 행 복사로 처리, 픽셀별 결과 배열 재사용, 다음 레이어가 클리핑할 때만 기준 알파 버퍼 생성.
올가미는 선택 구간의 픽셀별 표본 수를 계산해 왼쪽 여백 반복 순회 제거. 긴 점 목록의 spread 최대값 호출 제거.
저장 완료는 요청 당시 탭·문서 버전에 묶음. 자동 저장은 중복 실행을 합치고 비동기 작업 뒤 탭 생존 여부를 재검사하며 종료 시 쓰기 완료 후 정리.
저장/배경 제거/SAM Worker 요청 처리를 공통화(전송 실패·오류·종료 정리), 같은 문서의 동시 인코딩 요청 공유.
IPC 구독·자동 저장 타이머의 React cleanup, GPU 프로그램·버퍼·텍스처·FBO 해제 보완.
모델 서빙 공통화·경로 접두사 검사 수정, 파일 저장은 임시 파일을 완성한 뒤 교체. PNG/TIFF 크기 검사와 PNG 잘린 데이터 검사 보완.
미사용 import·변수·메서드 제거, node/web 타입 검사에 noUnusedLocals/noUnusedParameters 추가.

**측정**: CPU 전용, 준비 1회 후 5회 중앙값. 2000×1500·5레이어 합성 **653.51→294.22ms**.
8000×1000 문서 오른쪽 30×500 올가미 **66.14→4.20ms**. 렌더링·파일 I/O 제외, 재현 `node --import tsx test/review-bench.ts`.

**검증**: 새 차등/경합/파일 검증 12건 포함 단위 **75/75**, 타입 검사(미사용 검사 포함)·build 통과.
Electron 전체 **115/115**(Xvfb), 종료 후 잔여 Electron 없음. PSD 덮어쓰기·자동 저장→강제 종료→복구 포함.
Windows v1.0.4 인스톨러 생성, app.asar 버전/WASM 포함 확인. 바탕화면 복사본 SHA-256 일치.
바탕화면의 v1.0.3 설치 파일은 정리했고 프로젝트 release 원본은 유지했다. 커밋·푸시는 하지 않았다.

**다음**: Windows 설치본에서 실제 큰 문서와 저장 동작 확인. 웹 전환 경계와 추가 성능 과제는 `guides/code-review.md`·todo 참조.

## 2026-09-22 — v1.0.3 리터칭 영역 복사 + Rust WebAssembly

**요청**: file-converter 작업 커밋·푸시, 부팅 문서 학습, 흐림·문지르기·리퀴파이 버벅임 원인 조사와 저수준 언어 부분 도입.

**수정**: file-converter v1.5.1 기존 5파일 변경을 typecheck·44단위·build 검증 후 `b11fe32`로 main 푸시.
이 앱의 이전 미커밋 변경은 v1.0.0~1.0.2 로그와 대조해 유지했다.
세 도구가 자국마다 전체 레이어를 복사하던 것을 표본 사각형으로 축소했다.
Rust f64 커널을 WASM으로 번들(약 20KB), 재사용 작업 메모리에서 계산 후 변경 영역만 CPU 원본에 반영한다.
WASM 불가 시 영역 복사 TS 경로. 문서·선택·마스크·알파 잠금·이력·GPU 업로드 규약 유지. 결정 ADR-0003.

**측정**: 4000×3000·팁120·45자국 중 준비5개 제외, 계산+전달 중앙값(ms), 렌더링 제외:
흐림 21.013→1.004, 문지르기 22.096→0.311, 리퀴파이 19.501→0.585.
영역 복사 TS만으로는 각각 1.433/0.381/1.106ms: 주요 병목은 전체 복사였다.
측정 재현: `node --import tsx test/retouch-bench.ts`.

**검증**: 기존 TS 대 영역 복사 TS 바이트 일치, Rust 최대 1바이트 오차(부동소수 반올림) 비교 통과.
typecheck·단위 **63/63**·build 통과. Electron 전체 **115/115**(Xvfb), 종료 후 잔여 Electron 없음.
첫 E2E에서 선형 그라데이션은 흐려도 바이트가 변하지 않아 신규 변화 검사가 실패 → 무늬 입력으로 고쳐 F **13/13**, 전체 재실행 **115/115**.
WASM 재생성 SHA-256 일치, Windows app.asar의 WASM 포함 확인.
인스톨러 v1.0.3 바탕화면 복사·해시 일치 확인, 옛 v1.0.2 바탕화면 설치 파일 정리.
초기 Wine 실행은 샌드박스가 차단(Bad system call) → 승인 후 Windows 패키징 성공.

**다음**: Windows 실제 GPU에서 큰 사진·큰 붓 체감 확인. 획 시작의 레이어 펼치기와 초대형 붓 동기 계산 비용은 별도 과제.

## 2026-09-21 — v1.0.2 설치 크기 줄이기 + 사용 설명서(F1)

**요청**: 배경 제거 모델 중복을 줄여 최적화. 설명을 한 곳에 몰지 말고, 오른쪽 아래 패널처럼 큰 기능별 탭으로 나눈 "어떤 키가 무엇을 하는지" 설명서. 줄바꿈 보기 좋게.

**크기**: 설치본에 `node_modules` 가 통째로 실려 있었음(`@imgly` 모델 212MB 가 `bgrm-data` 와 중복 + MUI·ag-psd 등 397MB asar).
화면 쪽 라이브러리는 vite 가 이미 묶고, main·preload 는 Node 기본 모듈만 쓴다 → `build.files` 에 `!node_modules/**/*`.
app.asar+unpacked 627MB → 58MB. 설치 파일 430MB → 247MB, 설치 폴더 약 1.2GB → 597MB. Linux 로 묶어 실제 실행해 `bgrm://`·`aimodel://` 둘 다 200 확인.

**설명서**: `dialogs/HelpDialog.tsx` — 탭 7개(시작하기·도구·선택·칠하기·고치기·색 보정·필터·레이어·화면·파일), 표 한 줄 = 키 상자 + 한 문장씩.
도구 탭은 `tools/index.ts` 의 이름·단축키·설명을 그대로 씀(따로 적지 않음). 마지막 탭 기억(localStorage). F1·도움말 메뉴.
키 표시: 키는 상자, "끌기"·"클릭" 같은 동작은 굵은 글자, "A / B" 는 "또는".

**검증**: E2E L10(탭마다 내용·가로 넘침 없음) · audit 79장 확인.

## 2026-09-21 — v1.0.1 AI 개체 선택 + 로드맵 P3 (포토샵 기준 보완 8종)

**요청**: 올가미·사각형으로 크게 감싸면 포토샵·갤럭시처럼 피사체 테두리에 딱 맞게 잡히고, 이어서 넓히고 줄이며 다듬는 기능. 라이브러리가 있나 직접 만든 건가?
그 뒤 포토샵 기준으로 보완할 것들을 P3 로 잡아 구현.

**답**: 포토샵 개체 선택은 Adobe Sensei, 갤럭시는 삼성 자체 모델(둘 다 비공개). 공개된 같은 계열은 Meta **Segment Anything(SAM)**.
→ SlimSAM-50(Apache-2.0, q8 35MB)을 transformers.js 로 Web Worker 에서 오프라인 실행.

**구현**
- 모델·ORT wasm 을 `resources/sam`(fetch-models.cjs) → extraResources, main `aimodel://` 프로토콜, CSP 허용, 난독화 제외(`^samWorker`).
- 프롬프트: ONNX 에 상자 입력이 없어 상자·올가미 → 양성 점 1 + 바깥 음성 점 8. 라벨 2/3 상자 흉내는 마스크가 뒤집혀 버림.
- 후보 고르기(E2E 로 조정): 처음엔 확신도 최고 → 부분 원만 잡힘(K1). "0.2 이내 가장 큰 것" → 점만 줄 때 배경까지 먹은 후보(화면 90%)를 고름(K4·L1).
  최종: 양성 점 덮고 음성 점 피하는 후보만 → 영역이 있으면 0.2 이내 가장 큰 것, 점만 있으면 화면 절반 넘는 후보 빼고 확신도 최고.
- 고양이 사진에서 커튼 띠가 같이 잡힘 → 양성 점과 이어진 덩어리만 남김. 닫힌 올가미가 클릭으로 오인 → 끌린 최대 거리(`drag.far`).
- P3 8종: 개체 선택 · 가장자리 다듬기 · 조정 5종 · 선명하게/하이 패스/모자이크/노이즈 감소 · 정렬·분포 · 외부 광선(PSD 왕복) · 레이어 효과 복사/붙여넣기 · 히스토그램.
- 설치 파일이 721MB 로 커짐 → `@huggingface/transformers` 가 dependencies 라 네이티브 onnxruntime-node·sharp 까지 실림. vite 가 묶으므로 devDependencies 로 → 430MB(1.0.0 대비 +35MB = 모델).
- 검수에서 고친 것: `MoreAdjustHost` 훅 순서 위반, 설명 두 문장이 한 줄에 붙은 곳 5군데 분리, 히스토그램 단색일 때 중간값 1·그래프 안 보임(막대 방식으로).

**검증**: typecheck · 단위 58/58 · E2E **111/111**(K 개체 선택 7 · L P3 9 추가, Xvfb) · `npm run audit` 72장 확인 · 잔여 Electron 0.

**다음**: v1.0.1 설치 테스트 피드백 (실제 사진으로 개체 선택 품질·첫 분석 시간).

## 2026-09-21 — v1.0.0 PSD·로드맵 P1/P2 전부·성능·UI 문구 전수 정리

**요청** (스크린샷 3장 → `docs/feedback-archive/2026-09-21-v0.1.1/`): PSD 지원부터, 변환기 1.4.5 고정, 렉 최적화, 배경 제거가 화면에 바로 반영 안 됨,
텍스트 추가 뒤 이동이 바로 안 됨(포토샵은 어떻게?), 올가미가 뭔지 모르겠음, 탭의 파란 원 잘림(작게), 스티커 프리셋 버튼이 위아래 선에 붙음,
설명 문구의 "—"·어색한 줄바꿈(정보 창 "UI:/React") 전부 점검, P1·P2 모두. 도중: 배경 제거 "피사체 분석 중"에서 진행 막대 멈춤, 테스트 중 화면 깜빡임,
sudo 로 Xvfb 설치 허락, **1.0.0 으로 올리자**(사용자 선언).

**원인·수정**
- 배경 제거 미반영: 확정 안 한 그라데이션·끊긴 붓질의 **미리보기 문서가 남아** 캔버스가 옛 미리보기를 계속 그림 → `store.setPreview` 가 만든 시점의 문서에 묶고(`previewBase`), 문서가 바뀌면 무시(`shownDoc`).
- 분석 중 막대 멈춤: imgly 의 proxyToWorker 는 실제 구현이 없어 **ONNX 추론이 화면 스레드를 9.5초 붙잡음**(E2E 로 측정) → 직접 Web Worker(`bgremoveWorker.ts`)로. 진행은 "1/2 모델 불러오는 중 N%" → "2/2 피사체 분석 중"(움직이는 막대). 워커는 `worker.format:'es'`(동적 import).
- 렉 (프로파일로 하나씩): ① 레이어마다 화면 전체 복사 + 매번 클리핑 기준 버퍼 → 표준 혼합은 하드웨어 블렌딩, 특수 혼합은 영역만 복사, 기준 버퍼는 필요할 때만
  ② 활성 레이어 아래 합성 캐시(prefix) ③ **바뀐 영역만 다시 합성**(scissor, 선택만 바뀌면 합성 생략) ④ 상태 줄 색 읽기(readPixels 동기화)를 멈췄을 때만
  ⑤ `preserveDrawingBuffer` 끔(소프트웨어 렌더링에서 매 프레임 화면 읽어 가기 770ms) ⑥ 끄는 동안 저해상도·밉맵 생략(이동 도구만 저해상도) ⑦ 패널 memo·그리기 한 프레임 한 번·썸네일 JS 축소
  ⑧ 8K: 붓질 시작 텍스처 GPU 복제·끝 복사 제거·같은 내용 레이어 재합성 생략·텍스처 한 세대 보존·레이어 이동 정수 px ⑨ 저장·자동 저장 Web Worker(`packWorker`).
  결과(SwiftShader=GPU 없는 최악 조건, 2000×1500·5레이어): 레이어 끌기 긴 작업 합계 **134초 → 0.07초**, 붓질 10.4초 → 0.3초. 8K 도 프레임 17ms.
  측정 도구 `npm run perf`(PERF_SIZE·PERF_LAYERS·PERF_PROFILE).
- 캔버스 클릭 시 **화면이 위로 밀림**(focus 가 overflow:hidden 조상을 스크롤): `focus({preventScroll})` + 격자 `minmax(0,1fr)` + html/body/#root overflow hidden. (E2E I5 실패 추적 중 발견)
- 문자 뒤 이동: 포토샵은 패널에서 고르면 대상만 바뀌고 도구는 그대로 — 대신 **Ctrl+끌기 = 임시 이동**(대부분 도구), 문자 Ctrl+Enter 확정 시 이동 도구로.
- 올가미: 도구 이름 "올가미 (자유 선택)" + 툴팁 두 줄 설명(모든 도구 `desc`). 탭 저장 표시는 6px 원. 스티커 프리셋 nowrap.
- 문구: "—"·"A = B" 식 표현 전부 문장으로, `word-break: keep-all`, 한 문장 한 줄(`Lines`), 대화상자 폭 조정, 정보 창 표 형식. 전수 점검 스크립트 `npm run audit`(59장).
- 메뉴 하위 메뉴 지원(최근 파일·내보내기·새 조정 레이어·레이어 마스크·안내선·스킨).
- 폴더·조정 레이어 마스크가 자르기·캔버스 크기·회전에서 깨지던 버그(흰색으로 지워짐/늘어남/안 돎) 수정(`reframeMask`·`rotateBitmap90`).

**새 기능** (로드맵 P1·P2 전부): PSD 열기·저장(`core/doc/psd.ts`, ag-psd — 레이어·폴더·마스크·효과·조정·혼합·클리핑·잠금·해상도, 못 옮기는 것 안내, 크기 선검사),
눈금자·안내선·스냅, 피사체 선택(AI), 필압 굵기/진하기·브러시 사전 설정, 견본·내비게이터 패널(탭 묶음), 색 선택 HSB, 선 그리기·선택 매끄럽게, 레이어 잠금 3종,
레이어별·선택 영역 PNG 내보내기, 스냅샷·실행 취소 단계, 세로쓰기·줄 간격/자간, 도형 다시 고치기(모양 데이터), 필터 조정 레이어 CPU 대체, 환경 설정(Ctrl+K).

**검증**: typecheck ✓ · unit **52/52**(PSD 왕복 5 추가) · build ✓ · E2E **95/95**(Xvfb — 사용자 화면에 안 뜸, `npm run e2e`) · 잔여 Electron 0.

## 2026-09-21 — v0.1.1 첫 설치 피드백 반영 + 미완 항목 + 로드맵 + GitHub 공개

**피드백** (스크린샷 2장 → `docs/feedback-archive/2026-09-21-first-install/`, 이 대화는 file-converter 세션에서 이어짐):
1) 최대화 창에서 처음 연 이미지가 왼쪽 위에 붙음 — 가운데여야 함 2) 레이어 썸네일(세로로 긴 cat)이 행 아래로 넘침
3) 배경 제거: 최신(1.7)을 온라인 모드로, 오프라인이면 못 쓴다고 알림 4) 미완 항목 + 보완·추가 기능 제안을 문서화하며 진행 5) 공개 레포 생성·push.

**원인·수정**
- 1) 첫 맞춤이 창이 작을 때(최대화 전) 한 번만 계산됨 → `View.fit/cw/ch` + `adaptView`: 맞춤 상태면 창·문서 크기 변화에 다시 맞추고,
  사용자가 팬·줌했으면 화면 중심 유지. 도구가 `{...view}` 로 fit 을 복사해 와도 `ctx.setView` 가 해제.
  문서 크기가 바뀌면(자르기·캔버스 크기·실행취소) 스토어가 **동기적으로** 다시 맞춘다(`store.withView`, `editor/view.ts`) — rAF 그리기에서만 하면
  창이 뒤에 있을 때 rAF 가 멈춰 클릭이 옛 보기로 계산됐다(전체 E2E 에서 E3 자르기 실패로 발견).
- 2) 썸네일 칸이 CSS grid 라 img `height:100%` 가 안 먹음 → flex + `object-fit: contain` + overflow hidden.
- 3) `@imgly/background-removal-online`(npm 별칭 = 1.7.0, CDN staticimgly.com) 추가. 대화상자에 자동/내장/최신 + 정밀도(fp16/전정밀),
  연결 확인(`checkOnline` — 실제 요청), 최신 전용인데 오프라인이면 막고 "내장 모델로 진행" 안내. CSP 에 staticimgly.com 만 허용.
  두 라이브러리·onnxruntime 을 `manualChunks` 로 `bgremove-*` 청크에 모아 난독화 제외(전엔 `index-*` 로 섞여 난독화됨).
- 미완: `.comp` 폴더 열기, 폴더(그룹) 마스크·마스크 반전/페더·폴더·조정 레이어 마스크 칠하기, 스팟 복구 획 경계만 훑기.
- 보완: 상태 줄 커서 좌표·색, 최근 파일, WebP 내보내기, 자동 저장(1분)·비정상 종료 복구.
- **성능 버그 발견**: `GLRenderer.setDoc(doc, overrides?)` 가 인자 없이 불려 `undefined !== Map` → 매 프레임(개미 행진 90ms마다) 전체 재합성.
  미사용 overrides·`store.live` 제거로 해결.
- 로드맵 `docs/plans/0002-roadmap.md` (P1: PSD 입출력·눈금자/안내선·피사체 선택·필압·견본·내비게이터 …).

**검증**: typecheck ✓ · unit 47/47 · build ✓ · E2E **70/70** (신규 그룹 I 12건: 최대화 가운데·팬 후 중심 유지·썸네일 경계·그룹 마스크·
마스크 반전/페더·.comp 폴더·WebP·최근 파일·오프라인 차단 안내·온라인 모델 실추론·강제 종료 후 복구) · 잔여 Electron 0.

## 2026-09-21 — 킥오프 완료 + v0.1.0 1차 구현 (Compositor 전 기능 이식)

**요청**: (파일 변환기 세션 9 대화) "포토샵형 편집기를 따로 구현 — 화면은 Compositor 구조, 껍데기만 우리 클래식 UI". 위저드 선택:
Electron+React+TS+MUI 재스킨 · WebGL2 · 이름 sh-compositor · 첫 마일스톤 = "전부". 도중 지시: "playwright로 액션을 완료했으면 프로세스 꺼줘".

**구현**
- core 문서 모델(`src/core/doc/*`): 불변 Doc/Layer/Bitmap, 혼합 16종(W3C), CPU 합성(폴더 격리·클리핑·마스크·조정 레이어·효과),
  스냅샷 이력(구조 공유), 마스크 선택·마법봉, 브러시 덮임 누적, `.shcomp`(= Compositor `.comp` v7 manifest+PNG 의 zip, fflate), 순수 PNG 인·디코더.
  파일 변환기에서 보정·필터·효과·원근·내용 인식·매트·한도·크기 모듈 이식.
- WebGL2 거울 렌더러(`gl/*`): 핑퐁 FBO, 프리멀티플라이드 텍스처, 비트맵 키 텍스처 캐시·부분 업로드.
- 도구 15종(`tools/*`), 편집기 스토어·동작·픽셀 규약(`editor/*`), 캔버스 명령 등록소(`editor/commands.ts`).
- 클래식 셸: 타이틀바(제목 prop화)·메뉴 8개·도구 헤더·도구 레일·탭·레이어 패널·작업 내역·상태 줄·스킨. 대화상자 13종(변환기 5종 이식 + 새로 8종).
- AI 배경 제거 → **레이어 마스크**(비파괴) + GuidedMatte 다듬기. 보정 미리보기 = 클리핑된 임시 조정 레이어(GPU).
- 아이콘 새로 생성(겹친 레이어 세 장, 사진 없음) `scripts/gen-branding-assets.js`. 킥오프 슬롯·DESIGN.md·가이드 4종·format 훅.

**사고·수정**
- `@imgly/background-removal` `^1.4.5` 가 새 설치에서 1.7.0 으로 풀려 모델(`isnet_fp16`)을 못 찾음 → **1.4.5 정확 고정**.
  (파일 변환기도 package.json 은 `^` — lockfile 덕에 1.4.5 유지 중. 재설치하면 같은 사고 가능)
- E2E: MenuBar 제목은 `menuitem`, 저장 대화상자 모킹 인자(창, 옵션), 도구 설정이 localStorage 에 남아 다음 실행 오염 → `--user-data-dir` 분리.
- 앱 닫기 핸드셰이크(저장 확인) 때문에 `app.close()` 가 멈춤 → `closeApp`(app.exit + SIGKILL 확인). `pkill -f` 패턴이 자기 셸을 죽인 일 → `[s]h-…` 트릭.
- 난독화 SKIP 을 이 앱 청크 이름(`ort.*`·`heic2any-*`·`UTIF-*`)에 맞춤, 배경 제거 모듈 동적 import.

**검증**: typecheck ✓ · unit 47/47 · build ✓ · E2E `test/e2e/editor.mjs` **58/58** (A 브러시·GPU=CPU, B 선택, C 레이어·혼합·마스크·조정, D 보정·필터·효과,
E 크기·자르기·회전·이동, F 문자·도형·그라데이션·스포이트·흐림·도장·복구, G 저장/다시 열기·PNG·JPEG·내용 인식·닫기 확인, H AI 배경 제거) · 잔여 Electron 프로세스 0.

**다음**: 사용자 설치·테스트 피드백. todo P1.
