/**
 * 배경 제거 일꾼 (Web Worker) — ONNX 추론은 수 초 동안 CPU 를 붙잡는다. 화면 스레드에서 돌리면 진행 막대·화면이 통째로 멈춘다
 * (2026-09-21 사용자 제보: "피사체 분석 중"에서 막대가 멈춤). 라이브러리의 proxyToWorker 는 실제로 구현돼 있지 않아 직접 옮겼다.
 * 모델은 일꾼 안에 남아 있어 두 번째부터는 불러오기가 빠르다.
 */
type Req = { id: number; png: Uint8Array; engine: 'offline' | 'online'; model?: 'isnet_fp16' | 'isnet'; publicPath: string }

self.onmessage = async (e: MessageEvent<Req | { cancel: number }>) => {
  // 취소 알림: 추론 중간에는 멈출 수 없다. 호출측이 결과를 버린다
  if ('cancel' in e.data) return
  const { id, png, engine, model, publicPath } = e.data
  const post = (m: unknown, t?: Transferable[]): void => (self as unknown as Worker).postMessage(m, t ?? [])
  const progress = (key: string, current: number, total: number): void => post({ id, progress: { key, current, total } })
  try {
    const blob = new Blob([png as unknown as BlobPart], { type: 'image/png' })
    let out: Blob
    if (engine === 'online') {
      const { removeBackground } = await import('@imgly/background-removal-online')
      out = await removeBackground(blob, { model: model ?? 'isnet_fp16', output: { format: 'image/png' }, progress })
    } else {
      const { removeBackground } = await import('@imgly/background-removal')
      out = await removeBackground(blob, { publicPath, output: { format: 'image/png' }, progress })
    }
    const bytes = new Uint8Array(await out.arrayBuffer())
    post({ id, bytes }, [bytes.buffer])
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
