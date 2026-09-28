---
title: ADR-0007 AI 지우개 (LaMa 인페인팅)와 간편 AI 메뉴
created: 2026-09-28
status: accepted
---

# ADR-0007: AI 지우개 (LaMa 인페인팅)와 간편 AI 메뉴

## 상태

Accepted (v1.2.1)

## 맥락

사용자 요청(2026-09-28): 지금 기능은 포토샵을 배운 사람용이고, 일반 사용자는 버튼 한 번을 원한다.
갤럭시 AI 지우개·구글 매직 이레이저·애플 클린업처럼 **빨간 형광펜으로 칠한 사람·창문 같은 것을 지우고 배경을 자연스럽게 채우는** 기능이 필요하다.
기존 배경 제거는 배경을 투명하게 만들 뿐 채우지 않는다. 기존 내용 인식 채우기(PatchMatch)는 사람처럼 큰 개체에서 무늬가 반복·번진다.
조건: 완전 오프라인(설치본에 모델 동봉), 웹판에서도 동작, 기존 배경 제거와 헷갈리지 않는 이름과 위치.

## 결정

- 모델: **LaMa(big-lama, Apache-2.0)** — OpenCV zoo 배포 ONNX `inpainting_lama_2025jan.onnx`(92MB, 입력 512×512 고정).
  `npm run models` 가 `resources/sam/inpaint/lama.onnx` 로 받고 `aimodel://assets/inpaint/` 로 서빙한다 (개체 선택과 같은 폴더·프로토콜).
- 실행: 일꾼 `editor/inpaintWorker.ts` 에서 onnxruntime-web(transformers.js 와 같은 1.31 판, 별칭 `@sam-ort`) **wasm 멀티스레드**.
  데스크톱은 main 에서 `enable-features=SharedArrayBuffer` 를 켜 스레드를 쓴다 (코어 수 − 1, 최대 8). 웹은 격리가 없으면 1스레드.
- 앞뒤 처리는 순수 함수 `core/inpaint.ts`: 칠한 곳을 한 겹 넓히고(가장자리 자국 방지) 약 2.2배 정사각형으로 잘라 512 로 맞춘 뒤, 결과를 원래 크기로 되돌려 부드러운 가장자리로 섞는다.
  지운 곳 밖 픽셀과 알파는 바뀌지 않는다. 모델을 못 쓰면 내용 인식 채우기로 대신하고 알린다.
- 화면: 도구 레일 **AI 지우개(J, 스팟 복구와 번갈아)** + 메뉴 바 **간편 AI(A)** (보기와 도움말 사이). 간편 AI 에는 AI 지우개·선택 영역 지우기·배경 흐리게·배경을 흰색으로·배경 투명하게(누끼)·피사체 선택·사진 자동 보정.
  배경 흐리게·흰색은 기존 배경 제거 모델의 피사체 마스크를 쓴다 (`core/inpaint.ts blurBackground`·`fillBackground`).

## 근거

같은 IOPaint 시험 사진(철망 앞 사람)으로 비교했다 (2026-09-28).

| 후보 | 크기 | 결과 | 속도 (이 PC, 512) |
|---|---|---|---|
| MI-GAN pipeline v2 (MIT) | 28MB | 사람 자리에 **흰 얼룩**이 남음. 개발사 파이프라인 그대로 돌려도 같음 | 0.6초 (네이티브) |
| LaMa Carve fp32 | 208MB | 사람이 사라지고 철망이 이어짐 | 2초 (네이티브) · wasm 1스레드 15초 |
| **LaMa OpenCV 판** | **92MB** | fp32 와 같은 결과 | wasm 1스레드 15.5초 · **8스레드 4.7초** (출력 동일) |

- WebGPU 는 쓰지 않는다: 소프트웨어 WebGPU(SwiftShader)에서 출력이 전부 255(흰색)로 틀렸고 8분 넘게 걸렸다. 실제 그래픽 카드에서 검증할 수단이 없어 CPU 만 쓴다.
- 서버의 onnxruntime-node 는 설치본에 node_modules 를 싣지 않는 규칙(packaging) 때문에 제외.
- SharedArrayBuffer 를 켜면 배경 제거 라이브러리(imgly, ORT 1.17)도 코어 수만큼 스레드를 띄우는데, 스레드 코드를 함수 문자열로 떠서 띄우므로 난독화된 일꾼 청크에서 `ReferenceError` 로 죽었다 (E2E P4).
  배경 제거 일꾼에서만 `SharedArrayBuffer` 를 지워 예전처럼 1스레드로 둔다 (검증된 동작 유지).

## 결과

- 설치본이 모델만큼(약 90MB, 압축률 낮음) 커진다.
- 한 번 지우는 데 데스크톱 약 5초, 웹 약 15초 (진행 막대에 예상 시간). 화면 스레드는 멈추지 않는다 (E2E P2 긴 작업 800ms 미만).
- 모델 입력이 512 라서 크게 지울수록 채운 부분이 흐리다 (4000px 사진에서 1000px 사람 → 약 4배 확대). 고해상도 보정은 todo.
- 앱 전체에 SharedArrayBuffer 가 켜진다. 로컬 내용만 띄우는 창이라 받아들인다. 새로 ONNX 라이브러리를 넣을 때는 스레드 동작을 확인할 것.
- 서버·MCP 는 AI 지우개를 지원하지 않는다 (capabilities.unsupported 문구에 추가).
