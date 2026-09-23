/**
 * 작업 실행기 — 무거운 계산(필터·내보내기)을 어디서 돌릴지. application 은 계약만 정한다.
 *  - InlineJobRunner: 같은 스레드 (브라우저·테스트). 시작 전 취소만 가능.
 *  - 서버는 worker_threads 실행기(`src/server/workerRunner.ts`)로 격리해 기한·취소 시 스레드를 종료한다.
 * CPU 계산을 async 로 감싸는 것만으로는 이벤트 루프가 분리되지 않는다 (plans/0004 §5).
 */
import type { Doc } from '../core/doc/types'
import { COMMANDS, type CommandOutput } from './commands'
import { exportDoc, type ExportFormat } from './codecs'
import { CommandError } from './errors'

export type Task = { type: 'command'; name: string; doc: Doc; input: unknown } | { type: 'export'; doc: Doc; format: ExportFormat }
export type TaskResult = ({ type: 'command' } & CommandOutput) | { type: 'export'; bytes: Uint8Array; mediaType: string }

export interface JobRunner {
  run(task: Task, signal: AbortSignal): Promise<TaskResult>
  close?(): Promise<void>
}

/** 작업 하나를 실제로 계산 (실행기 공용 — 일꾼 스레드 안에서도 이것을 부른다) */
export function executeTask(task: Task): TaskResult {
  if (task.type === 'export') return { type: 'export', ...exportDoc(task.doc, task.format) }
  const cmd = COMMANDS[task.name]
  if (!cmd) throw new CommandError('UNSUPPORTED_CAPABILITY', `알 수 없는 명령입니다: ${task.name}`)
  return { type: 'command', ...cmd.run(task.doc, task.input) }
}

/**
 * 일꾼 경계를 넘을 때 바뀌지 않은 픽셀 버퍼는 보내지 않는다 — 결과 문서에서 입력과 **같은 객체**인 비트맵을 표식으로 바꾸고,
 * 받는 쪽이 입력 문서의 원래 버퍼로 되돌린다. 그래야 이력 칸끼리 비트맵을 계속 공유한다 (복제하면 칸마다 문서 전체가 복사된다).
 */
type Shared = { __shared: string }
const isShared = (v: unknown): v is Shared => !!v && typeof v === 'object' && '__shared' in (v as object)
export function stripShared(input: Doc, out: Doc): Doc {
  const byId = new Map(input.layers.map((l) => [l.id, l]))
  return {
    ...out,
    selection: out.selection && out.selection === input.selection ? (null as never) : out.selection,
    layers: out.layers.map((l) => {
      const src = byId.get(l.id)
      if (!src) return l
      return {
        ...l,
        bitmap: l.bitmap && l.bitmap === src.bitmap ? ({ __shared: l.id } as never) : l.bitmap,
        mask: l.mask && src.mask && l.mask.bitmap === src.mask.bitmap ? { ...l.mask, bitmap: { __shared: l.id } as never } : l.mask
      }
    })
  }
}
export function restoreShared(input: Doc, out: Doc, keptSelection: boolean): Doc {
  const byId = new Map(input.layers.map((l) => [l.id, l]))
  return {
    ...out,
    selection: keptSelection ? input.selection : out.selection,
    layers: out.layers.map((l) => {
      const src = byId.get(l.id)
      const bitmap = isShared(l.bitmap) ? src!.bitmap : l.bitmap
      const mask = l.mask && isShared(l.mask.bitmap) ? { ...l.mask, bitmap: src!.mask!.bitmap } : l.mask
      return bitmap === l.bitmap && mask === l.mask ? l : { ...l, bitmap, mask }
    })
  }
}

export const cancelled = (): CommandError => new CommandError('CANCELLED', '작업을 취소했습니다.')

export class InlineJobRunner implements JobRunner {
  async run(task: Task, signal: AbortSignal): Promise<TaskResult> {
    // 호출측이 작업 ID 를 받아 갈 틈을 준 뒤 계산한다 (그 사이 취소 가능)
    await new Promise((r) => setTimeout(r, 0))
    if (signal.aborted) throw cancelled()
    return executeTask(task)
  }
}
