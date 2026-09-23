# SH Compositor

레이어 기반 **오프라인** 이미지 편집기 (Windows). 무료 오픈소스 포토샵 대안인 macOS 전용
[Compositor](https://github.com/robbietilton/Compositor)(MIT)의 기능을 Electron·WebGL2 로 옮기고,
클래식 업무 UI(자체 타이틀바·메뉴 바·상태 줄·스킨 13종)로 감쌌다.

![아이콘](build/icon.png)

## 기능

- **레이어**: 혼합 모드 16종, 불투명도, 폴더, 레이어·폴더 마스크, 클리핑 마스크, 조정 레이어 7종, 레이어 효과(외곽선·그림자·색 덮기·안쪽 그림자)
- **도구 15종**: 이동·자유 변형, 사각/타원·올가미·다각형·마법봉 선택, 자르기, 브러시·지우개, 스팟 복구, 복제 도장, 흐림·문지르기·리퀴파이, 그라데이션, 도형, 문자, 스포이트, 손, 돋보기
- **보정·필터**: 레벨·커브(채널별)·노출·색조/채도(색역별)·자동 톤/대비/색상, 가우시안·모션 블러, 노이즈, 렌즈 보정, 내용 인식 채우기
- **AI 배경 제거**: 내장 모델(오프라인) 또는 최신 모델(온라인) → 레이어 마스크로 (비파괴)
- **파일**: `.shcomp` 프로젝트(Compositor `.comp` 형식 호환, `.comp` 폴더 열기), PNG·JPEG·WebP 내보내기(실제 인코딩 미리보기), 클립보드, 최근 파일, 자동 저장·복구
- 포토샵식 단축키, 작업 내역, 탭 여러 문서
- **웹·자동화 (v1.1)**: 같은 편집기를 브라우저에서(`npm run build:web`), 브라우저 없는 서버 + MCP 도구 51개로 AI 클라이언트(Claude·GPT 등 MCP 지원)가 편집(`npm run build:server`) — [`docs/guides/web-mcp.md`](docs/guides/web-mcp.md)

## 개발

```bash
npm install
npm run dev          # 개발 모드
npm run typecheck && npm test && npm run build
npm i --no-save playwright && npm run e2e   # 실제 앱 E2E (120건, Xvfb)
npm run build:web && npm run e2e:web          # 웹 로컬 편집기 E2E (15건)
npm run build:server && npm run e2e:mcp       # headless 서버·MCP E2E (23건, 도구 51개)
npm run dist:win     # Windows 인스톨러 (WSL 에서는 Wine 필요)
```

구조·규칙은 [`CLAUDE.md`](CLAUDE.md)·[`AGENTS.md`](AGENTS.md)·[`DESIGN.md`](DESIGN.md), 설계 문서는 [`docs/`](docs/)
(브리프·ADR·계획·가이드·세션 로그). 앞으로의 계획: [`docs/plans/0002-roadmap.md`](docs/plans/0002-roadmap.md).

## 라이선스

제작 이성현 © 2026 — [`LICENSE`](LICENSE). 오픈소스 고지(Compositor MIT 포함): [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
