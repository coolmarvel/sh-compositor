---
title: 픽셀 편집 규약 (bake-before-edit)
created: 2026-09-21
updated: 2026-09-21
domain: editing
---

# 픽셀 편집 규약

## 개요

이동·크기·회전·반전은 **비파괴**(레이어 `transform` 만 바뀜)다. 픽셀을 바꾸는 모든 작업(브러시·채우기·지우기·보정·필터·내용 인식·
잘라내기·마스크 칠하기)은 먼저 레이어를 **문서에 1:1 로 정렬된 비트맵**으로 굽는다(`bakeLayer`). 그러면 레이어 픽셀 (x, y) =
문서 (x + tx, y + ty) 라 선택 마스크·브러시 좌표를 그대로 쓴다. Photoshop 이 스마트 오브젝트에 칠할 때 래스터화하는 것과 같다.
Compositor 는 변형된 레이어에도 역변환으로 칠한다 — 우리는 단순함·정확도를 택했다.

## 규칙

| ✅ 할 것 | ❌ 하지 말 것 |
|---|---|
| `editPixels(doc, id, 'layer'|'mask', cover, fn)` 로 편집 — 선택 덮임만큼 자동으로 섞는다 | 변형된 레이어 비트맵에 문서 좌표를 바로 쓰기 |
| 칠할 범위가 레이어 밖이면 `cover` 사각형을 넘겨 레이어를 넓힌다 | 비트맵 `data` 를 제자리에서 바꾸기 (불변 — 이력·텍스처 캐시가 깨진다) |
| 마스크는 레이어와 같은 모양으로 함께 굽는다 (굽는 동안 새로 생긴 칸 = 흰색 = 보임) | 조정·폴더 레이어에 픽셀 편집 (actions `pixelLayer` 가 막는다 — 단 **마스크 편집 중이면** 폴더·조정 레이어의 마스크는 칠·채우기·지우기 가능) |

- 문자 레이어에 칠하면 굽힌 뒤에도 `kind:'text'` 가 남는다. 자르기 "잘린 픽셀 삭제"(`trimToCanvas`)는 문자를 픽셀로 바꾼다.
- 브러시는 획 단위 덮임을 누적(`core/doc/brush.ts StrokeCoverage`)해 불투명도가 획 안에서 쌓이지 않는다 (Compositor 와 같음).

## 관련 코드

- `src/renderer/src/editor/pixels.ts` — `bakeLayer`·`editPixels`·`fillSelection`·`eraseSelection`·`adjustLayer`·`layerViaCopy`·`trimToCanvas`
- `src/renderer/src/editor/actions.ts` — 메뉴 동작이 위를 조합
- `src/renderer/src/tools/paint.ts` — 브러시·흐림·도장·복구 세션(미리보기 문서 + `uploadRect`)
