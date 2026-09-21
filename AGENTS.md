# AGENTS.md — sh-compositor

이 파일은 **모든 AI 코딩 에이전트**(Claude Code, Codex, Cursor, Copilot 등)를 위한 진입점이다.
도구에 상관없이 아래 규칙을 따른다. Claude Code 전용 상세(부팅 프로토콜·하네스)는 `CLAUDE.md`.

## 이 프로젝트가 무엇인가

macOS 전용 무료 포토샵 대안 Compositor(MIT)를 Windows 오프라인 설치형으로 옮긴 레이어 기반 이미지 편집기.
껍데기는 자매 앱과 같은 클래식 업무 UI. 스택: Electron + React 18 + TypeScript + MUI 재스킨 + WebGL2 합성(CPU 합성이 진실, GPU 는 거울).
순수 로직은 `src/core/`(node:test). 상세 `docs/brief.md` · `docs/adr/0002-stack.md`.

## 절대 규칙 (위반 금지)

1. **작업 전에 읽는다**: `docs/session-log.md`(진행 이력 SSOT) → `docs/todo.md` → 최근 `docs/plans/*` 1개.
2. **코드를 바꾸면 같은 턴에 문서를 갱신한다**: session-log 최상단 블록 + todo. 규칙은 `docs/writing-guide.md`.
3. **검증 없이 전달하지 않는다**: `npm run typecheck && npm test && npm run build` (+ UI 변경 시 `node test/e2e/editor.mjs`, 끝나면 Electron 프로세스 종료 확인) 통과가 커밋 메시지 작성의 전제.
4. **`.env` 를 직접 수정하지 않는다.** `.env.example` 수정 또는 사용자에게 요청.
5. **`git add -A` / `git add .` 금지.** 파일을 지정해서 stage 한다. **커밋/푸시는 사용자가 직접.**
6. **스택·구조 변경은 ADR 로**: 구조적 결정은 `docs/adr/NNNN-*.md` 에 근거와 함께 기록한다.
7. **버전의 MINOR 승격은 사용자 선언이 있을 때만.**
8. **브리프가 판정 기준**: 설계 논쟁·스코프 논쟁은 `docs/brief.md` 로 돌아와 판정한다.

## 커밋 컨벤션

Conventional Commits — `<type>: <한국어 제목>` + 리스트형 본문 + `Co-Authored-By` 트레일러.
type: feat, fix, refactor, chore, docs, style, test, perf, ci, build, revert, init, remove, rename, hotfix.

## 더 읽을 것

- `CLAUDE.md` — 부팅 프로토콜, 변경 후 자동 규칙, 코드 지도, 하네스 상세
- `docs/brief.md` — 왜/무엇 SSOT · `docs/writing-guide.md` — 문서 규칙
