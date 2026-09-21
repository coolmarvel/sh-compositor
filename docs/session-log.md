---
title: 세션 로그
created: 2026-09-21
updated: 2026-09-21
domain: development
---

# 세션 로그 (최신이 위)

이 파일이 **"언제 무슨 일이 있었나"의 SSOT**다. 세션마다 최상단에 블록 추가.
(커밋/푸시는 사용자가 직접·성긴 단위 — git history 를 이력 SSOT 로 삼지 않는다.)

블록 형식: `## YYYY-MM-DD — 제목` 아래에 **요청/피드백 → 수정 → 검증 → 다음** 순서로 간결하게.

## 2026-09-21 — v0.1.1 첫 설치 피드백 반영 + 미완 항목 + 로드맵 + GitHub 공개

**피드백** (스크린샷 2장 → `docs/feedback-archive/2026-09-21-first-install/`, 이 대화는 file-converter 세션에서 이어짐):
1) 최대화 창에서 처음 연 이미지가 왼쪽 위에 붙음 — 가운데여야 함 2) 레이어 썸네일(세로로 긴 cat)이 행 아래로 넘침
3) 배경 제거: 최신(1.7)을 온라인 모드로, 오프라인이면 못 쓴다고 알림 4) 미완 항목 + 보완·추가 기능 제안을 문서화하며 진행 5) 공개 레포 생성·push.

**원인·수정**
- 1) 첫 맞춤이 창이 작을 때(최대화 전) 한 번만 계산됨 → `View.fit/cw/ch` + `adaptView`: 맞춤 상태면 창·문서 크기 변화에 다시 맞추고,
  사용자가 팬·줌했으면 화면 중심 유지. 도구가 `{...view}` 로 fit 을 복사해 와도 `ctx.setView` 가 해제.
  문서 크기가 바뀌면(자르기·캔버스 크기·실행취소) 스토어가 **동기적으로** 다시 맞춘다(`store.withView`, `editor/view.ts`) — rAF 그리기에서만 하면
  창이 뒤에 있을 때 rAF 가 멈춰 클릭이 옛 보기로 계산됐다(전체 E2E 에서 E3 자르기 실패로 발견).
- 2) 썸네일 칸이 CSS grid 라 img `height:100%` 가 안 먹음 → flex + `object-fit: contain` + overflow hidden.
- 3) `@imgly/background-removal-online`(npm 별칭 = 1.7.0, CDN staticimgly.com) 추가. 대화상자에 자동/내장/최신 + 정밀도(fp16/전정밀),
  연결 확인(`checkOnline` — 실제 요청), 최신 전용인데 오프라인이면 막고 "내장 모델로 진행" 안내. CSP 에 staticimgly.com 만 허용.
  두 라이브러리·onnxruntime 을 `manualChunks` 로 `bgremove-*` 청크에 모아 난독화 제외(전엔 `index-*` 로 섞여 난독화됨).
- 미완: `.comp` 폴더 열기, 폴더(그룹) 마스크·마스크 반전/페더·폴더·조정 레이어 마스크 칠하기, 스팟 복구 획 경계만 훑기.
- 보완: 상태 줄 커서 좌표·색, 최근 파일, WebP 내보내기, 자동 저장(1분)·비정상 종료 복구.
- **성능 버그 발견**: `GLRenderer.setDoc(doc, overrides?)` 가 인자 없이 불려 `undefined !== Map` → 매 프레임(개미 행진 90ms마다) 전체 재합성.
  미사용 overrides·`store.live` 제거로 해결.
- 로드맵 `docs/plans/0002-roadmap.md` (P1: PSD 입출력·눈금자/안내선·피사체 선택·필압·견본·내비게이터 …).

**검증**: typecheck ✓ · unit 47/47 · build ✓ · E2E **70/70** (신규 그룹 I 12건: 최대화 가운데·팬 후 중심 유지·썸네일 경계·그룹 마스크·
마스크 반전/페더·.comp 폴더·WebP·최근 파일·오프라인 차단 안내·온라인 모델 실추론·강제 종료 후 복구) · 잔여 Electron 0.

