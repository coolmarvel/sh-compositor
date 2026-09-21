// 빠른 기동 확인: 앱을 띄워 스크린샷 + 콘솔 오류 수집
import { createRequire } from 'module'
import path from 'path'
const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const { _electron: electron } = require_('playwright')
const shot = process.argv[2] ?? '/tmp/sc-smoke.png'
const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: PROJECT, env: { ...process.env, SC_E2E: '1' } })
const page = await app.firstWindow()
const errs = []
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
page.on('pageerror', (e) => errs.push(String(e)))
await page.waitForLoadState('domcontentloaded')
await page.waitForTimeout(1500)
await page.screenshot({ path: shot })
console.log('errors:', errs)
await app.close()
