---
title: TODO
created: 2026-09-21
updated: 2026-09-28
domain: development
---

# TODO (미해결·향후 작업만 — 완료분은 session-log 로)

우선순위: **P1** 다음 릴리스에서 다뤄야 함 · **P2** 가까운 로드맵 · **P3** 품질 · **P4** 아이디어.
항목에는 대상 파일 경로와 (있다면) 과거 사고 근거를 함께 적는다.

## P1 — 다음 릴리스에서 다뤄야 함

- [ ] v1.2.1 설치본 사용자 테스트 → AI 지우개(J) 실제 사진에서 사람·창문 지우기 품질과 시간(목표 5초 안팎), 간편 AI 메뉴의 배경 흐리게·흰색·누끼 체감

- [ ] v1.2.0 설치본 사용자 테스트 → 펜 도구(클릭·끌기·닫기)·퀵 마스크(Q)·브러시 팁 흩뿌리기·글자별 서식(구간 선택 후 굵게)·닷지/번 체감, 큰 사진 중간값 필터 속도
  + 이전부터 확인할 것: 큰 사진 리터칭·올가미 체감, 파일 덮어쓰기·탭 전환 중 저장(Windows 파일 잠금), 배경 제거 중 탭 바꾸기, 환경 설정 "실행 취소 메모리"·작업 내역 패널 MB 표시

## P2 — 가까운 로드맵

- [ ] AI 지우개 고해상도 — 모델 입력이 512 라 큰 개체를 지우면 채운 부분이 흐리다. 결과에 원본 결(노이즈·선명도) 입히기 또는 타일 방식 검토 (`core/inpaint.ts`, ADR-0007)
- [ ] AI 지우개 WebGPU — 소프트웨어 WebGPU 에서 출력이 틀려(전부 흰색) 뺐다. 실제 그래픽 카드에서 결과가 CPU 와 같은지 확인되면 켜서 1초 안팎으로 (`editor/inpaintWorker.ts`)
- [ ] 개체 선택(SlimSAM)·배경 제거도 멀티스레드로 — SharedArrayBuffer 는 v1.2.1 에서 켰지만 둘은 1스레드 그대로. imgly 는 스레드 코드를 함수 문자열로 띄워 난독화 청크에서 깨지므로 그 청크를 난독화에서 빼야 한다
- [ ] 서버·MCP AI 지우개 — onnxruntime-node 또는 onnxruntime-web(wasm)을 서버 작업 스레드에서. 지금은 capabilities.unsupported

- [ ] MCP를 ChatGPT(커넥터)·OpenAI Agents SDK·Cursor 등 Claude 외 클라이언트에 연결해 확인 (HTTPS 공개 주소 필요). Claude Code 는 2026-09-23 확인
- [ ] 서버 운영 한도 실측 — 40MP·동시 2작업·스레드 힙 512MB 는 기본값. 큰 문서 필터·내보내기의 최대 메모리와 동시성으로 정해 `SHC_*` 로 (`src/server/config.ts`)
- [ ] 서버 전체 메모리 예산 — 지금은 문서별 이력 예산·owner별 문서 수만 있고 프로세스 전체 상한은 없다. `resourceLimits` 는 ArrayBuffer(픽셀)를 막지 못한다
- [ ] 서버 영속 저장소·다중 인스턴스 (지금은 메모리 `MemoryDocumentRepository`·`MemoryAssetStore` — 재시작하면 사라짐)
- [ ] OAuth 인가 서버 연동 (지금은 정적 Bearer 토큰 + 보호 자원 메타데이터 공지만, `src/server/auth.ts`)
- [ ] 서버 명령 확장 남은 것: 문자 레이어(서버용 글꼴 래스터화 필요), WebP 코덱(순수 JS 인코더 도입 판단 — JPEG 은 v1.2.0 에서 jpeg-js), 원근 변형(`move.ts applyDistort` 를 명령으로)
- [ ] 16비트/채널 색 — `Bitmap` 이 Uint8ClampedArray 고정이라 문서 모델·합성·GL·PSD·필터 전부에 걸친 재설계. 별도 계획서(plans) 먼저 (v1.2.0 에서 의도적으로 제외)
- [ ] 메시(격자) 워프 — 원근·왜곡(`applyDistort`)은 있으나 포토샵 Warp 의 격자 변형은 없음
- [ ] 닷지·번·스펀지 Rust 커널 재측정 — v1.2.0 벤치에서는 복사 비용 때문에 TS 보다 느려 미채택 (`test/kernel-bench.ts`, ADR-0006). 큰 붓에서 체감이 느리면 영역 전달 방식(retouchWasm 처럼)으로 다시
- [ ] PSD 벡터 마스크 — 지금은 픽셀 마스크로 구워 내보냄(경고). ag-psd 의 vector mask 쓰기 지원 여부 확인 후 판단
- [ ] 편집기의 나머지 동작을 application 명령으로 옮길지 판단 (명령은 36개 있으나 UI 가 `runCommand` 로 부르는 것은 이미지 크기·이름 바꾸기뿐 — 붓·리터칭은 UI 가 미리보기 세션이라 그대로)
- [ ] 선택: 열려 있는 웹 탭 원격 조작(계획 0004 6단계) — 필요가 확인되면 페어링·권한 설계부터
- [ ] 대형 PNG/PSD 열기와 선택/레이어 PNG 내보내기의 동기 연산을 Worker로 옮길지 추가 측정 (`editor/io.ts`). 이번 검수는 CPU 합성 비용과 저장 Worker 수명을 개선.

- [ ] 초대형 리터칭 붓의 동기 연산을 Worker/분할 처리할지 실측으로 판단 (`core/retouchWasm.ts`, ADR-0003). 영역 복사·WASM 적용 후에도 획 시작 비용은 별개.

- [ ] 로드맵 P4 아이디어 (`docs/plans/0002-roadmap.md`) — 필요해질 때
- [ ] 개체 선택: 사진 속 여러 개체를 미리 찾아 마우스를 올리면 강조하는 방식(포토샵 개체 찾기 도구) — 지금은 감싸기·칠하기만. 이미지 임베딩 캐시는 이미 있음 (`editor/objectSelect.ts`)
- [ ] 개체 선택 모델을 더 큰 SAM(고품질)으로 고르는 설정 — 지금은 SlimSAM q8 35MB (`scripts/fetch-models.cjs SAM_FULL=1`)
- [ ] 8K: 레이어를 옮긴 뒤 첫 붓질에서 레이어를 캔버스 크기로 펼치는 비용(SwiftShader 1.9초) — 레이어를 필요한 만큼만 넓히는 방식 검토 (`core/doc/pixels.ts bakeLayer`, `tools/paint.ts begin`)
- [ ] PSD 문자 레이어를 문자 그대로 저장 (ag-psd 문자 엔진 한계로 지금은 픽셀) · 고급 개체

## P3 — 품질


- [ ] 파일 변환기와 공용 모듈(core 10종·chrome·dialogs) 동기화 방식 결정 (복사 유지 vs 공용 패키지)
- [ ] macOS 빌드 (packaging.md)

## P4 — 아이디어
