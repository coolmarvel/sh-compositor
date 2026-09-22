---
title: TODO
created: 2026-09-21
updated: 2026-09-22
domain: development
---

# TODO (미해결·향후 작업만 — 완료분은 session-log 로)

우선순위: **P1** 다음 릴리스에서 다뤄야 함 · **P2** 가까운 로드맵 · **P3** 품질 · **P4** 아이디어.
항목에는 대상 파일 경로와 (있다면) 과거 사고 근거를 함께 적는다.

## P1 — 다음 릴리스에서 다뤄야 함

- [ ] v1.0.4 설치본 사용자 테스트 → 큰 사진 리터칭·올가미 체감, 파일 덮어쓰기·탭 전환 중 저장 확인 (Windows 파일 잠금 포함)

## P2 — 가까운 로드맵

- [ ] 웹 배포를 시작할 때 파일/클립보드/복구 저장·창 제어·AI 모델 URL의 브라우저 구현 추가 (`docs/guides/code-review.md`). Rust WASM은 그대로 재사용 가능.
- [ ] 대형 PNG/PSD 열기와 선택/레이어 PNG 내보내기의 동기 연산을 Worker로 옮길지 추가 측정 (`editor/io.ts`). 이번 검수는 CPU 합성 비용과 저장 Worker 수명을 개선.

- [ ] 초대형 리터칭 붓의 동기 연산을 Worker/분할 처리할지 실측으로 판단 (`core/retouchWasm.ts`, ADR-0003). 영역 복사·WASM 적용 후에도 획 시작 비용은 별개.

- [ ] 로드맵 P4 아이디어 (`docs/plans/0002-roadmap.md`) — 필요해질 때
- [ ] 개체 선택: 사진 속 여러 개체를 미리 찾아 마우스를 올리면 강조하는 방식(포토샵 개체 찾기 도구) — 지금은 감싸기·칠하기만. 이미지 임베딩 캐시는 이미 있음 (`editor/objectSelect.ts`)
- [ ] 개체 선택 모델을 더 큰 SAM(고품질)으로 고르는 설정 — 지금은 SlimSAM q8 35MB (`scripts/fetch-models.cjs SAM_FULL=1`)
- [ ] 8K: 레이어를 옮긴 뒤 첫 붓질에서 레이어를 캔버스 크기로 펼치는 비용(SwiftShader 1.9초) — 레이어를 필요한 만큼만 넓히는 방식 검토 (`editor/pixels.ts bakeLayer`, `tools/paint.ts begin`)
- [ ] PSD 문자 레이어를 문자 그대로 저장 (ag-psd 문자 엔진 한계로 지금은 픽셀) · 벡터 마스크·고급 개체

## P3 — 품질


- [ ] 파일 변환기와 공용 모듈(core 10종·chrome·dialogs) 동기화 방식 결정 (복사 유지 vs 공용 패키지)
- [ ] macOS 빌드 (packaging.md)

## P4 — 아이디어
