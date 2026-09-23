---
title: Claude 인계 — 현재 상태와 다음 작업
created: 2026-09-22
updated: 2026-09-22
domain: development
---

# Claude 인계

이 문서는 다음 에이전트의 진입점이다. 이력은 [session-log](session-log.md), 미해결 항목은 [todo](todo.md)가 기준이다.
웹·MCP의 현재 동작은 [웹·MCP 가이드](guides/web-mcp.md), 구조 결정은 [ADR-0005](adr/0005-application-layer.md), 남은 단계는 [계획 0004](plans/0004-web-mcp.md) 상단 현황을 본다.

## 이어받는 기준점

- 코드 기준: v1.1.0 (미커밋). 직전 커밋은 v1.0.4 `deccd04`. 커밋·푸시는 사용자가 직접 한다.
- v1.1.0 = 계획 0004의 1~5단계 MVP: Worker 취소·기한, 이력 메모리 예산, `src/application` 명령 계층, 웹 로컬 편집기, headless 서버, MCP(stdio·Streamable HTTP).
- 검증 명령과 건수는 CLAUDE.md "자주 쓰는 명령"과 session-log 최상단 블록에 있다.
- CPU 비트맵이 진실이고 GPU는 표시용 거울이다. 문서 스냅샷과 이력의 공유 버퍼를 변경하거나 Worker 전송으로 detach하지 않는다.

## 오해하기 쉬운 점

- 웹 로컬 편집기의 문서 권위는 브라우저 탭이고, 서버 문서는 따로 있다. 둘을 자동으로 동기화하지 않는다. 라이브 탭 조작(6단계)은 구현하지 않았다.
- 서버 문서·자산은 메모리에만 있다. 인증은 설정의 정적 Bearer 토큰이다. OAuth 인가 서버는 메타데이터로 알리기만 한다.
- 서버 한도 숫자(40MP·동시 2작업 등)는 기본값이다. 실제 메모리·동시성 측정으로 정한 값이 아니다.
- MCP 프로토콜은 SDK 1.30.0이 지원하는 2025-11-25로 고정했다. 실제 AI 클라이언트(Claude 앱 등)의 연결은 사람이 아직 확인하지 않았다 (E2E는 공식 SDK 클라이언트).
- `editor.commit`은 활성 탭에 넣는다. await 뒤에 커밋하는 동작은 `commandBridge.capture()`→`land()`를 쓴다.
- Rust WASM은 동기 CPU 연산이다. 큰 붓·획 시작 복사·합성·업로드 비용은 따로 측정해야 한다.

## 다음 세션 시작 지시문

> CLAUDE.md로 부팅하고 session-log → todo → docs/handoff.md → 필요하면 guides/web-mcp.md·ADR-0005를 읽어라. 코드 기준은 v1.1.0이다.
> 사용자 피드백(스크린샷)이 있으면 먼저 반영한다. 없으면 todo P1(설치본 검증)의 결과를 묻고, P2 중 사용자가 고른 항목 하나를 수행하라.
> 명령을 늘릴 때는 application 명령 → MCP 도구 → 단위·e2e:mcp 순서로 하고, UI에 같은 동작이 있으면 runCommand로 바꿔 결과를 맞춘다.
