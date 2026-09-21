---
title: ADR-0001 하네스 엔지니어링 도입
created: 2026-09-21
status: accepted
---

# ADR-0001: 하네스 엔지니어링 도입

## 상태

Accepted (project-seed 보일러플레이트 기본 탑재)

## 맥락

AI 에이전트와의 협업에서 지시문(프롬프트)만으로는 규칙이 지켜지지 않는다 — 세션이 바뀌면 잊히고,
컨텍스트가 길어지면 무시된다. 선행 프로젝트들에서 반복 확인된 문제:
`.env` 를 직접 고치거나, `git add -A` 로 민감 파일이 staging 되거나, 검증 없이 산출물이 나가는 사고.

## 결정

규칙을 **시스템으로 강제**한다 (Constrain → Verify → Correct):

- **Hooks** (`scripts/hooks/` + `.claude/settings.json`): PreToolUse 로 위험 행동을 차단(exit 2)하고,
  PostToolUse 로 포맷을 자동화한다. 기본 2종 `env-guard`/`git-add-guard` + 스택 확정 후 `format`.
- **Settings** (`.claude/settings.json`): 에이전트 툴의 외부 동기화를 프로젝트 단위로 끈다 — Claude Code Remote Control
  (`disableRemoteControl: true`, `remoteControlAtStartup: false`). 로컬 대화가 claude.ai 에 기록되는 것을 막는다.
  사용자 설정(`~/.claude/settings.json`)에도 같은 값을 두되, 새 PC 에서 잊어도 프로젝트 파일이 막도록 양쪽에 둔다.
- **Commands** (`.claude/commands/`): 리뷰 체크리스트를 슬래시 커맨드로 — `/review-security`, `/deploy-check`.
  결과는 Critical/Warning/Info 로 분류하고 파일:라인을 인용하게 한다.
- **ADR** (`docs/adr/`): 구조적 결정은 근거와 함께 박제해 다음 세션/에이전트가 재논쟁하지 않게 한다.
- **문서 프로세스**: 부팅 프로토콜·session-log SSOT·변경 후 자동 규칙 (CLAUDE.md).

## 근거

- 지시문은 어겨져도 흔적이 없지만, 훅은 차단 로그가 남고 우회가 명시적이다.
- 대안(전부 프롬프트에 의존)은 선행 프로젝트에서 이미 실패 사례가 축적됨.

## 결과

- (+) 세션·에이전트·도구가 바뀌어도 최소 안전선이 유지된다.
- (−) 훅 스크립트 유지보수 비용. 정당한 예외는 사용자가 직접 수행해야 한다.
