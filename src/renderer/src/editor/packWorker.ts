/**
 * 저장용 일꾼 (Web Worker) — 큰 문서를 .shcomp(PNG 압축)·PSD 로 만드는 무거운 일을 화면 스레드 밖에서.
 * (8K 문서면 몇 초 걸린다. 자동 저장이 1분마다 화면을 멈추지 않게 — 2026-09-21)
 */
import { packProject, docToPsd, type Doc } from '@core/index'

self.onmessage = (e: MessageEvent<{ id: number; op: 'shcomp' | 'psd'; doc: Doc } | { cancel: number }>) => {
  // 취소 알림: 동기 계산이라 이미 돌고 있는 것은 멈출 수 없다. 호출측이 결과를 버린다
  if ('cancel' in e.data) return
  const { id, op, doc } = e.data
  try {
    if (op === 'psd') {
      const r = docToPsd(doc)
      ;(self as unknown as Worker).postMessage({ id, bytes: r.bytes, warnings: r.warnings }, [r.bytes.buffer])
    } else {
      const bytes = packProject(doc)
      ;(self as unknown as Worker).postMessage({ id, bytes, warnings: [] }, [bytes.buffer])
    }
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
