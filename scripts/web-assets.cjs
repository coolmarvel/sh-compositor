/**
 * 웹 빌드에 AI 모델을 복사 — out/web/models/sam (SlimSAM 35MB, resources/sam 이 있을 때)
 * WEB_BGRM=1 이면 배경 제거 오프라인 데이터(약 350MB)도 out/web/models/bgrm 으로. 기본은 빼고 온라인 모델을 쓴다.
 */
const { cpSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const out = join(__dirname, '..', 'out', 'web', 'models')
const sam = join(__dirname, '..', 'resources', 'sam')
if (existsSync(sam)) {
  cpSync(sam, join(out, 'sam'), { recursive: true })
  console.log('web: models/sam 복사')
} else console.log('web: resources/sam 이 없어 개체 선택 모델을 싣지 않았습니다 (npm run models)')
const bgrm = join(__dirname, '..', 'node_modules', '@imgly', 'background-removal-data', 'dist')
if (process.env.WEB_BGRM === '1' && existsSync(bgrm)) {
  cpSync(bgrm, join(out, 'bgrm'), { recursive: true })
  console.log('web: models/bgrm 복사')
}
