/** 명령 등록부 — 이름 → 명령. 서버 작업 실행기·MCP 도구·편집기 브리지가 이 표를 본다 (새 명령은 여기 + catalog.ts + server/mcp.ts) */
import type { DocCommand } from './types'
import { resizeCommand, cropCommand, canvasSizeCommand, rotateCommand, flipCommand, trimCommand, flattenCommand, guidesCommand } from './image'
import {
  layerUpdateCommand,
  layerAddCommand,
  layerDeleteCommand,
  layerDuplicateCommand,
  layerSetActiveCommand,
  layerFlipCommand,
  layerViaCopyCommand,
  layerReorderCommand,
  layerGroupCommand,
  layerUngroupCommand,
  layerMergeCommand,
  layerMaskCommand
} from './layers'
import { selectionSetCommand, selectionModifyCommand } from './selection'
import { fillCommand, eraseCommand, strokeSelectionCommand, contentFillCommand, brushStrokeCommand, gradientCommand, retouchCommand, cloneCommand, healCommand } from './pixels'
import { adjustApplyCommand, adjustQuickCommand, adjustMoreCommand } from './adjust'
import { filterCommand } from './filter'
import { shapeAddCommand } from './shape'

export * from './types'
export * from './image'
export * from './layers'
export * from './selection'
export * from './pixels'
export * from './adjust'
export * from './filter'
export * from './shape'

const LIST: DocCommand<unknown>[] = [
  resizeCommand,
  cropCommand,
  canvasSizeCommand,
  rotateCommand,
  flipCommand,
  trimCommand,
  flattenCommand,
  guidesCommand,
  layerUpdateCommand,
  layerAddCommand,
  layerDeleteCommand,
  layerDuplicateCommand,
  layerSetActiveCommand,
  layerFlipCommand,
  layerViaCopyCommand,
  layerReorderCommand,
  layerGroupCommand,
  layerUngroupCommand,
  layerMergeCommand,
  layerMaskCommand,
  selectionSetCommand,
  selectionModifyCommand,
  fillCommand,
  eraseCommand,
  strokeSelectionCommand,
  contentFillCommand,
  brushStrokeCommand,
  gradientCommand,
  retouchCommand,
  cloneCommand,
  healCommand,
  adjustApplyCommand,
  adjustQuickCommand,
  adjustMoreCommand,
  filterCommand,
  shapeAddCommand
] as DocCommand<unknown>[]

export const COMMANDS: Record<string, DocCommand<unknown>> = Object.fromEntries(LIST.map((c) => [c.name, c]))
export type CommandName = (typeof LIST)[number]['name']
export const COMMAND_NAMES: string[] = LIST.map((c) => c.name)
