import { WorkerClient } from '../util/workerClient'
/**
 * AI 지우개 (갤럭시 AI 지우개·구글 매직 이레이저·애플 클린업처럼) — 칠한 자리를 지우고 주변에 맞게 새로 그려 채운다.
 * 모델 LaMa(Apache-2.0) 를 일꾼에서 돌린다 (`inpaintWorker.ts`). 앞뒤 계산(넓히기·자르기·섞기)은 `core/inpaint.ts`.
 * 배경 제거(투명하게)와는 다른 기능이다 — 이것은 지운 자리를 그림으로 채운다.
 */
import { prepareInpaint, finishInpaint, type Bitmap } from '@core/index'

/** 모델 위치 — 개체 선택과 같은 곳 (데스크톱 aimodel://, 웹 models/sam/) */
const modelBase = (): string => window.api?.samAssetsUrl ?? 'aimodel://assets/'
/** 모델 불러오기 포함 한 번의 기한 — 느린 PC 에서도 이 안에 끝난다 */
const TIMEOUT = 180_000

const client = new WorkerClient<string>(() => new Worker(new URL('./inpaintWorker.ts', import.meta.url), { type: 'module' }), 'AI 지우개 일꾼이 멈췄습니다.')

/**
 * 비트맵에서 hole(비트맵 크기, 128 이상 = 지울 곳)을 지우고 채운 새 픽셀. 지울 곳이 없으면 null.
 * 지운 곳 밖의 픽셀과 알파는 그대로다.
 */
export async function inpaintBitmap(bmp: Bitmap, hole: Uint8Array, progress?: (label: string) => void, signal?: AbortSignal): Promise<Uint8ClampedArray | null> {
  const job = prepareInpaint(bmp, hole)
  if (!job) return null
  // 입력은 일꾼에 넘기고 여기서는 다시 쓰지 않는다 (섞기는 crop·weight 만 본다)
  const { image, mask, size } = job
  const r = await client.request<{ rgb: Float32Array }>({ base: modelBase(), size, image, mask }, { progress, signal, timeoutMs: TIMEOUT, transfer: [image.buffer, mask.buffer] })
  if (r.rgb.length !== 3 * size * size) throw new Error('AI 지우개 결과 크기가 다릅니다.')
  return finishInpaint(bmp, job, r.rgb)
}
