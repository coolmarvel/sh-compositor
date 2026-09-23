/**
 * 작업 스레드 본체 — 요청 하나를 계산하고 끝낸다 (worker_threads). 요청마다 새 스레드라 가변 작업 메모리를 사용자끼리 공유하지 않는다.
 * 문서는 구조적 복제로 받는다 (부모의 버퍼를 떼어 가지 않는다). 결과 바이트는 transfer 로 돌려준다.
 */
import { parentPort } from 'node:worker_threads'
import { executeTask, stripShared, type Task } from '../application/jobs'
import { toCommandError } from '../application/errors'

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
    parentPort!.postMessage({ ok: false, error: { code: e.code, message: e.message, details: e.details } })
  }
})
