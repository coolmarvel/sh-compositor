---
title: ADR-0002 스택 — Electron + React + TypeScript + MUI 재스킨 + WebGL2
created: 2026-09-21
status: accepted
---

# ADR-0002: 스택

## 상태

Accepted (2026-09-21, 킥오프 위저드에서 사용자 선택)

## 맥락

Compositor(Swift/SwiftUI/Metal)는 macOS 전용이다. Windows 에서 같은 기능을 오프라인으로 쓰려면 다시 구현해야 한다.
사용자는 파일 변환기(`~/file-converter`, Electron+React+TS+MUI)에서 이미 클래식 UI 와 Compositor 순수 로직 일부를
TypeScript 로 옮겨 두었다.

## 결정

| 항목 | 선택 |
|---|---|
| 셸 | **Electron** (electron-vite, NSIS 인스톨러, 난독화 빌드 — 변환기와 동일 체계) |
| UI | **React 18 + TypeScript + MUI 재스킨** — 변환기의 클래식 토큰(`styles/tokens.ts`)·스킨 13종·타이틀바/메뉴/상태 줄·대화상자 부품을 가져와 시작 |
| 캔버스 | **WebGL2** — 레이어 = 텍스처, 합성 모드는 셰이더, 뷰포트 변환은 GPU. 픽셀의 진실(SSOT)은 CPU 버퍼(Uint8ClampedArray)이고 GPU 는 dirty 사각형만 올려 받는 거울 |
| 순수 로직 | `src/core/` (DOM 없음, node:test 로 테스트). 변환기에서 이식한 보정·필터·효과·원근·내용 인식·매트를 출발점으로 |
| 저장 | 로컬 파일. 프로젝트 = `manifest.json` + `images/<uuid>.png` (Compositor `.comp` v6 와 같은 내용)를 zip 한 `.shcomp` — `.comp` 폴더도 읽는다 |
| 디자인 | 루트 `DESIGN.md` — 자매 앱 계약 계열(Upbit 베이스 + Money Forward 베벨 + Palantir 밀도 + sh-web-editor 크롬). oh-my-design CLI 는 설치하지 않았다(계약을 자매 프로젝트에서 상속) |

## 근거

- **Electron+React+MUI**: 위저드 권장안 — 변환기 자산(클래식 셸·Compositor core 10모듈·패키징·E2E)을 그대로 재사용.
  CSS Modules(자체 부품)는 부품을 새로 만들어야 하고, Tauri 는 새 스택이라 체계를 처음부터 세워야 해 기각.
- **WebGL2**: 사용자 선택. Compositor 가 Metal 로 하는 합성·큰 브러시를 GPU 로 — 8K·수십 레이어에서도 팬/줌이 매끄럽다.
  Canvas2D(권장안이었음)는 구현이 단순하지만 레이어·합성 모드가 많아지면 매 프레임 합성 비용이 커진다.

## 결과

- 좋은 점: 변환기와 한 몸처럼 유지보수(토큰·부품·빌드 스크립트가 같다). GPU 합성으로 뷰 조작이 가볍다.
- 나쁜 점: 합성 모드 셰이더·텍스처 수명 관리가 필요. 픽셀 편집은 CPU(진실) ↔ GPU(거울) 동기화 규약을 지켜야 한다
  (`docs/guides/rendering.md` 에 규약을 둔다).
