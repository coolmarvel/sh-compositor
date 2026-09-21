/**
 * AI 배경 제거 — 두 엔진 (둘 다 @imgly/background-removal, ONNX 를 이 PC 에서 실행):
 *
 *  - **오프라인(내장)**: 1.4.5 + 모델 데이터 패키지(~350MB)를 인스톨러에 번들 → main 의 bgrm:// 로 서빙. 인터넷 불필요.
 *    데이터 패키지가 npm 에 1.4.5 까지만 있어서 이 버전에 고정된다 (신버전 라이브러리는 모델 이름이 달라 못 읽음).
 *  - **온라인(최신)**: 1.7.0 (`@imgly/background-removal-online` 별칭 설치) — 모델을 imgly CDN(staticimgly.com)에서 받는다.
 *    ISNet 개선 모델(fp16 기본, 전정밀 선택 가능). 인터넷이 없으면 쓸 수 없다 → `checkOnline()` 으로 먼저 확인.
 *    이미지 자체는 업로드하지 않는다 — 모델 파일만 내려받고 추론은 로컬.
 *
 * Compositor 는 Apple Vision 으로 피사체 마스크를 만든다(macOS 전용). 결과 마스크는 Compositor 의 GuidedMatte 다듬기(core/matte)를
 * 거쳐 **레이어 마스크**로 들어간다 — 비파괴, 마스크를 칠해 고칠 수 있다.
 */
import { encodePng, decodePng, refineMatte, hasMatteRefine, type Bitmap, type MatteRefine } from '@core/index'

declare const __BG_ASSETS_DEV__: string

export type BgEngine = 'offline' | 'online'
/** 온라인 모델 정밀도 — fp16 = 기본(빠름), isnet = 전정밀(가장 정확, 내려받기 큼) */
export type OnlineModel = 'isnet_fp16' | 'isnet'

/** 온라인 모델 CDN (라이브러리 1.7.0 의 기본 publicPath 와 같은 곳) */
export const ONLINE_ORIGIN = 'https://staticimgly.com'
const ONLINE_PROBE = `${ONLINE_ORIGIN}/@imgly/background-removal-data/1.7.0/dist/resources.json`

function offlineBase(): string {
  const fromApi = (window as { api?: { bgAssetsUrl?: string } }).api?.bgAssetsUrl
  if (fromApi) return fromApi
  if (typeof __BG_ASSETS_DEV__ === 'string' && __BG_ASSETS_DEV__) return new URL(__BG_ASSETS_DEV__, location.origin).toString()
  throw new Error('배경 제거 모델 경로를 찾지 못했습니다.')
}

/** 온라인 모델 CDN 에 닿는가 (4초 제한). navigator.onLine 은 "랜선 꽂힘"만 보므로 실제로 요청해 본다 */
export async function checkOnline(timeoutMs = 4000): Promise<boolean> {
  if (!navigator.onLine) return false
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(ONLINE_PROBE, { method: 'GET', cache: 'no-store', signal: ac.signal })
    return r.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

type Progress = (key: string, current: number, total: number) => void
const progressOf =
  (onProgress?: (label: string) => void): Progress =>
  (key, current, total) => {
    if (key.startsWith('fetch')) onProgress?.(`모델 불러오는 중… ${Math.round((current / Math.max(1, total)) * 100)}%`)
    else onProgress?.('피사체 분석 중…')
  }

/** 비트맵 → 피사체 마스크 (0~255, 비트맵 크기) */
export async function subjectMask(bmp: Bitmap, refine: MatteRefine | null, opts: { engine: BgEngine; model?: OnlineModel }, onProgress?: (label: string) => void): Promise<Uint8Array> {
  const png = encodePng(bmp.width, bmp.height, bmp.data)
  const blob = new Blob([png as unknown as BlobPart], { type: 'image/png' })
  let out: Blob
  if (opts.engine === 'online') {
    const { removeBackground } = await import('@imgly/background-removal-online')
    out = await removeBackground(blob, { model: opts.model ?? 'isnet_fp16', output: { format: 'image/png' }, progress: progressOf(onProgress) })
  } else {
    const { removeBackground } = await import('@imgly/background-removal')
    out = await removeBackground(blob, { publicPath: offlineBase(), output: { format: 'image/png' }, progress: progressOf(onProgress) })
  }
  const res = decodePng(new Uint8Array(await out.arrayBuffer()))
  if (res.width !== bmp.width || res.height !== bmp.height) throw new Error(`배경 제거 결과 크기가 다릅니다 (${res.width}×${res.height})`)
  const n = bmp.width * bmp.height
  // 모델 출력 알파 × 원본 알파 (원래 투명한 곳은 그대로 투명)
  let mask: Float32Array = new Float32Array(n)
  for (let i = 0; i < n; i++) mask[i] = (res.data[i * 4 + 3] / 255) * (bmp.data[i * 4 + 3] / 255)
  if (hasMatteRefine(refine)) {
    const guide = new Float32Array(n)
    for (let i = 0; i < n; i++) guide[i] = (0.299 * bmp.data[i * 4] + 0.587 * bmp.data[i * 4 + 1] + 0.114 * bmp.data[i * 4 + 2]) / 255
    mask = refineMatte(mask, guide, bmp.width, bmp.height, refine)
  }
  const u8 = new Uint8Array(n)
  for (let i = 0; i < n; i++) u8[i] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255)
  return u8
}
