/**
 * 개체 선택 AI 모델(SlimSAM-50, Apache-2.0) 내려받기 — resources/sam/ 에 둔다 (git 제외, 인스톨러 extraResources 로 번들).
 * 한 번만 받으면 된다: `node scripts/fetch-models.cjs` (dist 전에 자동 확인). 이미 있으면 건너뛴다.
 * 출처: https://huggingface.co/Xenova/slimsam-50-uniform (Meta Segment Anything 을 가지치기한 SlimSAM 의 ONNX 판)
 */
const fs = require('fs')
const path = require('path')
const REPO = 'Xenova/slimsam-50-uniform'
const FILES = [
  'config.json',
  'preprocessor_config.json',
  'onnx/vision_encoder_quantized.onnx',
  'onnx/prompt_encoder_mask_decoder_quantized.onnx',
  ...(process.env.SAM_FULL ? ['onnx/vision_encoder.onnx', 'onnx/prompt_encoder_mask_decoder.onnx'] : [])
]
const dest = path.join(__dirname, '..', 'resources', 'sam', REPO)

;(async () => {
  for (const f of FILES) {
    const out = path.join(dest, f)
    if (fs.existsSync(out) && fs.statSync(out).size > 0) continue
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const url = `https://huggingface.co/${REPO}/resolve/main/${f}`
    process.stdout.write(`내려받는 중 ${f} … `)
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${url} → ${r.status}`)
    fs.writeFileSync(out + '.part', Buffer.from(await r.arrayBuffer()))
    fs.renameSync(out + '.part', out)
    console.log(`${(fs.statSync(out).size / 1e6).toFixed(1)}MB`)
  }
  // transformers.js 가 쓰는 onnxruntime-web 의 wasm — 기본값은 CDN 이라 오프라인에서 못 쓴다. 같이 둔다
  const ortDir = path.join(__dirname, '..', 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-web', 'dist')
  const ortSrc = fs.existsSync(ortDir) ? ortDir : path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist')
  const ortOut = path.join(__dirname, '..', 'resources', 'sam', 'ort')
  fs.mkdirSync(ortOut, { recursive: true })
  for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) fs.copyFileSync(path.join(ortSrc, f), path.join(ortOut, f))
  console.log('모델 준비 완료:', dest)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
