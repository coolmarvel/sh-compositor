---
title: 렌더링 — CPU 합성(진실)과 WebGL2 거울
created: 2026-09-21
updated: 2026-09-21
domain: rendering
---

# 렌더링

## 개요

문서의 픽셀 진실은 **CPU** 쪽 불변 비트맵(`Bitmap` = 스트레이트 알파 RGBA)이다. 화면은 **WebGL2** 가 같은 규칙으로 다시 합성한 거울이다.
내보내기·복사·마법봉(모든 레이어)·히스토그램은 전부 CPU 합성(`flattenDoc`)을 쓴다 — 화면과 파일이 다르면 CPU 가 맞다.

## 합성 규칙 (두 경로가 반드시 같아야 함)

| 규칙 | CPU `src/core/doc/render.ts` | GPU `src/renderer/src/gl/GLRenderer.ts` |
|---|---|---|
| 순서 | `layers` 배열 아래→위, `parentId` 로 폴더 | `compositeChildren` 같은 순회 |
| 폴더 | 격리 합성 후 폴더의 혼합·불투명도·마스크로 한 번 | FBO 로 격리 |
| 혼합 16종 | `blend.ts compositePixel` (W3C 수식) | `shaders.ts LAYER_FS blendFn` — 인덱스는 `BLEND_MODES` 순서 |
| 클리핑 | 바로 아래 기준 레이어의 알파를 덮임에 곱함. 숨긴 기준 위 클리핑 레이어는 안 보임 | `base` 타깃 알파 |
| 마스크 | R 채널 × 알파, `enabled=false` 면 무시 | 마스크 텍스처 |
| 조정 레이어 | 아래까지의 합성에 보정 적용(마스크·클리핑 반영). `adjustment.filters` 는 **CPU 만** 적용 | `ADJUST_FS` + `adjustmentTables` LUT |
| 효과 | `renderEffects` 결과를 레이어 픽셀로 (캐시) | 같은 함수 결과를 텍스처로 캐시 |

- `setDoc(doc)` 은 문서 객체가 같으면 재합성하지 않는다(개미 행진·오버레이만 다시 그림). 칠하는 중엔 `uploadRect` 가 dirty 를 켠다.
- 텍스처는 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 로 올리고 셰이더는 프리멀티플라이드로 계산, 결과는 체커 위에 `PRESENT_FS`.
- 텍스처 캐시 키 = `Bitmap` 객체(불변). 비트맵이 바뀌면 새 객체 → 새 업로드. 칠하는 중엔 `uploadRect` 로 부분 갱신.
- 도구 진행 중 미리보기는 `editor.state.preview`(이력 밖 문서)를 그린다 — 보정 대화상자는 대상 위에 **클리핑된 임시 조정 레이어**
  (선택 영역 = 그 마스크)를 끼워 GPU 로 미리 보고, 확인하면 CPU `adjustLayer` 로 굽는다 (`components/DialogHost.tsx`).
  필터는 GPU 경로가 없어 180ms 디바운스 CPU 미리보기.

## 검증

E2E `A6`·`C2`·`C9` 가 화면 픽셀(스크린샷)과 CPU 합성을 비교한다 (`test/e2e/editor.mjs screenPx`).

## 관련 코드

- `src/core/doc/render.ts` — `flattenDoc`, `rasterizeLayer`(변형·2배 단계 축소)
- `src/renderer/src/gl/GLRenderer.ts` — `setDoc`, `render(view, grid, checker, bg)`, `readPixel`
- `src/renderer/src/components/CanvasView.tsx` — 그리기 루프(스토어 구독 → rAF), 오버레이 2D 캔버스
