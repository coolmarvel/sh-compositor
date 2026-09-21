# DESIGN.md — SH Compositor 디자인 계약

자매 앱(sh-messenger · remote-assist · sh-web-editor · 파일 변환기)과 같은 **클래식 업무 UI**. 파일 변환기 ADR-0007 을 상속.
값의 SSOT 는 `src/renderer/src/styles/tokens.ts` — 이 문서는 규칙, 코드는 값. 둘이 어긋나면 코드를 기준으로 이 문서를 고친다.

## 원칙

1. **반경 0, 1px 선, 12px 돋움** — 둥근 카드·큰 그림자·여백 넉넉한 웹 스타일 금지.
2. **색은 캔버스(그림)를 위해 아낀다** — 크롬은 회색·흰색, 강조 파랑(`#3b74f2`)은 주 버튼·선택 행·포커스에만.
   이미지를 보는 스테이지는 어두운 회색(`color.viewer #1e2025`), 투명은 어두운 체커.
3. **밀도** — 컨트롤 24px, 행 22px, 도구 레일 36px. Photoshop·Compositor 만큼 조밀하게.
4. **모든 기능은 메뉴에도 있다** — 도구 버튼·패널 버튼에만 있는 기능 금지. 단축키는 메뉴 오른쪽에 표시.
5. **스킨** — 크롬 색은 `chrome.*` CSS 변수(`--k-*`)로만 참조. 보기 → 스킨(DEXT5 13종).

## 화면 골격 (Compositor 구조 × 클래식 껍데기)

```
TitleBar 28     앱 아이콘 · SH Compositor — 문서 이름 *            ─ □ ✕   (frame:false, 앱이 그림)
MenuBar 22      파일 편집 이미지 레이어 선택 필터 보기 도움말
ToolHeader 32   [도구 이름] │ 도구별 옵션 (Compositor 도구 헤더 — 높이 고정)
┌ToolRail 36┬ TabStrip 24 ──────────────────────┬┬ 레이어 패널 (폭 조절 200~520)
│ 도구 15   │ CanvasView (WebGL2 + 오버레이)     ││  혼합·불투명도 / 목록 / 버튼 줄
│ 전경/배경 │                                    ││ 작업 내역
└───────────┴────────────────────────────────────┴┴────────────
StatusBar 22    도구 안내·진행 │ 크기·dpi │ 레이어 수 │ 선택 크기 │ 배율 │ 제작 크레딧
```

## 부품

| 부품 | 위치 | 규칙 |
|---|---|---|
| 베벨 버튼 | theme.ts MuiButton, bar.tsx `bevelSx` | 흰→#e6e6e6, 테두리 #b5b5b5, 호버 #2a8dd4 1px, 눌림 pressed 면 |
| 도구 버튼 | ToolRail, bar.tsx `ToolButton` | 평면, 호버 = 흰 면 + 호버 테두리, 켜짐 = 눌린 면 |
| 대화상자 | dialogs/parts.tsx `ClassicDialog` | 그라데이션 제목 띠(끌어 이동) + 회색 버튼 줄, Enter 확인 · Esc 취소, 덮개 15% 검정 |
| 그룹 박스 | `GroupBox` | fieldset + legend |
| 탭 | dialogs/tabs.tsx, TabStrip | 활성 = 흰 면 + 테두리(아래선 없음), 비활성 = 툴바 면 |
| 목록 행 | LayersPanel | 선택 = `accentSubtle`, 다중 선택 보조 = `hover`, 끌어 놓기 = 2px accent 선 |
| 상태 줄 칸 | chrome/StatusBar | 오목한 칸(위·왼 어두운 선) |

## 금지

- 컴포넌트 sx 에 색·크기 리터럴 (토큰만). 예외: 캔버스 위 오버레이(개미 행진·핸들)는 흑백 대비 고정.
- 사용자 얼굴 사진 (아이콘·인스톨러·UI 어디에도). 서명 이미지·이름 크레딧만.
