/**
 * 개체 선택 일꾼 (Web Worker) — Segment Anything(SlimSAM-50, Apache-2.0) 을 transformers.js 로.
 *
 *  - embed: 이미지 한 장의 특징(image embeddings)을 한 번 계산해 둔다 (수 초). 같은 key 면 다시 쓰지 않는다.
 *  - decode: 점 프롬프트(양성 1 · 음성 0)로 마스크 후보 3장을 낸다 (0.1~0.3초) — 클릭으로 다듬을 때마다.
 * 이 ONNX 는 상자 입력이 없어서 상자·올가미는 호출측이 점(가운데 양성 + 바깥 음성)으로 바꿔 넘긴다.
 * 모델·wasm 은 aimodel:// (resources/sam) — 완전 오프라인.
 */
import { SamModel, AutoProcessor, RawImage, env, type Tensor } from '@huggingface/transformers'

type Msg =
  { id: number; op: 'embed'; key: string; w: number; h: number; rgba: Uint8ClampedArray; base: string } | { id: number; op: 'decode'; key: string; points: [number, number][]; labels: number[] }

const REPO = 'Xenova/slimsam-50-uniform'
let model: Awaited<ReturnType<typeof SamModel.from_pretrained>> | null = null
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
let cur: { key: string; image: RawImage; emb: Record<string, Tensor> } | null = null

const post = (m: unknown, t: Transferable[] = []): void => (self as unknown as Worker).postMessage(m, t)

async function load(base: string, id: number): Promise<void> {
  if (model && processor) return
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = base
  env.useBrowserCache = false
  ;(env as unknown as { useWasmCache?: boolean }).useWasmCache = false
  const wasm = env.backends.onnx.wasm as { wasmPaths?: unknown; numThreads?: number; proxy?: boolean }
  wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded.asyncify.wasm` }
  wasm.numThreads = 1
  post({ id, progress: '모델 불러오는 중…' })
  model = await SamModel.from_pretrained(REPO, { dtype: 'q8', device: 'wasm' })
  processor = await AutoProcessor.from_pretrained(REPO)
}

self.onmessage = async (e: MessageEvent<Msg | { cancel: number }>) => {
  // 취소 알림: 추론 중간에는 멈출 수 없다. 호출측이 결과를 버린다
  if ('cancel' in e.data) return
  const m = e.data
  try {
    if (m.op === 'embed') {
      await load(m.base, m.id)
      if (cur?.key !== m.key) {
        post({ id: m.id, progress: '그림 분석 중…' })
        const image = new RawImage(m.rgba, m.w, m.h, 4).rgb()
        const inputs = await processor!(image)
        const emb = await (model as unknown as { get_image_embeddings: (i: unknown) => Promise<Record<string, Tensor>> }).get_image_embeddings(inputs)
        cur = { key: m.key, image, emb }
      }
      post({ id: m.id, done: true })
    } else {
      if (!cur || cur.key !== m.key) throw new Error('embedding 이 없습니다')
      const inputs = await processor!(cur.image, { input_points: [[m.points]], input_labels: [[m.labels]] })
      const out = await (model as unknown as (i: unknown) => Promise<{ pred_masks: Tensor; iou_scores: Tensor }>)({ ...inputs, ...cur.emb })
      // binarize:false → 원본 크기의 로짓 (부드러운 가장자리를 위해 호출측이 시그모이드)
      const masks = (
        await (processor as unknown as { post_process_masks: (...a: unknown[]) => Promise<Tensor[]> }).post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, {
          binarize: false
        })
      )[0]
      const logits = new Float32Array(masks.data as Float32Array)
      post({ id: m.id, logits, scores: Array.from(out.iou_scores.data as Float32Array), w: cur.image.width, h: cur.image.height }, [logits.buffer])
    }
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.message : String(err) })
  }
}
