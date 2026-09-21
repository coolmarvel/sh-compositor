/**
 * 도구 목록 — Compositor `NavigationTool` 순서·단축키·설명을 그대로 (도구 레일·상태 줄·단축키가 여기를 본다).
 */
import type { Tool } from '../editor/store'
import type { ToolHandler } from './types'
import { moveTool } from './move'
import { marqueeTool, lassoTool, wandTool } from './select'
import { brushTool, blurTool, cloneTool, healTool } from './paint'
import { cropTool, gradientTool, shapeTool, typeTool, eyedropperTool, handTool, zoomTool } from './misc'

export interface ToolInfo {
  key: Tool
  label: string
  shortcut: string
  /** 상태 줄 안내 (Compositor 상태 줄 문구를 옮김) */
  hint: string
  handler: ToolHandler
}

export const TOOLS: ToolInfo[] = [
  { key: 'move', label: '이동·변형', shortcut: 'V', hint: '끌기 = 이동 · 핸들 = 크기 · 원 = 회전 · Ctrl+모서리 = 자유 변형(Enter 적용) · Alt+끌기 = 복제 · 방향키 1px', handler: moveTool },
  {
    key: 'marquee',
    label: '사각·타원 선택',
    shortcut: 'M',
    hint: '끌기 = 선택 · Shift 더하기 · Alt 빼기 · 선택 안 끌기 = 이동 · Ctrl+끌기 = 픽셀 이동 · Delete 지우기 · Ctrl+D 해제',
    handler: marqueeTool
  },
  { key: 'lasso', label: '올가미', shortcut: 'L', hint: '끌기 = 선택 · 다각형: 클릭으로 꼭짓점, 시작점·더블클릭·Enter 로 닫기, Backspace 한 점 삭제 · Esc 취소', handler: lassoTool },
  { key: 'wand', label: '마법봉', shortcut: 'W', hint: '클릭 = 비슷한 색 선택 · Shift 더하기 · Alt 빼기 · 선택 안 끌기 = 이동 · Ctrl+D 해제', handler: wandTool },
  { key: 'crop', label: '자르기', shortcut: 'C', hint: '끌기 = 자를 영역 · 핸들로 조절 · Alt = 가운데 대칭 · Shift = 정사각 · Enter 적용 · Esc 취소', handler: cropTool },
  { key: 'brush', label: '브러시 · 지우개', shortcut: 'B·E', hint: '끌기 = 칠하기 · [ ] 크기 · Shift+[ ] 경도 · 1~0 불투명도 · Shift+클릭 직선 · X 색 바꾸기 · Space 손', handler: brushTool },
  { key: 'spotHealing', label: '스팟 복구', shortcut: 'J', hint: '잡티 위를 칠하면 주변으로 메꿉니다 · [ ] 크기 · Esc 취소', handler: healTool },
  { key: 'cloneStamp', label: '복제 도장', shortcut: 'S', hint: 'Alt+클릭 = 원점 · 끌기 = 복제 · [ ] 크기 · 1~0 불투명도', handler: cloneTool },
  { key: 'blur', label: '흐림·문지르기·리퀴파이', shortcut: 'R', hint: '끌기 = 흐리게/문지르기/밀기 · [ ] 크기 · 1~0 강도', handler: blurTool },
  { key: 'gradient', label: '그라데이션', shortcut: 'G', hint: '끌기 = 그리기 · 양 끝 끌어 조절 · Shift 45° · Enter 적용 · Esc 취소', handler: gradientTool },
  { key: 'shape', label: '도형', shortcut: 'U', hint: '끌기 = 새 레이어에 도형 · Shift 정사각/원/45° · Alt 가운데 기준 · Tab·Shift+U 다음 도형', handler: shapeTool },
  { key: 'type', label: '문자', shortcut: 'T', hint: '클릭·끌기 = 글상자 · 문자 레이어 클릭 = 다시 편집 · Ctrl+Enter 완료 · Esc 취소', handler: typeTool },
  { key: 'eyedropper', label: '스포이트', shortcut: 'I', hint: '클릭 = 전경색 · Alt+클릭 = 배경색 (보이는 그대로 표본)', handler: eyedropperTool },
  { key: 'hand', label: '손', shortcut: 'H', hint: '끌기 = 화면 이동 · Space 를 누르고 있으면 어느 도구에서나', handler: handTool },
  { key: 'zoom', label: '돋보기', shortcut: 'Z', hint: '클릭 = 확대 · Alt+클릭 = 축소 · 좌우로 끌기 = 부드럽게', handler: zoomTool }
]

export const toolInfo = (t: Tool): ToolInfo | undefined => TOOLS.find((x) => x.key === t)