## 2026-09-21 — 킥오프 완료 + v0.1.0 1차 구현 (Compositor 전 기능 이식)

**요청**: (파일 변환기 세션 9 대화) "포토샵형 편집기를 따로 구현 — 화면은 Compositor 구조, 껍데기만 우리 클래식 UI". 위저드 선택:
Electron+React+TS+MUI 재스킨 · WebGL2 · 이름 sh-compositor · 첫 마일스톤 = "전부". 도중 지시: "playwright로 액션을 완료했으면 프로세스 꺼줘".

**구현**
- core 문서 모델(`src/core/doc/*`): 불변 Doc/Layer/Bitmap, 혼합 16종(W3C), CPU 합성(폴더 격리·클리핑·마스크·조정 레이어·효과),
  스냅샷 이력(구조 공유), 마스크 선택·마법봉, 브러시 덮임 누적, `.shcomp`(= Compositor `.comp` v7 manifest+PNG 의 zip, fflate), 순수 PNG 인·디코더.
  파일 변환기에서 보정·필터·효과·원근·내용 인식·매트·한도·크기 모듈 이식.
- WebGL2 거울 렌더러(`gl/*`): 핑퐁 FBO, 프리멀티플라이드 텍스처, 비트맵 키 텍스처 캐시·부분 업로드.
- 도구 15종(`tools/*`), 편집기 스토어·동작·픽셀 규약(`editor/*`), 캔버스 명령 등록소(`editor/commands.ts`).
- 클래식 셸: 타이틀바(제목 prop화)·메뉴 8개·도구 헤더·도구 레일·탭·레이어 패널·작업 내역·상태 줄·스킨. 대화상자 13종(변환기 5종 이식 + 새로 8종).
- AI 배경 제거 → **레이어 마스크**(비파괴) + GuidedMatte 다듬기. 보정 미리보기 = 클리핑된 임시 조정 레이어(GPU).
- 아이콘 새로 생성(겹친 레이어 세 장, 사진 없음) `scripts/gen-branding-assets.js`. 킥오프 슬롯·DESIGN.md·가이드 4종·format 훅.

**사고·수정**
- `@imgly/background-removal` `^1.4.5` 가 새 설치에서 1.7.0 으로 풀려 모델(`isnet_fp16`)을 못 찾음 → **1.4.5 정확 고정**.
  (파일 변환기도 package.json 은 `^` — lockfile 덕에 1.4.5 유지 중. 재설치하면 같은 사고 가능)
- E2E: MenuBar 제목은 `menuitem`, 저장 대화상자 모킹 인자(창, 옵션), 도구 설정이 localStorage 에 남아 다음 실행 오염 → `--user-data-dir` 분리.
- 앱 닫기 핸드셰이크(저장 확인) 때문에 `app.close()` 가 멈춤 → `closeApp`(app.exit + SIGKILL 확인). `pkill -f` 패턴이 자기 셸을 죽인 일 → `[s]h-…` 트릭.
- 난독화 SKIP 을 이 앱 청크 이름(`ort.*`·`heic2any-*`·`UTIF-*`)에 맞춤, 배경 제거 모듈 동적 import.

**검증**: typecheck ✓ · unit 47/47 · build ✓ · E2E `test/e2e/editor.mjs` **58/58** (A 브러시·GPU=CPU, B 선택, C 레이어·혼합·마스크·조정, D 보정·필터·효과,
E 크기·자르기·회전·이동, F 문자·도형·그라데이션·스포이트·흐림·도장·복구, G 저장/다시 열기·PNG·JPEG·내용 인식·닫기 확인, H AI 배경 제거) · 잔여 Electron 프로세스 0.

**다음**: 사용자 설치·테스트 피드백. todo P1.

