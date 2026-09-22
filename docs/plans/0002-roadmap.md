---
title: 로드맵 — 보완·추가 기능 제안 (v0.1 이후)
created: 2026-09-21
updated: 2026-09-21
---

> 2026-09-21 v1.0.0: P1·P2 모두 구현 (아래 표의 항목). 남은 것은 P3 와 todo.md.

# 0002 로드맵 — 보완·추가 기능

v0.1.0 으로 Compositor 기능은 모두 옮겼다(plans/0001). 이 문서는 **"편집기로서 더 쓸 만하게"** 만들 후보를 우선순위로 정리한다.
판정 기준은 `docs/brief.md` — 오프라인 · Windows · 포토샵 문법 · 클래식 UI. 항목마다 **왜**(사용자 가치)와 **어디**(코드 위치)를 적는다.
진행되면 체크하고, 끝난 항목은 session-log 에 남긴다.

## v0.1.1 에서 처리 (2026-09-21 첫 설치 피드백 + 미완 항목)

- [x] 처음 연 문서가 창 최대화 뒤 왼쪽 위에 남던 문제 → 보기에 "맞춤 상태"를 두고 창 크기가 바뀌면 다시 맞춤,
      팬·줌 뒤엔 화면 중심 유지 (`CanvasView.tsx adaptView`)
- [x] 세로로 긴 레이어 썸네일이 행 밖으로 넘치던 문제 (`LayersPanel.tsx Thumb`)
- [x] 배경 제거 **온라인(최신 1.7) / 내장(오프라인 1.4.5)** 선택 + 자동 모드, 오프라인이면 최신 모델을 막고 안내 (`editor/bgremove.ts`, `DialogHost RemoveBgDialog`)
- [x] Compositor `.comp` 폴더 직접 열기 (`main fs:openCompFolder`, `io.openCompFolder`)
- [x] 폴더(그룹) 마스크, 마스크 반전·페더, 폴더·조정 레이어 마스크 칠하기
- [x] 스팟 복구: 획 경계만 훑기 (문서 전체 스캔 제거)
- [x] 상태 줄 커서 좌표·색 (`editor/cursor.ts`)
- [x] 최근 파일(파일 메뉴), WebP 내보내기, **자동 저장·비정상 종료 복구** (`editor/autosave.ts`)
- [x] GPU 가 매 프레임 다시 합성하던 문제(개미 행진 때마다) — `GLRenderer.setDoc` 정리

## P1 — v1.0.0 에서 구현 완료

| # | 기능 | 왜 | 어디 / 방법 |
|---|---|---|---|
| 1 | **PSD 열기·저장** (레이어·마스크·혼합 모드) | 포토샵 사용자와 파일을 주고받는 게 가장 큰 장벽. 기존 작업물을 그대로 연다 | `ag-psd`(MIT, 순수 JS). `core/doc/psd.ts` 에 Doc ↔ PSD 변환. 조정 레이어·효과는 가능한 만큼, 안 되는 건 래스터로 |
| 2 | **눈금자·안내선·스냅** | 정렬 작업의 기본. 지금은 이동 도구의 캔버스 가장자리 스냅뿐 | `CanvasView` 위 눈금자 컴포넌트, `Doc.guides`(저장 포함), 이동·자르기·선택 스냅 |
| 3 | **피사체 선택 (AI)** | 배경 제거 모델을 "선택 영역"으로도 — 포토샵 Select Subject | `bgremove.subjectMask` 결과 → `makeSelection`. 선택 메뉴 1줄 |
| 4 | **브러시 필압·프리셋** | 펜 태블릿 사용자. 필압은 이미 들어오지만 크기에 반영 안 됨 | `core/doc/brush.ts` 에 크기 필압, 프리셋 5종(도구 헤더) |
| 5 | **색상 견본 패널 + HSB/Lab 입력** | 색 고르기가 대화상자뿐이라 느림 | 오른쪽 패널 탭(레이어 / 견본 / 내비게이터), localStorage 견본 |
| 6 | **내비게이터(축소 보기)** | 큰 이미지 확대 작업 때 위치 파악 | GL 합성 텍스처를 축소 그리기 + 보기 사각형 끌기 |

## P2 — v1.0.0 에서 구현 완료

