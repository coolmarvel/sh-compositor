/**
 * AI 지우개 일꾼 (Web Worker) — LaMa(big-lama, Apache-2.0 · OpenCV 배포 ONNX 92MB)로 칠한 자리를 주변에 맞게 새로 그린다.
 *
 * 입력: 512×512 RGB(CHW, 0~1) + 마스크(1 = 지울 곳). 출력: RGB 0~255. 자르기·크기 맞추기·섞기는 `core/inpaint.ts`.
 * CPU(wasm) 멀티스레드로만 돌린다 — 데스크톱은 main 이 SharedArrayBuffer 를 켜 두어 스레드 여럿(8스레드 약 5초), 웹은 격리가 없으면 1스레드(약 15초).
 * WebGPU 는 쓰지 않는다: 2026-09-28 소프트웨어 WebGPU(SwiftShader)에서 결과가 전부 흰색으로 틀리게 나왔다 — 실제 그래픽 카드에서 검증 전까지 CPU 만.
 * ORT 는 transformers.js 와 같은 판(asyncify wasm, aimodel:// 의 ort/)을 쓴다 — 별칭 `@sam-ort` (vite 설정).
 * 모델·wasm 은 aimodel:// (resources/sam/inpaint) — 완전 오프라인.
 */
import * as ort from '@sam-ort'

type Msg = { id: number; base: string; size: number; image: Float32Array; mask: Float32Array }

let session: ort.InferenceSession | null = null

const post = (m: unknown, t: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, t)

/** 스레드 수 — SharedArrayBuffer 가 있을 때만 여럿 (없으면 ORT 가 1로 되돌린다). 화면 스레드 몫은 남긴다 */
const threads = (): number => (typeof SharedArrayBuffer === 'undefined' ? 1 : Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1)))

async function open(base: string, id: number): Promise<ort.InferenceSession> {
  if (session) return session
  ort.env.wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded.asyncify.wasm` }
  ort.env.wasm.numThreads = threads()
  post({ id, progress: '1/2 AI 지우개 모델 불러오는 중…' })
  const r = await fetch(`${base}inpaint/lama.onnx`)
  if (!r.ok) throw new Error(`AI 지우개 모델을 찾지 못했습니다 (${r.status}).`)
  // 경고(쓰지 않는 초기값 정리 등)는 스레드마다 console.error 로 찍혀 오류처럼 보인다 → 오류만
  ort.env.logLevel = 'error'
  session = await ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), { executionProviders: ['wasm'], logSeverityLevel: 3 })
  return session
}

self.onmessage = async (e: MessageEvent<Msg | { cancel: number }>) => {
  // 취소 알림: 추론 중간에는 멈출 수 없다. 호출측이 결과를 버린다
  if ('cancel' in e.data) return
  const m = e.data
  try {
    const s = await open(m.base, m.id)
    post({ id: m.id, progress: ort.env.wasm.numThreads === 1 ? '2/2 지운 자리를 채우는 중… (15초 안팎)' : '2/2 지운 자리를 채우는 중… (5초 안팎)' })
    const out = await s.run({ image: new ort.Tensor('float32', m.image, [1, 3, m.size, m.size]), mask: new ort.Tensor('float32', m.mask, [1, 1, m.size, m.size]) })
    const rgb = new Float32Array((out[s.outputNames[0]] as ort.Tensor).data as Float32Array)
    post({ id: m.id, rgb }, [rgb.buffer])
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.message : String(err) })
  }
}
