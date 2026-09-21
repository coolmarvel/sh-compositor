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
연결 확인은 `checkOnline()`(CDN 에 실제 요청, 4초). 최신 전용인데 연결이 없으면 실행을 막고 "내장 모델로 진행"을 제안. 선택은 localStorage `sc.bgMode`.