| # | 기능 | 왜 | 어디 / 방법 |
|---|---|---|---|
| 7 | 선택 영역 **테두리 그리기(Stroke)**·경계 다듬기 | 자주 쓰는 편집 동작 | `actions.strokeSelection` — `selectionOutline` + 브러시 덮임 |
| 8 | 레이어 **잠금**(투명 픽셀·위치·전체) | 실수 방지 | `Layer.lock` + `pixels.editPixels`·이동 도구에서 확인 |
| 9 | 레이어를 파일로 **각각 내보내기** / 선택 영역 내보내기 | 웹·앱 자산 추출 | 파일 메뉴, `io.exportLayers` |
| 10 | **작업 내역 스냅샷**·실행취소 단계 수 설정 | 긴 작업에서 되돌아갈 지점 | `history.ts` 에 이름 붙은 스냅샷, 설정 대화상자 |
| 11 | 문자: **줄 간격·자간을 도구 헤더**에서, 세로쓰기, 문자에 효과 미리보기 | 한글 디자인 작업 | `ToolHeader TypeHeader`, `editor/text.ts` |
| 12 | 도형을 **벡터로 유지**(다시 편집) | 지금은 그리는 즉시 픽셀 | `Layer.shape` 데이터 + 문자 레이어처럼 다시 그리기 |
| 13 | 조정 레이어 `filters` 의 **GPU 경로** | .comp 에서 온 필터 조정 레이어는 화면이 CPU 와 다를 수 있음 | `GLRenderer.drawAdjustInto` — 흐림은 분리형 셰이더 |
| 14 | 큰 문서(8K+) **브러시 성능 측정**·타일 업로드 | 대형 사진 리터칭 | `uploadRect` 경로 프로파일, 256px 타일 |
| 15 | **환경 설정** 대화상자 (자동 저장 주기, 실행취소 수, GPU 끄기, 기본 배경 제거 모델) | 지금은 코드 상수 | `store.ts` 설정 + localStorage |

## P3 — v1.0.1 에서 구현 완료 (포토샵 기준 보완)

| # | 항목 | 포토샵 대응 | 구현 위치 |
|---|---|---|---|
| 1 | **개체 선택 (AI)** — 사각형·올가미로 넉넉히 감싸거나 칠하면 테두리에 맞게 선택, Shift/Alt 클릭으로 다듬기, 테두리·부드럽게 슬라이더 | Object Selection Tool | `editor/objectSelect.ts`·`samWorker.ts`·`tools/objectSelect.ts` (SlimSAM, 오프라인) |
| 2 | **가장자리 다듬기** (Ctrl+Alt+R) — 반경·매끄럽게·페더·대비·이동, 바깥 어둡게 보기 | Select and Mask | `DialogHost.tsx RefineEdgeDialog` |
| 3 | **조정 추가** — 흑백·색상 균형·활기·포스터화·한계값 + 이미지 ▸ 조정 하위 메뉴 | Image ▸ Adjustments | `core/adjust2.ts`, `MoreAdjustHost` |
| 4 | **선명하게** (언샤프 마스크·하이 패스), **모자이크·노이즈 감소**(중간값) | Filter ▸ Sharpen / Pixelate / Noise | `core/filters.ts`, `FiltersDialog` 탭 3개 |
| 5 | **정렬·분포** — 이동 도구 옵션 줄 버튼 8개 | Align / Distribute | `actions.alignLayers`·`distributeLayers` |
| 6 | **외부 광선** 레이어 효과 (PSD 왕복 포함) | Outer Glow | `core/effects.ts`, `core/doc/psd.ts` |
| 7 | **레이어 효과 복사·붙여넣기·지우기** | Copy/Paste Layer Style | `actions.ts`, 레이어 메뉴·오른쪽 클릭 |
| 8 | **히스토그램 패널** (채널별·통계) | Histogram panel | `panels/HistogramPanel.tsx` |

## P4 — 아이디어 (필요해지면)

- 일괄 처리(액션 녹화 → 폴더 전체 적용) — 파일 변환기와 역할이 겹치므로 변환기 쪽에 둘지 먼저 결정
- 텍스트 경로, 펜 도구(베지어 패스 → 선택)
- 스마트 오브젝트(원본 보존 레이어) — 지금의 "비파괴 변형 + 칠할 때 굽기"로 대부분 대체됨
- 인쇄(용지·여백 미리보기), CMYK 미리보기
- macOS 빌드 (`docs/guides/packaging.md`)
- 파일 변환기와 공용 모듈(core·chrome·dialogs)을 공용 패키지로 — 두 앱의 차이가 커지기 전에 결정

## 하지 않을 것 (브리프 범위 밖)

- 클라우드 저장·계정·협업, 자동 업데이트 — 설치본 재배포로 충분
- 유료 API 기반 생성형 채우기 — 오프라인·무료 원칙
