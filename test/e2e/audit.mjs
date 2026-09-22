/**
 * 화면 문구·줄바꿈 검수용 스크린샷 — 모든 대화상자(탭 포함)·메뉴·도구 옵션 줄·툴팁을 찍는다.
 * `node test/e2e/audit.mjs <출력 폴더> [창 폭x높이]` (build 후). 끝나면 앱 프로세스까지 정리.
 */
import { createRequire } from 'module'
import path from 'path'
import os from 'os'
import fs from 'fs'
import zlib from 'zlib'
const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const { _electron: electron } = require_('playwright')
const dir = process.argv[2]
const [WW, WH] = (process.argv[3] ?? '1400x900').split('x').map(Number)
fs.mkdirSync(dir, { recursive: true })
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-audit-'))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${ud}`], cwd: PROJECT, env: { ...process.env, SC_E2E: '1' } })
const proc = app.process()
const dog = setTimeout(() => (proc.kill('SIGKILL'), process.exit(2)), 240000)
let n = 0
const shot = async (page, name, locator) => {
  const file = path.join(dir, `${String(++n).padStart(2, '0')}-${name.replace(/[\\/:*?"<>|]/g, '_')}.png`)
  if (locator) await locator.screenshot({ path: file })
  else await page.screenshot({ path: file })
}
try {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [WW, WH])
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(800)
  await shot(page, 'start')
  // 문서 하나 (투명 PNG 없이 새 캔버스 + 레이어 몇 장)
  await page.evaluate(() => window.__sc.editor.set({ dialog: { kind: 'newCanvas' } }))
  await page.waitForTimeout(400)
  await shot(page, 'dlg-newCanvas', page.getByRole('dialog'))
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+Shift+n')
  await page.keyboard.press('Alt+Backspace')
  const dlg = async (name, d, tabs = []) => {
    await page.evaluate((d) => window.__sc.editor.set({ dialog: d }), d)
    await page.waitForTimeout(600)
    await shot(page, `dlg-${name}`, page.getByRole('dialog'))
    for (const t of tabs) {
      await page.getByRole('dialog').getByRole('tab', { name: t, exact: true }).click()
      await page.waitForTimeout(250)
      await shot(page, `dlg-${name}-${t}`, page.getByRole('dialog'))
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__sc.editor.set({ dialog: null }))
  }
  await dlg('imageSize', { kind: 'imageSize' })
  await dlg('canvasSize', { kind: 'canvasSize' })
  await dlg('adjust', { kind: 'adjust', tab: 'levels' }, ['커브', '노출', '색조/채도', '그레인·반전·맵'])
  await dlg('filters', { kind: 'filters' }, ['선명하게', '모자이크·노이즈 감소'])
  const lid = await page.evaluate(() => window.__sc.editor.doc.activeId)
  await dlg('effects', { kind: 'effects', layerId: lid }, ['그림자', '색 덮기', '안쪽 그림자', '외부 광선'])
  await dlg('export-jpeg', { kind: 'export', format: 'jpeg' })
  await dlg('export-webp', { kind: 'export', format: 'webp' })
  await dlg('selectAmount', { kind: 'selectAmount', op: 'feather' })
  await dlg('color', { kind: 'color', which: 'fg' })
  await dlg('rename', { kind: 'rename', layerId: lid })
  await dlg('confirmClose', { kind: 'confirmClose', tabIds: [await page.evaluate(() => window.__sc.editor.state.activeTabId)], quit: false })
  await dlg('about', { kind: 'about' })
  await dlg('removeBg', { kind: 'removeBg' })
  await dlg('stroke', { kind: 'stroke' })
  await dlg('preferences', { kind: 'preferences' })
  await dlg('newGuide', { kind: 'newGuide' })
  await dlg('refineEdge', { kind: 'refineEdge' })
  for (const w of ['blackWhite', 'colorBalance', 'vibrance', 'posterize', 'threshold']) await dlg(`more-${w}`, { kind: 'moreAdjust', which: w })
  await dlg('help', { kind: 'help' }, ['도구', '선택', '칠하기·고치기', '색 보정·필터', '레이어', '화면·파일'])
  await dlg('recover', { kind: 'recover', items: [{ id: 'x', name: '고양이 합성', path: null, savedAt: Date.now() }] })
  // 메뉴
  for (const m of ['파일(F)', '편집(E)', '이미지(I)', '레이어(L)', '선택(S)', '필터(T)', '보기(V)', '도움말(H)']) {
    await page.getByRole('menubar').getByRole('menuitem', { name: m, exact: true }).click()
    await page.waitForTimeout(300)
    const paper = page.locator('.MuiMenu-paper').first()
    await shot(page, `menu-${m.slice(0, 2)}`, paper)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
  }
  // 도구 옵션 줄 (위쪽 띠만)
  for (const k of ['move', 'marquee', 'lasso', 'wand', 'crop', 'brush', 'spotHealing', 'cloneStamp', 'blur', 'gradient', 'shape', 'type', 'eyedropper', 'hand', 'zoom', 'objectSelect']) {
    await page.locator(`[data-tool="${k}"]`).click()
    await page.waitForTimeout(200)
    await shot(page, `tool-${k}`, page.getByRole('toolbar', { name: '도구 옵션' }))
  }
  // 툴팁 (올가미)
  await page.locator('[data-tool="lasso"]').hover()
  await page.waitForTimeout(900)
  await shot(page, 'tooltip-lasso', page.getByRole('tooltip'))
  // 레이어 오른쪽 클릭 메뉴
  await page.locator('[role="option"][data-layer]').first().click({ button: 'right' })
  await page.waitForTimeout(300)
  await shot(page, 'layer-context', page.locator('.MuiMenu-paper').first())
  await page.keyboard.press('Escape')
  // 하위 메뉴
  for (const [m, sub] of [
    ['레이어(L)', '레이어 마스크'],
    ['레이어(L)', '새 조정 레이어'],
    ['파일(F)', '내보내기'],
    ['보기(V)', '안내선'],
    ['이미지(I)', '조정'],
    ['레이어(L)', '레이어 효과']
  ]) {
    await page.getByRole('menubar').getByRole('menuitem', { name: m, exact: true }).click()
    await page.getByRole('menuitem', { name: sub }).first().hover()
    await page.waitForTimeout(300)
    await shot(page, `submenu-${sub}`)
    await page.keyboard.press('Escape')
    await page.mouse.click(5, 5)
    await page.waitForTimeout(200)
  }
  for (const tab of ['견본', '내비게이터', '작업 내역', '히스토그램']) {
    await page.getByRole('tab', { name: tab }).click()
    await page.waitForTimeout(600)
    await shot(page, `panel-${tab}`)
  }
  await shot(page, 'main')
} finally {
  clearTimeout(dog)
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  if (proc.exitCode === null) proc.kill('SIGKILL')
  fs.rmSync(ud, { recursive: true, force: true })
  console.log('shots:', n)
}
