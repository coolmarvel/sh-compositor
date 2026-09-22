---
title: 화면·도구·단축키
created: 2026-09-21
updated: 2026-09-21
domain: ui
---

# 화면·도구·단축키

디자인 계약은 루트 `DESIGN.md`. 이 문서는 현재 동작과 코드 위치.

## 도구 (`src/renderer/src/tools/index.ts` — 순서·라벨·단축키·상태 줄 안내의 SSOT)

이동·변형 V · 사각/타원 선택 M · 올가미(자유/다각형) L · 마법봉 W · 자르기 C · 브러시 B / 지우개 E · 스팟 복구 J · 복제 도장 S ·
흐림/문지르기/리퀴파이 R · 그라데이션 G · 도형 U · 문자 T · 스포이트 I · 손 H · 돋보기 Z. Space = 어느 도구에서나 손.
도구별 옵션은 `components/ToolHeader.tsx` (이동 도구 = X·Y·폭·높이·배율·각도 수치 입력).

## 전역 단축키 (`App.tsx` `onKey` — 입력칸·대화상자·메뉴가 열려 있으면 무시)

| 묶음 | 키 |
|---|---|
| 파일 | Ctrl+N 새로 · Ctrl+O 열기 · Ctrl+Shift+O 레이어로 가져오기 · Ctrl+S / Ctrl+Shift+S 저장 · Ctrl+Shift+Alt+S PNG · Ctrl+W 닫기 |
| 편집 | Ctrl+Z / Ctrl+Shift+Z·Ctrl+Y · Ctrl+X/C/V · Ctrl+Shift+C 병합 복사 · Delete 지우기 · Alt+Backspace / Ctrl+Backspace 전경/배경 채우기 · Shift+F5 내용 인식 · Ctrl+T 변형 |
| 이미지 | Ctrl+Alt+I 이미지 크기 · Ctrl+Alt+C 캔버스 크기 · Ctrl+L 레벨 · Ctrl+M 커브 · Ctrl+U 색조/채도 · Ctrl+I 반전 · Ctrl+Shift+U 채도 감소 · Ctrl+Shift+L 자동 톤 · Ctrl+Shift+Alt+L 자동 대비 · Ctrl+Shift+B 자동 색상 |
| 레이어 | Ctrl+Shift+N 새 · Ctrl+J 복사한/복제 · Ctrl+Shift+J 잘라낸 · Ctrl+G / Ctrl+Shift+G 그룹 · Ctrl+Alt+G 클리핑 · Ctrl+E 병합 · Ctrl+Shift+E 보이는 병합 · Ctrl+] / [ 순서 · Q 마스크 |
| 선택 | Ctrl+A · Ctrl+D · Ctrl+Shift+I 반전 · Shift+F6 페더 |
| 보기 | Ctrl++ / Ctrl+- · Ctrl+0 맞춤 · Ctrl+1 100% · Ctrl+' 픽셀 격자 |
| 색 | X 바꾸기 · D 기본 흑백 |

도구 안 키(캔버스에 포커스): [ ] 크기 · Shift+[ ] 경도 · 1~0 불투명도 · Enter 확정 · Esc 취소 · 방향키 1px(Shift 10px).

## 레이어 패널 (`components/panels/LayersPanel.tsx`)

위 = 앞. 클릭 = 활성, Ctrl/Shift+클릭 = 다중, 끌기 = 순서(폴더 가운데 = 안으로), 더블클릭 = 이름, 눈 Alt+클릭 = 이 레이어만,
썸네일 Ctrl+클릭 = 픽셀 선택, 마스크 썸네일 클릭 = 마스크 편집(Shift+클릭 = 끄기), 오른쪽 클릭 = 메뉴. 아래 버튼: 효과·마스크·조정 레이어·그룹·새 레이어·삭제.
작업 내역(`HistoryPanel.tsx`) 칸 클릭 = 그 시점으로 실행취소/다시 실행.

## 대화상자 (`components/DialogHost.tsx` — `store.dialog` 하나를 그림, 전부 `React.lazy`)

새로 만들기 · 이미지 크기 · 캔버스 크기(색/투명/내용 인식 여백) · 문서 복구(자동 저장본) · 보정(레벨·커브·노출·색조/채도·그레인/맵, 조정 레이어 편집 겸용) ·
필터 · 레이어 효과 · JPEG/WebP 내보내기(실제 인코딩 미리보기) · 선택 확장/축소/페더 · 색 선택 · 이름 바꾸기 · 저장 확인 · 배경 제거(AI) · 정보.
제스처형 편집(조정 레이어·효과)은 값마다 이력 한 칸을 덮어쓰고 취소하면 되돌린다(`useGestureEdit`).

## 보기 (`components/CanvasView.tsx`)

`View = { zoom, panX, panY, fit?, cw?, ch? }`. 문서를 처음 열면 **맞춤 상태(fit)** — 창·패널·문서 크기가 바뀌면 다시 맞춰 항상 상하좌우 가운데.
손·돋보기·휠로 보기를 바꾸면 맞춤이 풀리고, 이후 창 크기 변화엔 **화면 중심을 유지**한다(`adaptView`). Ctrl+0 = 다시 맞춤 상태.

## 상태 줄 · 자동 저장

- 커서 좌표·그 자리 보이는 색(GPU 합성 `readPixel`, 프레임당 1회) — `editor/cursor.ts` 별도 스토어(앱 전체 재렌더 방지).
- 자동 저장 1분 주기 `editor/autosave.ts` → `userData/recovery/<실행ID>-<탭>.shcomp`. 저장·닫기·정상 종료 시 지움, 다음 실행에 남아 있으면 복구 대화상자.

## 배경 제거 (`editor/bgremove.ts`)

자동(연결되면 최신) · 내장(오프라인 1.4.5, 인스톨러 번들) · 최신(온라인 1.7.0, 모델만 CDN 에서 내려받음 — 이미지는 올리지 않음).
추론은 `editor/bgremoveWorker.ts`(Web Worker) — 화면이 멈추지 않는다. 진행: "1/2 모델 불러오는 중 N%" → "2/2 피사체 분석 중". 선택 ▸ 피사체(AI)도 같은 엔진.
연결 확인은 `checkOnline()`(CDN 에 실제 요청, 4초). 최신 전용인데 연결이 없으면 실행을 막고 "내장 모델로 진행"을 제안. 선택은 localStorage `sc.bgMode`.

## 개체 선택 (AI, W — `tools/objectSelect.ts`, `editor/objectSelect.ts`)

옵션 줄: 사각형으로 감싸기 · 올가미로 감싸기 · 칠해서 잡기, 테두리(−30~30px, 넓히기·좁히기) · 부드럽게(0~30px).
피사체를 넉넉히 감싸면 SlimSAM(오프라인)이 테두리에 맞춘다. 클릭 한 번 = 그 점의 개체. Shift+클릭·끌기 = 포함, Alt = 빼기(초록·빨강 점 표시).
문서마다 첫 분석(임베딩)만 몇 초, 이후 다듬기는 즉시. 슬라이더·다듬기는 한 번의 실행 취소 단위로 묶인다. W 는 마법봉과 번갈아 바꾼다.
결과 정리: 작은 구멍 메우기 → 양성 점과 이어진 덩어리만 → 밝기 길잡이 가이디드 필터 → 영역+2px 로 자르기.

## 사용 설명서 (F1, `components/dialogs/HelpDialog.tsx`)

탭 7개, 한 줄에 한 문장. 단축키를 바꾸면 여기 `PAGES` 도 고친다(도구 탭은 `tools/index.ts` 에서 자동). 키 칸 문법: `+` 로 조합, ` / ` 는 "또는", 키가 아닌 말은 굵은 글자.

## P3 대화상자·패널

- 선택 ▸ 가장자리 다듬기(Ctrl+Alt+R): 반경(가장자리 감지)·매끄럽게·페더·대비·가장자리 이동, "선택 바깥을 어둡게 보기" 미리보기.
- 이미지 ▸ 조정 하위 메뉴: 흑백·색상 균형·활기·포스터화·한계값은 `MoreAdjustHost`(탭 5개, 실시간 미리보기).
- 필터 대화상자 탭 3개: 흐림·노이즈·렌즈 / 선명하게(언샤프 마스크·하이 패스) / 모자이크·노이즈 감소.
- 레이어 효과에 외부 광선 탭, 레이어 ▸ 레이어 효과 ▸ 복사·붙여넣기·지우기(오른쪽 클릭 메뉴에도).
- 이동 도구 옵션 줄: 정렬 6개(왼·가로 가운데·오른·위·세로 가운데·아래, 레이어 하나면 캔버스 기준) + 분포 2개(3개 이상).
- 오른쪽 아래 탭에 히스토그램(채널 선택, 평균·중간값·표준편차·표본 — 512px 축소본 기준 근삿값).

## 안내선·눈금자 (`editor/guides.ts`, `components/Rulers.tsx`)

`Doc.guides {v, h}` (저장·실행취소). 눈금자에서 끌면 생성, 이동 도구(또는 Ctrl)로 끌어 옮기고 눈금자·창 밖으로 끌면 지움. Shift = 소수점 위치.
이동·자르기·사각 선택이 붙는다(`guideSnapTargets`). 보기 ▸ 눈금자(Ctrl+R) · 안내선 ▸ 보기(Ctrl+;)·맞추기(Ctrl+Shift+;)·잠그기(Ctrl+Alt+;)·새 안내선·모두 지우기.

## 레이어 잠금 · 도형 · 패널

- 잠금 `Layer.lock {alpha, pixels, position}` — 레이어 패널 "잠그기" 줄. 막힌 동작은 알림 (`pixels.ts pixelsLocked·positionLocked`).
- 도형 레이어 `Layer.shape` — 도형 도구로 고른 상태에서 옵션 줄이 그 도형을 고친다, 이동 도구로 늘이면 다시 그림(`editor/shape.ts`). 칠하면 픽셀 레이어가 된다.
- 오른쪽 아래 탭 묶음 `PanelTabs`: 작업 내역(스냅샷 포함) · 견본(클릭 전경, Alt+클릭 배경, + 로 추가) · 내비게이터(빨간 상자 끌기, 배율 막대).
- Ctrl+끌기 = 임시 이동 (선택·자르기·손·돋보기·스포이트 제외 — `CanvasView CTRL_OWN`). 문자 Ctrl+Enter 확정 → 이동 도구.

## 문구 규칙

"—"·"A = B" 같은 기호식 설명 금지 → 문장으로. 한 문장 한 줄(`dialogs/parts.tsx Lines`)이 되게 대화상자 폭을 맞춘다. `word-break: keep-all`(base.css).
바꾼 뒤 `npm run audit -- <폴더>` 로 모든 대화상자·메뉴·도구 줄을 찍어 확인.
