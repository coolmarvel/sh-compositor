/**
 * 도구 목록 — Compositor `NavigationTool` 순서·단축키·설명을 그대로 (도구 레일·상태 줄·단축키가 여기를 본다).
 */
import type { Tool } from '../editor/store'
import type { ToolHandler } from './types'
import { moveTool } from './move'
import { marqueeTool, lassoTool, wandTool } from './select'
import { objectSelectTool } from './objectSelect'
import { brushTool, blurTool, cloneTool, healTool } from './paint'
import { cropTool, gradientTool, shapeTool, typeTool, eyedropperTool, handTool, zoomTool } from './misc'

export interface ToolInfo {
  key: Tool
  label: string
  shortcut: string
  /** 도구 버튼 툴팁 두 번째 줄 — 이 도구가 무엇을 하는지 한 문장 */
  desc: string
  /** 상태 줄 안내 (쓰는 법) */
  hint: string
  handler: ToolHandler
}

export const TOOLS: ToolInfo[] = [
  {
    key: 'move',
    label: '이동·변형',
    shortcut: 'V',
    desc: '레이어를 옮기고 크기·각도를 바꿉니다.',
    hint: '끌어서 옮깁니다. 핸들로 크기, 위의 원으로 각도를 바꿉니다. Ctrl+모서리는 자유 변형(Enter로 적용), Alt+끌기는 복제, 방향키는 1px씩 옮깁니다.',
    handler: moveTool
  },
  {
    key: 'marquee',
    label: '사각·타원 선택',
    shortcut: 'M',
    desc: '사각형이나 타원 모양으로 영역을 선택합니다.',
    hint: '끌어서 선택합니다. Shift는 더하기, Alt는 빼기입니다. 선택 안을 끌면 선택만, Ctrl+끌기는 픽셀을 옮깁니다. Delete는 지우기, Ctrl+D는 선택 해제입니다.',
    handler: marqueeTool
  },
  {
    key: 'lasso',
    label: '올가미 (자유 선택)',
    shortcut: 'L',
    desc: '손으로 테두리를 따라 그려서 원하는 모양대로 선택합니다. 다각형은 클릭으로 꼭짓점을 찍습니다.',
    hint: '끌면서 선택할 곳의 테두리를 그립니다. 다각형은 클릭으로 꼭짓점을 찍고 시작점을 누르거나 더블클릭·Enter로 닫습니다. Backspace는 한 점 지우기, Esc는 취소입니다.',
    handler: lassoTool
  },
  {
    key: 'wand',
    label: '마법봉',
    shortcut: 'W',
    desc: '클릭한 곳과 비슷한 색을 한 번에 선택합니다.',
    hint: '클릭하면 비슷한 색이 선택됩니다. Shift는 더하기, Alt는 빼기, Ctrl+D는 선택 해제입니다.',
    handler: wandTool
  },
  {
    key: 'objectSelect',
    label: '개체 선택 (AI)',
    shortcut: 'W',
    desc: '개체를 넉넉히 감싸면 AI 가 테두리에 딱 맞게 선택합니다. 클릭 한 번으로도 됩니다.',
    hint: '사각형이나 올가미로 개체를 넉넉히 감싸세요. Shift+클릭은 여기도 포함, Alt+클릭은 여기는 빼기입니다. Shift+끌기는 더하기, Alt+끌기는 빼기입니다.',
    handler: objectSelectTool
  },
  {
    key: 'crop',
    label: '자르기',
    shortcut: 'C',
    desc: '캔버스를 원하는 영역만 남기고 자릅니다.',
    hint: '끌어서 남길 영역을 정하고 핸들로 다듬습니다. Alt는 가운데 기준, Shift는 정사각형입니다. Enter로 적용, Esc로 취소합니다.',
    handler: cropTool
  },
  {
    key: 'brush',
    label: '브러시 · 지우개',
    shortcut: 'B·E',
    desc: '전경색으로 칠하거나(B) 지웁니다(E). 마스크 편집 중이면 마스크를 칠합니다.',
    hint: '끌어서 칠합니다. [ ]로 크기, Shift+[ ]로 경도, 숫자 1~0으로 불투명도를 바꿉니다. Shift+클릭은 직선, X는 색 바꾸기, Space를 누르면 손 도구입니다.',
    handler: brushTool
  },
  {
    key: 'spotHealing',
    label: '스팟 복구',
    shortcut: 'J',
    desc: '잡티·먼지를 칠하면 주변 그림으로 자연스럽게 메웁니다.',
    hint: '지우고 싶은 잡티 위를 칠하면 손을 뗄 때 주변으로 메웁니다. [ ]로 크기, Esc로 취소합니다.',
    handler: healTool
  },
  {
    key: 'cloneStamp',
    label: '복제 도장',
    shortcut: 'S',
    desc: '다른 곳의 그림을 그대로 옮겨 칠합니다.',
    hint: 'Alt+클릭으로 가져올 곳을 찍은 뒤 끌어서 칠합니다. [ ]로 크기, 숫자로 불투명도를 바꿉니다.',
    handler: cloneTool
  },
  {
    key: 'blur',
    label: '흐림·문지르기·리퀴파이',
    shortcut: 'R',
    desc: '칠한 곳을 흐리게 하거나, 문지르거나, 밀어서 모양을 바꿉니다.',
    hint: '끌어서 흐리게·문지르기·밀기를 합니다. [ ]로 크기, 숫자로 강도를 바꿉니다.',
    handler: blurTool
  },
  {
    key: 'gradient',
    label: '그라데이션',
    shortcut: 'G',
    desc: '두 색 사이를 부드럽게 이어 칠합니다.',
    hint: '끌어서 방향을 정하고 양 끝을 끌어 다듬습니다. Shift는 45°씩, Enter로 적용, Esc로 취소합니다.',
    handler: gradientTool
  },
  {
    key: 'shape',
    label: '도형',
    shortcut: 'U',
    desc: '사각형·타원·선을 새 레이어에 그립니다.',
    hint: '끌어서 새 레이어에 도형을 그립니다. Shift는 정사각형·원·45°, Alt는 가운데 기준입니다.',
    handler: shapeTool
  },
  {
    key: 'type',
    label: '문자',
    shortcut: 'T',
    desc: '글자를 입력합니다. 문자 레이어를 누르면 다시 고칩니다.',
    hint: '클릭하거나 끌어서 글상자를 만듭니다. Ctrl+Enter로 확정하면 바로 이동·변형할 수 있습니다. Esc는 취소, Ctrl+끌기는 이동입니다.',
    handler: typeTool
  },
  {
    key: 'eyedropper',
    label: '스포이트',
    shortcut: 'I',
    desc: '화면의 색을 찍어 전경색으로 가져옵니다.',
    hint: '클릭하면 전경색, Alt+클릭하면 배경색이 됩니다. 보이는 그대로의 색을 가져옵니다.',
    handler: eyedropperTool
  },
  { key: 'hand', label: '손', shortcut: 'H', desc: '확대한 화면을 끌어서 옮겨 봅니다.', hint: '끌어서 화면을 옮깁니다. 다른 도구에서도 Space를 누르고 있으면 손이 됩니다.', handler: handTool },
  { key: 'zoom', label: '돋보기', shortcut: 'Z', desc: '화면을 확대하거나 축소합니다.', hint: '클릭하면 확대, Alt+클릭하면 축소합니다. 좌우로 끌면 부드럽게 바뀝니다.', handler: zoomTool }
]

export const toolInfo = (t: Tool): ToolInfo | undefined => TOOLS.find((x) => x.key === t)
