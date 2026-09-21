// 화면 검수용 스크린샷 (문서·레이어·대화상자) — 끝나면 프로세스까지 정리
import { createRequire } from 'module'
import path from 'path'
import os from 'os'
import fs from 'fs'
const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const { _electron: electron } = require_('playwright')
const dir = process.argv[2]
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-shot-'))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${ud}`], cwd: PROJECT, env: { ...process.env, SC_E2E: '1' } })
const proc = app.process()
try {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)
  await page.evaluate(() => {
    const { editor } = window.__sc
    editor.set({ dialog: { kind: 'newCanvas' } })
  })
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await page.waitForTimeout(300)
  // 몇 레이어 만들기
  await page.keyboard.press('Control+Shift+n')
  await page.keyboard.press('u')
  const r = await page.locator('[data-testid="canvas"]').boundingBox()
  await page.mouse.move(r.x + r.width * 0.3, r.y + r.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * 0.55, r.y + r.height * 0.6, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('b')
  await page.evaluate(() => window.__sc.editor.set({ fg: [59, 116, 242] }))
  await page.mouse.move(r.x + r.width * 0.2, r.y + r.height * 0.7)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * 0.8, r.y + r.height * 0.4, { steps: 20 })
  await page.mouse.up()
  await page.keyboard.press('m')
  await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * 0.75, r.y + r.height * 0.45, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(dir, 'shot-main.png') })
  await page.keyboard.press('Control+l')
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(dir, 'shot-levels.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.getByRole('menubar').getByRole('menuitem', { name: '레이어(L)', exact: true }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(dir, 'shot-menu.png') })
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  if (proc.exitCode === null) proc.kill('SIGKILL')
  fs.rmSync(ud, { recursive: true, force: true })
}
