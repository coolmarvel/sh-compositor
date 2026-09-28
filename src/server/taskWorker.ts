/**
 * 작업 스레드 본체 — 요청 하나를 계산하고 끝낸다 (worker_threads). 요청마다 새 스레드라 가변 작업 메모리를 사용자끼리 공유하지 않는다.
 * 문서는 구조적 복제로 받는다 (부모의 버퍼를 떼어 가지 않는다). 결과 바이트는 transfer 로 돌려준다.
 */
import { parentPort } from 'node:worker_threads'
import { executeTask, stripShared, type Task } from '../application/jobs'
import { toCommandError, CommandError } from '../application/errors'
import { loadKernels } from './kernels'

loadKernels()

parentPort!.once('message', (task: Task) => {
  try {
    let result = executeTask(task)
    // 바뀌지 않은 비트맵은 돌려보내지 않는다 (부모가 원래 버퍼로 되돌린다 — 이력 공유 유지)
    let keptSelection = false
    if (result.type === 'command') {
      keptSelection = !!task.doc.selection && result.doc.selection === task.doc.selection
      result = { ...result, doc: stripShared(task.doc, result.doc) }
    }
    const transfer = result.type === 'export' ? [result.bytes.buffer as ArrayBuffer] : []
    parentPort!.postMessage({ ok: true, result, keptSelection }, transfer)
  } catch (error) {
    const e = toCommandError(error)
    // 모르는 예외의 원인은 서버 로그(stderr)에만 — 클라이언트에는 내부 문구를 주지 않는다
    if (e.code === 'INTERNAL' && !(error instanceof CommandError))
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'task failed',
          task: task.type === 'command' ? task.name : task.format,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.split('\n').slice(0, 6).join(' | ') : undefined
        })
      )
    parentPort!.postMessage({ ok: false, error: { code: e.code, message: e.message, details: e.details } })
  }
})
