---
title: ADR-0006 Rust 커널 확장 기준과 패스·벡터 마스크 모델
created: 2026-09-23
status: accepted
---

# ADR-0006: Rust 커널 확장 기준과 패스·벡터 마스크 모델

## 상태

Accepted (v1.2.0)

## 맥락

v1.2.0 에서 포토샵 대비 부족한 8가지(닷지·번·스펀지, 조정 레이어 5종, 색상 범위·퀵 마스크, 그라데이션 덮기·경사와 엠보스,
브러시 팁·질감, 글자별 서식, 펜·패스·벡터 마스크, 원근 변형은 이미 있음)를 넣으면서 사용자가 "Rust 로 성능도 올려 달라"고 했다.
ADR-0003 의 리터칭 WASM 은 붓 자국 단위였고, 필터·보정처럼 전체 이미지를 훑는 연산에 Rust 를 어디까지 쓸지 기준이 없었다.
패스는 문서 좌표의 벡터인데 레이어는 자기 좌표의 비트맵이라, 벡터 마스크를 CPU 합성·GPU 거울·PSD 내보내기가 같은 값으로 봐야 한다.

## 결정

### Rust 커널은 실측으로만 채택한다

- 하나의 `native/kernels/kernel.rs` → `src/renderer/src/assets/kernels.wasm` (rustc 단일 파일, crate 없음). 리터칭 dab 도 여기로 합쳤다 (`native/retouch` 삭제).
- 커널을 추가하려면 `node --import tsx test/kernel-bench.ts` 로 TS 기준과 비교해 **중앙값 1.5배 이상** 빠를 때만 넣는다.
  결과(2026-09-23, WSL2): 중간값 필터 약 2.5배, 가우시안 블러 1.3~1.7배(σ 가 클수록 유리) → 채택. 닷지·번·스펀지는 픽셀당 계산이 가벼워 복사 비용이 이득을 먹어 TS 보다 느렸다 → **넣지 않았다**.
- 등록은 `core/filters.ts setNativeKernels(kernels)`. TS 기준 구현(`gaussianBlurTs`·`medianFilterTs`)은 폴백이자 정확도 계약이다:
  `test/kernels.test.ts` 가 블러 ≤1바이트·중간값 완전 일치·네이티브 예외 시 폴백을 검사한다. 64×64 미만은 전달 비용 때문에 TS 로 돈다(`NATIVE_MIN_PIXELS`).
- 서버·작업 스레드도 같은 wasm 을 읽는다 (`src/server/kernels.ts loadKernels`, `scripts/build-server.mjs` 가 `out/server` 로 복사).
- 이 기준으로 MCP E2E 의 "느린 작업"은 중간값(빨라짐) 대신 모션 블러(TS, O(n·거리))로 바꿨다.

### 패스와 벡터 마스크

- `core/doc/path.ts`: 앵커(점 + in/out 핸들) → 서브패스(닫힘 여부) → 패스(`Doc.paths`). 래스터는 곡선을 평탄화한 다각형을 `polygonMask` 로 (4× 초표본).
- `Layer.vectorMask = { subpaths, enabled, inverted }` 는 **패스의 복사본**이다 (패스를 나중에 고쳐도 마스크는 그대로, 포토샵의 "벡터 마스크 패스"와 같은 뜻).
- 합성은 단 하나의 함수 `effectiveMask(layer, docW, docH)` 를 거친다: 문서 좌표 마스크를 레이어 변형의 역으로 레이어 픽셀마다 읽어 픽셀 마스크와 곱한 `LayerMask` 를 돌려준다.
  CPU `render.ts`, GPU `GLRenderer.drawable()`, PSD 내보내기(`psd.ts`, 벡터는 픽셀 마스크로 구워지고 경고)가 모두 이것을 쓴다. 캐시 키 = 벡터 마스크 객체 + 변형 + 픽셀 마스크 객체.
- 프로젝트 파일(.shcomp)은 `shVectorMask`·`shPaths` 로 보존한다. PSD 는 벡터 마스크를 픽셀로만 낸다 (ag-psd 벡터 마스크 쓰기 미지원).

### 퀵 마스크는 미리보기 문서로

- 퀵 마스크(Q)는 선택을 픽셀 레이어로 바꾸지 않는다. `store.shownDoc` 이 `withQuickMask(doc)` 로 선택 밖을 빨갛게 덮는 **임시 레이어**를 얹어 GPU 경로로 그린다.
  브러시·지우개는 `target: 'selection'` 세션으로 선택 마스크를 직접 칠하고, Q 로 나갈 때 한 번의 이력("퀵 마스크")으로 커밋한다.

## 근거

- 1.5배 기준: 그보다 작은 이득은 WASM 메모리 복사·초기화·두 구현 유지 비용을 넘지 못했다. 닷지·번 벤치가 실제로 그랬다.
- `effectiveMask` 단일 함수: 벡터 마스크를 세 경로가 각각 래스터화하면 GPU=CPU 검사(tol 8)가 깨지기 쉽다. 하나의 비트맵으로 만들어 넘기면 기존 마스크 경로를 그대로 탄다.
- 패스 복사본: 패스 편집과 마스크가 묶이면 실행취소 단위가 뒤섞인다. 다시 붙이면 되므로 단순하게 갔다.

## 결과

- 필터 대화상자·MCP `filter_apply` 의 블러·중간값이 큰 사진에서 빨라졌다. 닷지·번·스펀지는 TS 그대로다 (필요하면 벤치 재측정 후 판단).
- 벡터 마스크는 변형(회전·크기)해도 문서 좌표에 고정된다 — 포토샵과 같다. 레이어를 옮기면 마스크는 따라가지 않는다 (`linked` 는 항상 true 로 두되 실제 좌표는 문서 기준).
- 커널을 늘릴 때마다 `kernel-bench` 수치를 session-log 에 남긴다.
