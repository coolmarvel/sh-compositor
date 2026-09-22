---
title: ADR-0004 비동기 저장과 Worker 자원 수명
created: 2026-09-22
status: accepted
---

# 배경 작업의 소유권과 정리

## 맥락

저장 완료가 현재 활성 탭을 참조하고 자동 저장 tick이 겹칠 수 있었다.
세 Worker의 요청 Map 구현이 중복되었고 postMessage 예외·Worker 종료 처리도 서로 달랐다.
React StrictMode의 effect 재실행에서 IPC 구독과 자동 저장 구독이 해제되지 않았다.

## 결정

- 저장은 탭 ID와 불변 Doc 스냅샷을 캡처한다. `EditorStore.markSaved`는 해당 탭의 saved 참조만 갱신한다.
  완료 시점의 더 최신 문서는 미저장 상태로 남긴다. 이미 닫힌 탭은 다시 만들지 않는다.
- `util/recoveryWriter.ts`가 자동 저장의 중복 실행·닫힌 탭·종료를 관리한다.
  파일 API와 인코딩은 주입하며 Electron에 직접 의존하지 않는다. 종료 시 진행 중 쓰기가 끝난 뒤 복구본을 삭제한다.
- `util/workerClient.ts`가 요청 ID·진행 메시지·응답·오류·전송 예외·종료를 관리한다.
  Worker 생성 불가만 별도 오류로 구분하여 기존 동기 폴백 정책을 유지한다. 런타임 크래시는 실패로 알리고 다음 요청에서 새 Worker를 만든다.
- `editor/pack.ts`는 같은 Doc·같은 형식의 동시 인코딩만 공유한다. 완료된 전체 파일 바이트를 장기간 캐시하지 않는다.
- preload 이벤트 등록은 해제 함수를 반환하고 React effect cleanup에서 호출한다.
- `main/files.ts`는 같은 디렉터리의 고유 임시 파일에 완성본을 쓴 뒤 rename으로 교체한다.
  교체 실패 시 기존 파일을 먼저 지우지 않으며 임시 파일은 정리한다. 디스크 flush까지 보장하는 트랜잭션은 아니다.

## 결과

화면·계산·운영체제 기능의 기존 경계를 유지하면서 자원 소유권을 명시했다.
브라우저 이식 시 RecoveryWriter와 WorkerClient는 재사용하고 파일 저장 어댑터를 교체한다.
경합·전송 오류·파일 교체 실패를 `test/review-lifecycle.test.ts`, `test/review-files.test.ts`에서 재현한다.
