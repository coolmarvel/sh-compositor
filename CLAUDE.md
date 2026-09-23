# CLAUDE.md — sh-compositor 작업 가이드

이 파일은 **세션이 바뀌어도 맥락을 즉시 복구**하기 위한 진입점이다. Claude Code는 세션 시작 시
이 파일을 자동으로 읽는다. (도구 중립 절대 규칙은 `AGENTS.md`.)

> [project-seed](https://github.com/coolmarvel/project-seed) 에서 2026-09-21 에 생성됨.
> 킥오프 완료 2026-09-21 (이름·스택·MVP 범위 = `docs/brief.md`·`docs/adr/0002-stack.md`·`docs/plans/0001-mvp.md`).

## 🟢 세션 시작 부팅 프로토콜 (매 세션 첫 작업 전에 반드시 수행)

새 세션에서 작업을 시작하면, **코드를 건드리기 전에** 순서대로:

1. `docs/session-log.md` 읽기 — 마지막으로 무엇을 했고 지금 어디쯤인지 (**진행 이력 SSOT**)
2. `docs/todo.md` 읽기 — 남은 일 (P1~P4)
3. 최근 `docs/plans/*.md` 1개 읽기 — 진행 중 기능의 설계 의도
4. 사용자 피드백 확인: **프로젝트 루트의 `스크린샷 *.png` = 아직 안 본 새 피드백**. Read 로 보고 요구사항으로 해석,
   반영을 끝내면 `docs/feedback-archive/YYYY-MM-DD-*/` 로 옮겨 루트를 비운다 (파일 변환기와 같은 규약).
5. `git status` 에 모르는 변경이 있으면 session-log 와 대조 — 다른 세션의 흔적일 수 있다. 출처 불명이면 사용자에게 확인.

## 🔴 변경 후 자동 규칙 (사용자가 매번 요청하지 않아도 수행)

1. 코드를 바꾸면 **같은 턴에** `docs/session-log.md`(최상단 블록 추가)·`docs/todo.md`
   (+릴리스급이면 `docs/changelog.md`)를 갱신한다. 문서 규칙은 `docs/writing-guide.md`.
2. 검증을 통과하기 전에는 커밋 메시지 작성/산출물 전달을 하지 않는다:
   `npm run typecheck && npm test && npm run build` + 화면을 건드렸으면 `node test/e2e/editor.mjs` (Playwright,
   `npm i --no-save playwright` 임시 설치). 렌더러·platform 을 건드렸으면 `npm run build:web && npm run e2e:web`,
   application·server 를 건드렸으면 `npm run build:server && npm run e2e:mcp` 도. **검증에 띄운 Electron·Playwright 프로세스는 끝나면 반드시 종료 확인**
   (`pgrep -af "[s]h-compositor/node_modules/electron"` 이 비어야 함 — 사용자 지시 2026-09-21). E2E 는 `npm run e2e`(Xvfb, 화면에 안 뜸).
3. 버전을 판단해 올린다 (아래 "버전 정책").
4. 산출물 전달: 인스톨러를 굽고 바탕화면에 복사(옛 버전 exe 는 지움) → "vX.Y.Z 설치·테스트 후 스크린샷 달라"고 알린다.
   ```bash
   npm run dist:win
   V=$(node -p "require('./package.json').version")
   rm -f /mnt/c/Users/user/Desktop/SH-Compositor-Setup-*.exe
   cp "release/SH-Compositor-Setup-$V.exe" /mnt/c/Users/user/Desktop/
   ```

## 버전 정책 (semver `MAJOR.MINOR.PATCH`)

**MINOR 승격은 사용자만 선언한다.** 에이전트가 판단해서 올리지 않는다.

- **PATCH** — 기본값. 다듬는 중인 기능의 수정 하나 반영할 때마다 +1.
- **MINOR** — 사용자가 "이 기능은 더 수정할 게 없다, 넘어가자"라고 선언한 그 시점에만.
- **MAJOR** — 대규모 재설계/호환 깨짐. 사용자와 상의.

## 커밋 컨벤션

Conventional Commits — `<type>: <한국어 제목>` + 리스트형 본문. **커밋/푸시는 사용자가 직접**
(에이전트는 요청 시 커밋 메시지만 작성). 메시지 끝에 `Co-Authored-By` 트레일러.

type: `feat` `fix` `refactor` `chore` `docs` `style` `test` `perf` `ci` `build` `revert` `init` `remove` `rename` `hotfix`

## 협업 규칙

- **진행 이력의 SSOT 는 `docs/session-log.md`** — git history 가 아니다 (커밋이 성긴 단위라서).
- 세션이 끊겨도 이어서 작업할 수 있게 **모든 진행 사항을 `docs/` 에 파일로 기록**한다.
- 설계 논쟁이 생기면 `docs/brief.md`(왜/무엇 SSOT)로 돌아와 판정한다. 브리프 밖 기능은 스코프 확인 먼저.
- `.env` 는 직접 수정하지 않는다 — `.env.example` 수정 또는 사용자에게 요청 (훅이 차단함).
- 규칙이 미확정이면 이 파일에 `<!-- TODO -->` 로 남기고, 확정되는 순간 채운다.

## 이 프로젝트가 뭔가

macOS 전용 무료 포토샵 대안 **Compositor(MIT, `~/Compositor`)** 를 Windows 오프라인 설치형으로 옮긴 레이어 기반 이미지 편집기.
화면 구조(도구 헤더·도구 레일·캔버스·레이어 패널·탭·상태 줄)는 Compositor 를 따르고, 껍데기는 자매 앱(sh-messenger·remote-assist·
sh-web-editor·파일 변환기)과 같은 **클래식 업무 UI** 로 감쌌다. 사용자(이성현)가 인스톨러로 설치해 테스트하고 스크린샷으로 피드백한다.
자매 프로젝트 `~/file-converter` 에서 클래식 셸·대화상자·Compositor core 10모듈을 가져왔다 (변경 시 두 곳 동기화 여부 판단).
**🚫 사용자 얼굴 사진은 아이콘·인스톨러·앱 UI 어디에도 넣지 않는다** (서명 sign.png·이름 크레딧만).

## 문서 인덱스 (docs/)

Claude 인계 시 `docs/handoff.md`를 읽는다. 웹·MCP 현재 동작은 `docs/guides/web-mcp.md`, 남은 단계·보완 우선순위는 `docs/plans/0004-web-mcp.md`가 기준이다.

| 파일 | 용도 |
|---|---|
| `docs/writing-guide.md` | **문서 지배 규칙** (SSOT·frontmatter·코드 1:1 대조). 문서 쓰기 전 필독 |
| `docs/brief.md` | 프로젝트 **왜/무엇 SSOT** — 킥오프 산출물 |
| `docs/session-log.md` | 세션별 진행 이력. **"언제 무슨 일" SSOT** (최신이 위) |
| `docs/todo.md` | 미해결·향후 작업만 (P1~P4). 완료분은 session-log 로 |
| `docs/changelog.md` | 릴리스 단위 사람용 요약 |
| `docs/adr/*.md` | 구조적 결정 기록 — 왜 이렇게 했는가 (`NNNN-kebab.md`) |
| `docs/plans/*.md` | 앞으로 만들 것 — 기능 단위 구현 계획 (역할 구분은 `plans/README.md`) |
| `docs/guides/*.md` | 현재 구현된 동작·코드 위치 (기능별) |
| `docs/feedback-archive/` | 처리 완료한 사용자 피드백 보관소 |

## 자주 쓰는 명령

```bash
npm run dev          # 개발 모드 (HMR)
npm run typecheck    # 타입 검사 (node + web)
npm test             # core·application·서버 설정 순수 로직 테스트 (node:test)
npm run build        # electron-vite build + 난독화 (scripts/obfuscate.cjs)
npm run format       # Prettier (printWidth 200)
npm run e2e [-- A B …]  # 실제 앱 E2E 120건 — Xvfb 가상 화면에서 (사용자 화면에 창이 뜨지 않음). build 후
npm run build:web      # 웹 로컬 편집기 → out/web (dev:web 5190 · preview:web 5191)
npm run e2e:web        # 웹 E2E 15건 (헤드리스 Chromium, build:web 후)
npm run build:server   # headless 서버·MCP → out/server/index.mjs (SHC_TOKENS=… npm run server · --stdio)
npm run e2e:mcp        # 서버·MCP E2E 15건 (공식 SDK 클라이언트, build:server 후)
npm run perf           # 체감 성능 (PERF_SIZE=4000x3000 PERF_LAYERS=5 PERF_PROFILE=1)
npm run audit -- <dir>  # 모든 대화상자·메뉴·도구 줄 스크린샷 (문구·줄바꿈 검수)
npm run models       # AI 개체 선택 모델(SlimSAM q8 35MB)·ORT wasm → resources/sam (git 제외, dist:win 이 먼저 부름)
npm run dist:win     # → release/SH-Compositor-Setup-<version>.exe (WSL 에서 Wine)
```

## 코드 지도 (수정 시 어디를 보나)

- **문서 모델(순수 TS, SSOT)**: `src/core/doc/` — `types.ts`(Doc·Layer·Bitmap·혼합 16종), `ops.ts`(레이어 연산), `render.ts`(CPU 합성 = 진실),
  `history.ts`(스냅샷 실행취소), `selection.ts`(마스크 선택·마법봉), `brush.ts`, `project.ts`(.shcomp = .comp v7 zip), `transform.ts`, `blend.ts`
- 보정·필터·효과·원근·내용 인식·매트·한도: `src/core/*.ts` (파일 변환기에서 이식, 테스트 `test/compositor*.test.ts`)
- **GPU 거울**: `src/renderer/src/gl/GLRenderer.ts`·`shaders.ts` — CPU 합성 규칙을 그대로 따른다 (`docs/guides/rendering.md`)
- 편집기 상태: `editor/store.ts`(탭·이력·도구 설정·대화상자, 탭별 `revision`·`commitTo`·`tabSignal`), 동작: `editor/actions.ts`(메뉴·단축키 공용), 픽셀 편집 규약: `core/doc/pixels.ts`(`editor/pixels.ts` 는 재수출)
  (`docs/guides/pixels.md`), 입출력: `editor/io.ts`, 배경 제거: `editor/bgremove.ts`(동적 import), 캔버스 명령 등록소: `editor/commands.ts`
- **명령 계층(UI 독립)**: `src/application/` — `commands.ts`(parse/run: resize·crop·layer.update·filter.apply) · `service.ts`(owner·revision·operationId·job·한도) · `repository/assets/jobs/codecs/errors`. 편집기 연결 `editor/commandBridge.ts` (ADR-0005)
- **웹·서버**: `renderer/src/platform/{index,web,idb}.ts`(window.api 브라우저 구현) · `vite.web.config.ts` · `src/server/{main,http,mcp,auth,config,workerRunner,taskWorker}.ts` (가이드 `docs/guides/web-mcp.md`)
- 도구: `tools/{move,select,paint,misc}.ts` + 목록·단축키·설명 `tools/index.ts`
- PSD: `core/doc/psd.ts`(ag-psd, 테스트 `test/psd.test.ts`) · 안내선 `editor/guides.ts`+`components/Rulers.tsx` · 도형 `editor/shape.ts` · 일꾼 `editor/{packWorker,bgremoveWorker,samWorker}.ts`
- **개체 선택(AI)**: `editor/objectSelect.ts`(임베딩 캐시·프롬프트 변환·후보 고르기·다듬기) + `editor/samWorker.ts`(transformers.js SlimSAM) + `tools/objectSelect.ts`(사각형·올가미·칠하기·클릭)
- P3 추가: 조정 `core/adjust2.ts`(흑백·색상 균형·활기·포스터화·한계값) · 필터 `core/filters.ts`(언샤프·하이 패스·모자이크·중간값) · 외부 광선 `core/effects.ts` · `panels/HistogramPanel.tsx` · 가장자리 다듬기 `DialogHost RefineEdgeDialog`
- 패널: `panels/{LayersPanel,HistoryPanel,SwatchesPanel,NavigatorPanel,PanelTabs}.tsx` · 보기 계산 `editor/view.ts` · 커서 `editor/cursor.ts`
- 화면: `App.tsx`(셸·메뉴·단축키) · `components/{CanvasView,ToolRail,ToolHeader,TabStrip,DialogHost}.tsx` · `components/panels/*` · `components/dialogs/*` · `components/chrome/*`
- 디자인 토큰: `styles/tokens.ts`(SSOT) + `skins.ts`(13종) + `theme.ts`(MUI 재스킨) — 계약은 루트 `DESIGN.md`

**새 도구** = `tools/*.ts` 핸들러 + `tools/index.ts` 등록 + `ToolRail` 아이콘 + `ToolHeader` 옵션 + `store.ts` ToolSettings.
**새 메뉴 동작** = `editor/actions.ts` 함수 + `App.tsx` 메뉴·단축키 + E2E 한 줄.

함정 (재발 방지):
- 배경 제거 = 두 버전 공존: 내장 `@imgly/background-removal` **1.4.5 고정**(`^` 금지 — 1.7 은 `isnet_fp16` 을 찾아 오프라인 데이터 1.4.5 와 안 맞음, 2026-09-21 H1 사고)
  + 온라인 `@imgly/background-removal-online`(npm 별칭 = 1.7.0, CDN). 두 라이브러리·onnxruntime 은 vite `manualChunks` 로 `bgremove-*` 청크 → 난독화 제외.
- 개체 선택 모델(SlimSAM ONNX)에는 **상자 입력이 없다** — 상자·올가미는 양성 점 1개(영역 안쪽 깊은 곳) + 영역 바로 밖 음성 점 8개로 바꿔 넣는다(라벨 2/3 상자 흉내는 뒤집힌 마스크).
  후보 3개 중 고르기: 양성 점을 덮고 음성 점을 피하는 후보만 → 영역이 있으면 영역 안 85% 이상·확신도 0.2 이내에서 가장 큰 것, 점만 있으면 화면 절반 넘는 후보 빼고 확신도 최고 (`decodeAndPick`).
  모델·ORT wasm 은 CDN 이 아니라 `aimodel://assets/`(main `serveDir`, CSP `aimodel:`) — `resources/sam` 이 없으면 `npm run models`.
- 설치본에 node_modules 를 싣지 않는다(`build.files` `!node_modules/**/*`, v1.0.2 에서 설치 폴더 약 1.2GB → 597MB). main·preload 는 Node 기본 모듈만 import 할 것.
- `npm i`(다른 패키지 설치)를 하면 `--no-save playwright` 가 지워진다 → E2E 전에 다시 설치.
- 미리보기는 반드시 `editor.setPreview()`(만든 문서에 묶임) — `set({preview})` 로 넣으면 문서가 바뀐 뒤에도 옛 미리보기가 그려진다 (배경 제거 미반영 사고).
- 오래 도는 계산(ONNX·PNG 압축)은 Web Worker — 화면 스레드에서 돌리면 진행 막대까지 멈춘다. 워커는 동적 import 를 쓰면 vite `worker.format: 'es'` 필요.
- 캔버스 포커스는 `focus({ preventScroll: true })` — 아니면 화면 전체가 스크롤돼 클릭 위치가 어긋난다.
- UI 문구: "—"·"A = B" 금지, 한 문장 한 줄(대화상자 폭 맞춤), 바꾸면 `npm run audit` 으로 확인.
- E2E·perf 는 `npm run e2e` (Xvfb) — 사용자 화면에서 창이 깜빡이지 않게.
- 보기 맞춤은 `editor/view.ts` + `store.withView`(문서 크기 변화 시 동기) — rAF 그리기에만 의존하면 창이 뒤에 있을 때 클릭 좌표가 어긋난다.
- `GLRenderer.setDoc` 은 문서가 같으면 재합성하지 않는다 — 인자를 늘릴 때 "매번 새 값"을 넘기면 매 프레임 재합성된다 (2026-09-21 사고).
- 픽셀 편집 전에 반드시 `bakeLayer`(문서 정렬) — 변형된 레이어에 좌표를 그대로 쓰면 어긋난다.
- **bytecodePlugin 금지**(플랫폼 종속 크래시). 새 대형 라이브러리 청크는 `scripts/obfuscate.cjs` SKIP 에 추가.
- E2E 는 `--user-data-dir` 를 따로 준다 — 도구 설정이 localStorage 에 남아 다음 실행을 오염시킨다.
- 프로세스 킬 명령에 패턴을 그대로 쓰면 자기 셸까지 죽는다 → `pkill -f "[s]h-compositor/…"` 처럼 대괄호 트릭.
- **await 뒤에 커밋하는 동작은 `commandBridge.capture()`→`land()`** — `editor.commit` 은 활성 탭에 넣는다. 배경 제거 중 탭을 바꾸면 결과가 다른 탭에 들어가던 사고(v1.1.0 수정).
- `window.api` 는 모듈 최상위에서 읽지 않는다 (웹은 `platform` 이 main.tsx 첫 import 에서 넣는다). 웹에서 Ctrl+N·Ctrl+W 는 브라우저가 가로챈다 → E2E 는 메뉴로.
- `src/application`·`src/server` 는 React·`editor`·`window` 를 import 하지 않는다. 서버는 `core/doc/psd.ts`(캔버스 필요)를 import 하지 않는다.
- MCP SDK 는 1.30.0(프로토콜 2025-11-25) 고정. 오류 결과에 structuredContent 를 넣지 않는다 (클라이언트가 outputSchema 로 검사해 -32602).
- `npx asar extract-file` 은 현재 폴더에 푼다 — 프로젝트 루트에서 `package.json` 을 뽑으면 덮어쓴다 (2026-09-22 사고). 임시 폴더에서 실행.
- 새 빌드 산출물 폴더는 `build.files` 에서 빼는지 확인 (v1.1.0 첫 빌드가 out/web 을 실어 288MB).
- 서버 작업 기한은 커밋 직전에도 검사한다 — 부하·VM 정지로 타이머가 2초 늦게 깨어난 사례(2026-09-22 MCP E2E M12).

## 디자인 시스템 (클래식)

디자인 레퍼런스: 자매 앱 클래식 계약 — sh-messenger·remote-assist(타이틀바·상태 줄·그룹 박스) + sh-web-editor(도구 버튼·메뉴 바·대화상자)
+ DEXT5 스킨 13종. 파일 변환기 ADR-0007 에서 확정된 것을 상속했다 (oh-my-design CLI 는 쓰지 않음).
디자인 계약은 루트 **`DESIGN.md`**. 색·간격은 `styles/tokens.ts` 에서만 정하고 코드에 임의 값을 넣지 않는다.
사용자 선호: **클래식**(반경 0·1px·12px 돋움·베벨) — 둥근 카드·그림자 많은 "모던 웹" 스타일로 바꾸지 않는다.

## 하네스 (Harness Engineering)

지시문이 아니라 시스템으로 제약한다. 도입 근거: `docs/adr/0001-harness-engineering.md`.

| 축 | 내용 |
|---|---|
| Hooks (`scripts/hooks/`) | `env-guard.sh`(.env 편집 차단) · `git-add-guard.sh`(`git add -A/.`·.env staging 차단) · `format.sh`(Edit/Write 뒤 Prettier, PostToolUse) |
| Settings (`.claude/settings.json`) | `disableRemoteControl: true` + `remoteControlAtStartup: false` + `autoUploadSessions: false` — Claude Code **Remote Control**(로컬 세션을 claude.ai/code 에 동기화) 차단. 대화 내용이 웹에 남지 않게 한다. 세션 중 `/rc` 가 켜져 있으면 끊는다 |
| Commands (`.claude/commands/`) | `/review-security` · `/deploy-check` |
| MCP (`.mcp.json`) | `context7`(라이브러리 문서) · `playwright`(브라우저 QA — 실제 앱 QA 는 `test/e2e/*.mjs` 의 `_electron`) |
| Skills | 스택별 스킬 도입 시 skills-lock.json + scripts/install-skills.sh 방식으로 락 (현재 없음) |

## 리터칭 가속 (v1.0.3)

- `native/retouch/kernel.rs` → `npm run build:retouch` → `src/renderer/src/assets/retouch.wasm` (소스와 함께 보관).
- `core/retouchWasm.ts` 영역 전달·재사용 메모리, `core/retouch.ts` TS 기준/폴백. ADR-0003 참조.
- 커널 수정 시 WASM 재생성 후 `test/retouch.test.ts` 차등 비교 및 E2E F5 확인. 전체 이미지 복사를 자국 루프에 다시 넣지 않는다.

## 명령 계층·웹·MCP (v1.1.0)

- 구조 결정 `docs/adr/0005-application-layer.md`, 실행·환경 변수·도구 목록 `docs/guides/web-mcp.md`, 남은 단계 `docs/plans/0004-web-mcp.md` 상단 현황.
- 이력은 단계 수 + 바이트 예산(`historyBudgetMB`, 공유 비트맵 한 번만 셈, 직전 1단계는 남김). Worker 요청은 `signal`(그 요청만)·`timeoutMs`(일꾼 종료).
- 새 명령 = `application/commands.ts` parse/run → `COMMANDS` → `server/mcp.ts` 도구 → 단위·`e2e:mcp`. UI 에 같은 동작이 있으면 `runCommand` 로.

## 실행 경로 검수 (v1.0.4)

- 검수 결과·웹 전환 경계: `docs/guides/code-review.md`. 비동기 작업 소유권: `docs/adr/0004-background-lifecycle.md`.
- 저장 완료는 `markSaved(tabId, snapshot, path, name)`으로 요청 당시 탭·문서에 반영한다. 현재 활성 탭을 저장한 것으로 표시하지 않는다.
- Worker 요청은 `util/workerClient.ts`, 자동 저장의 중복 실행·종료 순서는 `util/recoveryWriter.ts`가 관리한다.
- preload 이벤트 구독은 해제 함수를 반환한다. React effect에서 등록하면 cleanup에서 반드시 해제한다.
- 파일 저장은 `main/files.ts writeAtomic`을 사용한다. 기존 파일을 먼저 삭제하지 않는다.
- 타입 검사에 미사용 지역 변수·매개변수 검사 포함. 성능 비교: `node --import tsx test/review-bench.ts`.
