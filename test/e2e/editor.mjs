/**
 * 편집기 전체 기능 E2E (Playwright _electron, out/ 빌드 = 난독화 포함 설치본과 같은 코드).
 *
 * 실행: npm run build 후 `node test/e2e/editor.mjs [그룹…]`  (예: node test/e2e/editor.mjs A C)
 * 필요: `npm i --no-save playwright` (브라우저 다운로드 불필요 — node_modules 의 electron 을 띄움). WSLg 등 DISPLAY.
 * 상태 확인은 SC_E2E=1 로 띄워 여는 window.__sc (store·flattenDoc) 로 — 화면 조작은 전부 실제 마우스·키보드.
 */
import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'))
const FIX = path.join(WORK, 'fixtures')
const OUT = path.join(WORK, 'outputs')
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const { _electron: electron } = require_('playwright')
fs.mkdirSync(FIX, { recursive: true })
fs.mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)

// ── 픽스처 (최소 PNG 인코더) ──
const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(h * (1 + w * 4))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(px(x, y), y * (1 + w * 4) + 1 + x * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
fs.writeFileSync(
  path.join(FIX, 'quad.png'),
  png(200, 100, (x, y) => (x < 100 ? (y < 50 ? [220, 40, 40, 255] : [40, 180, 60, 255]) : y < 50 ? [40, 60, 220, 255] : [240, 240, 240, 255]))
)
fs.writeFileSync(
  path.join(FIX, 'subject.png'),
  png(200, 150, (x, y) => ((x - 100) ** 2 + (y - 75) ** 2 <= 40 ** 2 ? [220, 40, 40, 255] : [40, 180, 90, 255]))
)
fs.writeFileSync(
  path.join(FIX, 'stripes.png'),
  png(60, 40, (x) => (x % 6 < 3 ? [240, 180, 20, 255] : [20, 60, 200, 255]))
)
fs.writeFileSync(
  path.join(FIX, 'tall.png'),
  png(80, 240, (x, y) => [200, Math.round((y * 255) / 240), 60, 255])
)
fs.writeFileSync(
  path.join(FIX, 'gray.png'),
  png(64, 64, () => [128, 128, 128, 255])
)

// ── 하네스 ──
const results = []
async function t(name, fn) {
  try {
    await fn()
    results.push({ ok: true, name })
    console.log(`  PASS ${name}`)
  } catch (e) {
    results.push({ ok: false, name, err: e?.message ?? String(e) })
    console.log(`  FAIL ${name}: ${(e?.message ?? String(e)).slice(0, 400)}`)
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m)
}
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

let openQueue = []
async function launch(userData = path.join(WORK, 'userdata-' + Date.now())) {
  const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`], cwd: PROJECT, env: { ...process.env, SC_E2E: '1' } })
  await app.evaluate(({ dialog, shell }, outDir) => {
    const base = (p) => String(p).split(/[\\/]/).pop()
    dialog.showSaveDialog = async (...a) => ({ canceled: false, filePath: outDir + '/' + base(a[a.length - 1]?.defaultPath || 'out.bin') })
    globalThis.__openQueue = []
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: globalThis.__openQueue.splice(0) })
    shell.showItemInFolder = () => {}
  }, OUT)
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('SH Compositor').first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(300)
  return { app, page, errors, userData }
}
/** 앱 종료 — 저장 확인을 거치지 않고 강제 종료 후 프로세스까지 정리 (테스트 프로세스 잔존 금지) */
async function closeApp(app) {
  const proc = app.process()
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  try {
    if (proc.exitCode === null) proc.kill('SIGKILL')
  } catch {}
}
const queueOpen = (app, ...files) => app.evaluate((_, f) => globalThis.__openQueue.push(...f), files)

/** 문서 요약 (store) */
const docInfo = (page) =>
  page.evaluate(() => {
    const d = window.__sc.editor.doc
    if (!d) return null
    return {
      w: d.width,
      h: d.height,
      layers: d.layers.map((l) => ({
        name: l.name,
        kind: l.kind,
        blend: l.blend,
        opacity: l.opacity,
        visible: l.visible,
        parent: l.parentId,
        mask: !!l.mask,
        clip: l.clip,
        fx: !!l.effects,
        id: l.id
      })),
      active: d.activeId,
      sel: d.selection?.bounds ?? null,
      tool: window.__sc.editor.state.tool,
      undo: window.__sc.editor.tab.history.past.length
    }
  })
/** 합성 결과 픽셀 (CPU) */
const px = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const d = window.__sc.editor.doc
      const f = window.__sc.flattenDoc(d)
      const i = (y * f.width + x) * 4
      return Array.from(f.data.slice(i, i + 4))
    },
    [x, y]
  )
/** 문서 좌표 → 페이지 좌표 */
const toScreen = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const v = window.__sc.editor.tab.view
      const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect()
      return { x: r.left + v.panX + x * v.zoom, y: r.top + v.panY + y * v.zoom }
    },
    [x, y]
  )
async function drag(page, pts, opts = {}) {
  const s = await Promise.all(pts.map((p) => toScreen(page, p[0], p[1])))
  if (opts.mods) for (const m of opts.mods) await page.keyboard.down(m)
  await page.mouse.move(s[0].x, s[0].y)
  await page.mouse.down()
  for (let i = 1; i < s.length; i++) await page.mouse.move(s[i].x, s[i].y, { steps: opts.steps ?? 8 })
  await page.mouse.up()
  if (opts.mods) for (const m of opts.mods) await page.keyboard.up(m)
  await page.waitForTimeout(120)
}
async function click(page, x, y, mods = []) {
  const s = await toScreen(page, x, y)
  for (const m of mods) await page.keyboard.down(m)
  await page.mouse.click(s.x, s.y)
  for (const m of mods) await page.keyboard.up(m)
  await page.waitForTimeout(120)
}
async function menu(page, top, item) {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click()
  await page.getByRole('menuitem', { name: item }).first().click()
  await page.waitForTimeout(150)
}
const tool = (page, label) => page.locator(`[data-tool="${label}"]`).click()
const press = async (page, k) => {
  await page.keyboard.press(k)
  await page.waitForTimeout(120)
}
async function newDoc(page, w = 400, h = 300) {
  await press(page, 'Control+n')
  await page.getByLabel('새 문서 폭').fill(String(w))
  await page.getByLabel('새 문서 높이').fill(String(h))
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await page.waitForTimeout(250)
}
async function openFile(app, page, name) {
  await queueOpen(app, path.join(FIX, name))
  await press(page, 'Control+o')
  await page.waitForFunction(() => !!window.__sc.editor.doc)
  await page.waitForTimeout(250)
}
async function dialogOk(page, label = '확인') {
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(250)
}
/** 화면(GL) 픽셀 — 캔버스 스크린샷 */
async function screenPx(page, x, y) {
  const s = await toScreen(page, x + 0.5, y + 0.5)
  const buf = await page.screenshot({ clip: { x: Math.floor(s.x), y: Math.floor(s.y), width: 1, height: 1 } })
  return page.evaluate(async (b64) => {
    const bin = atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    const bmp = await createImageBitmap(new Blob([arr]))
    const c = new OffscreenCanvas(1, 1)
    const g = c.getContext('2d')
    g.drawImage(bmp, 0, 0)
    return Array.from(g.getImageData(0, 0, 1, 1).data)
  }, buf.toString('base64'))
}

const groups = {}

// A) 새 문서 · 브러시 · 실행취소 · 지우개 · 색
groups.A = async () => {
  const { app, page, errors } = await launch()
  await t('A1 새로 만들기 400×300 흰 배경', async () => {
    await newDoc(page)
    const d = await docInfo(page)
    assert(d && d.w === 400 && d.h === 300, JSON.stringify(d))
    assert(near(await px(page, 10, 10), [255, 255, 255, 255]), 'not white')
  })
  await t('A2 브러시 획 (검정) → 픽셀 칠해짐', async () => {
    await press(page, 'b')
    await drag(page, [
      [50, 150],
      [350, 150]
    ])
    const p = await px(page, 200, 150)
    assert(p[0] < 60, `brush not applied ${p}`)
    assert(near(await px(page, 200, 20), [255, 255, 255, 255]), 'painted outside')
  })
  await t('A3 Ctrl+Z 실행취소 / Ctrl+Shift+Z 다시', async () => {
    await press(page, 'Control+z')
    assert(near(await px(page, 200, 150), [255, 255, 255, 255]), 'undo failed')
    await press(page, 'Control+Shift+z')
    assert((await px(page, 200, 150))[0] < 60, 'redo failed')
  })
  await t('A4 지우개(E) → 배경 투명', async () => {
    await press(page, 'e')
    await drag(page, [
      [200, 60],
      [200, 240]
    ])
    const p = await px(page, 200, 100)
    assert(p[3] < 30, `erase failed ${p}`)
  })
  await t('A5 X 색 바꾸기 → 흰 브러시', async () => {
    await press(page, 'b')
    await press(page, 'x')
    await drag(page, [
      [60, 250],
      [340, 250]
    ])
    // 흰 배경 위 흰색이라 합성은 흰색, 상태에서 fg 확인
    const fg = await page.evaluate(() => window.__sc.editor.state.fg)
    assert(near(fg, [255, 255, 255]), `fg ${fg}`)
    await press(page, 'd')
  })
  await t('A6 GPU 화면 = CPU 합성 (흰·검정 지점)', async () => {
    await press(page, 'Control+1')
    const cpu = await px(page, 120, 150)
    const gpu = await screenPx(page, 120, 150)
    assert(near(cpu.slice(0, 3), gpu.slice(0, 3), 6), `cpu ${cpu} gpu ${gpu}`)
  })
  await t('A7 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// B) 열기 · 선택 · 지우기 · 채우기 · 반전 · 레이어로 복사
groups.B = async () => {
  const { app, page, errors } = await launch()
  await t('B1 PNG 열기 200×100', async () => {
    await openFile(app, page, 'quad.png')
    const d = await docInfo(page)
    assert(d.w === 200 && d.h === 100, JSON.stringify(d))
    assert(near(await px(page, 20, 20), [220, 40, 40, 255]), 'pixel')
  })
  await t('B2 사각 선택 → Delete 지우기 (투명)', async () => {
    await press(page, 'm')
    await drag(page, [
      [10, 10],
      [60, 40]
    ])
    const d = await docInfo(page)
    assert(d.sel && Math.abs(d.sel.w - 50) <= 1 && Math.abs(d.sel.h - 30) <= 1, JSON.stringify(d.sel))
    await press(page, 'Delete')
    assert((await px(page, 30, 20))[3] === 0, 'not cleared')
    assert((await px(page, 80, 45))[3] === 255, 'cleared outside')
  })
  await t('B3 전경색 채우기 (Alt+Backspace)', async () => {
    await press(page, 'Alt+Backspace')
    assert(near(await px(page, 30, 20), [0, 0, 0, 255]), `fill ${await px(page, 30, 20)}`)
  })
  await t('B4 선택 해제 → 반전(모두 선택 없음 = 전체 반전)', async () => {
    await press(page, 'Control+d')
    assert((await docInfo(page)).sel === null, 'deselect')
  })
  await t('B5 복사한 레이어 (Ctrl+J, 선택 영역)', async () => {
    await drag(page, [
      [110, 10],
      [190, 40]
    ])
    await press(page, 'Control+j')
    const d = await docInfo(page)
    assert(d.layers.length === 2, JSON.stringify(d.layers))
  })
  await t('B6 마법봉: 초록 영역 선택', async () => {
    await press(page, 'Control+d')
    await press(page, 'w')
    await page.evaluate(() => window.__sc.editor.setSettings({ wandSampleAll: true }))
    await click(page, 30, 80)
    const d = await docInfo(page)
    assert(d.sel && d.sel.x === 0 && d.sel.y === 50 && d.sel.w === 100 && d.sel.h === 50, JSON.stringify(d.sel))
  })
  await t('B7 선택 반전 Ctrl+Shift+I', async () => {
    await press(page, 'Control+Shift+i')
    const d = await docInfo(page)
    assert(d.sel && d.sel.w === 200, JSON.stringify(d.sel))
    await press(page, 'Control+d')
  })
  await t('B8 올가미 다각형 선택', async () => {
    await press(page, 'l')
    await page.getByRole('button', { name: '다각형', exact: true }).click()
    await click(page, 20, 20)
    await click(page, 80, 20)
    await click(page, 50, 80)
    await press(page, 'Enter')
    const d = await docInfo(page)
    assert(d.sel && d.sel.w >= 58 && d.sel.h >= 58, JSON.stringify(d.sel))
    await press(page, 'Control+d')
  })
  await t('B9 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// C) 레이어 패널
groups.C = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'gray.png')
  await t('C1 새 레이어 + 칠하기 + 곱하기 혼합', async () => {
    await press(page, 'Control+Shift+n')
    let d = await docInfo(page)
    assert(d.layers.length === 2, 'no new layer')
    await press(page, 'Alt+Backspace') // 검정 채우기 → 전경색 바꿔 빨강으로
    await page.evaluate(() => window.__sc.editor.set({ fg: [255, 0, 0] }))
    await press(page, 'Alt+Backspace')
    await page.getByLabel('혼합 모드').click()
    await page.getByRole('option', { name: '곱하기', exact: true }).click()
    await page.waitForTimeout(200)
    d = await docInfo(page)
    assert(d.layers[1].blend === 'multiply', JSON.stringify(d.layers))
    const p = await px(page, 30, 30)
    assert(near(p, [128, 0, 0, 255], 2), `multiply ${p}`)
  })
  await t('C2 GPU 곱하기 = CPU', async () => {
    const gpu = await screenPx(page, 30, 30)
    assert(near(gpu.slice(0, 3), [128, 0, 0], 6), `gpu ${gpu}`)
  })
  await t('C3 불투명도 50 → 합성 변화', async () => {
    const box = page.getByLabel('불투명도', { exact: true })
    await box.fill('50')
    await box.press('Enter')
    await page.waitForTimeout(200)
    const p = await px(page, 30, 30)
    assert(near(p, [128, 64, 64, 255], 3), `opacity ${p}`)
  })
  await t('C4 눈 끄기 → 회색만', async () => {
    const name = (await docInfo(page)).layers[1].name
    await page.getByRole('button', { name: `${name} 숨기기` }).click()
    await page.waitForTimeout(150)
    assert(near(await px(page, 30, 30), [128, 128, 128, 255]), 'hidden')
    await page.getByRole('button', { name: `${name} 보이기` }).click()
  })
  await t('C5 복제·그룹·그룹 해제', async () => {
    await press(page, 'Control+j')
    assert((await docInfo(page)).layers.length === 3, 'dup')
    await press(page, 'Control+g')
    let d = await docInfo(page)
    assert(
      d.layers.some((l) => l.kind === 'group'),
      'group'
    )
    await press(page, 'Control+Shift+g')
    d = await docInfo(page)
    assert(!d.layers.some((l) => l.kind === 'group'), 'ungroup')
  })
  await t('C6 아래와 병합 Ctrl+E', async () => {
    const before = (await docInfo(page)).layers.length
    await press(page, 'Control+e')
    assert((await docInfo(page)).layers.length === before - 1, 'merge')
  })
  await t('C7 레이어 마스크 + 검정 칠 → 가려짐', async () => {
    await page.evaluate(() => window.__sc.editor.set({ fg: [0, 0, 0] }))
    await press(page, 'q')
    let d = await docInfo(page)
    const top = d.layers[d.layers.length - 1]
    assert(top.mask, 'mask')
    await press(page, 'Alt+Backspace')
    assert(near(await px(page, 30, 30), [128, 128, 128, 255]), `masked ${await px(page, 30, 30)}`)
  })
  await t('C8 이름 바꾸기 (더블클릭)', async () => {
    const d = await docInfo(page)
    const top = d.layers[d.layers.length - 1]
    await page.locator(`[data-layer="${top.name}"] span`).filter({ hasText: top.name }).first().dblclick()
    await page.getByLabel('레이어 이름').fill('새이름')
    await page.getByLabel('레이어 이름').press('Enter')
    await page.waitForTimeout(150)
    assert(
      (await docInfo(page)).layers.some((l) => l.name === '새이름'),
      'rename'
    )
  })
  await t('C9 조정 레이어(반전) → 합성 반전', async () => {
    await page.getByRole('button', { name: '새 조정 레이어' }).click()
    await page.getByRole('menuitem', { name: '반전…' }).click()
    await page.waitForTimeout(200)
    const p = await px(page, 30, 30)
    assert(near(p, [127, 127, 127, 255], 2), `invert ${p}`)
    const gpu = await screenPx(page, 30, 30)
    assert(near(gpu.slice(0, 3), [127, 127, 127], 6), `gpu ${gpu}`)
  })
  await t('C10 작업 내역 클릭 → 되돌리기', async () => {
    const opts = page.locator('[aria-label="작업 내역"] [role="option"]')
    const n = await opts.count()
    await opts.nth(n - 2).click()
    await page.waitForTimeout(150)
    assert(near(await px(page, 30, 30), [128, 128, 128, 255]), 'history jump')
  })
  await t('C11 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// D) 보정·필터·효과
groups.D = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'gray.png')
  await t('D1 레벨(Ctrl+L) 입력 흰색 200 → 밝아짐', async () => {
    await press(page, 'Control+l')
    const inputs = page.getByRole('dialog').getByLabel('흰색 값')
    await inputs.first().fill('200')
    await page.waitForTimeout(200)
    // 확인 전: 문서는 그대로, 미리보기만
    assert(near(await px(page, 5, 5), [128, 128, 128, 255]), 'doc changed before OK')
    await dialogOk(page)
    const p = await px(page, 5, 5)
    assert(p[0] > 150, `levels ${p}`)
  })
  await t('D2 보정 취소 → 변화 없음', async () => {
    const before = await px(page, 5, 5)
    await press(page, 'Control+u')
    await page.getByRole('dialog').getByLabel('밝기 값').fill('-80')
    await page.getByRole('dialog').getByRole('button', { name: '취소', exact: true }).click()
    await page.waitForTimeout(200)
    assert(near(await px(page, 5, 5), before, 0), 'cancel changed')
  })
  await t('D3 반전 Ctrl+I', async () => {
    const b = await px(page, 5, 5)
    await press(page, 'Control+i')
    const a = await px(page, 5, 5)
    assert(Math.abs(a[0] - (255 - b[0])) <= 1, `invert ${b} → ${a}`)
  })
  await t('D4 필터: 가우시안 블러 적용', async () => {
    await press(page, 'Control+z')
    await press(page, 'm')
    await drag(page, [
      [0, 0],
      [32, 64]
    ])
    await page.evaluate(() => window.__sc.editor.set({ fg: [0, 0, 0] }))
    await press(page, 'Alt+Backspace')
    await press(page, 'Control+d')
    await menu(page, '필터(T)', '흐림·노이즈·렌즈…')
    await page.getByRole('dialog').getByLabel('가우시안 값').fill('4')
    await page.waitForTimeout(400)
    await dialogOk(page)
    await page.waitForTimeout(400)
    const edge = await px(page, 32, 32)
    assert(edge[0] > 10 && edge[0] < 245, `blur edge ${edge}`)
  })
  await t('D5 레이어 효과: 외곽선', async () => {
    await press(page, 'Control+Shift+n')
    await press(page, 'm')
    await drag(page, [
      [20, 20],
      [44, 44]
    ])
    await press(page, 'Alt+Backspace')
    await press(page, 'Control+d')
    await menu(page, '레이어(L)', '레이어 효과…')
    await page.getByRole('dialog').getByText('사용').first().click()
    await page.waitForTimeout(150)
    await dialogOk(page)
    const d = await docInfo(page)
    assert(d.layers[d.layers.length - 1].fx, 'no fx')
  })
  await t('D6 조정 레이어(레벨) 설정 편집', async () => {
    await menu(page, '레이어(L)', '새 조정 레이어: 레벨')
    await page.getByRole('dialog').getByLabel('검정 값').first().fill('100')
    await page.waitForTimeout(150)
    await dialogOk(page)
    const d = await docInfo(page)
    assert(
      d.layers.some((l) => l.kind === 'adjustment'),
      'adj'
    )
  })
  await t('D7 자동 톤·채도 감소', async () => {
    await page.evaluate(() => {
      const e = window.__sc.editor
      const d = e.doc
      e.quiet({ ...d, activeId: d.layers[0].id })
    })
    await press(page, 'Control+Shift+u')
    const d = await docInfo(page)
    assert(d.undo > 0, 'desat')
  })
  await t('D8 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// E) 이미지 크기·캔버스·자르기·회전
groups.E = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'quad.png')
  await t('E1 이미지 크기 50%', async () => {
    await press(page, 'Control+Alt+i')
    await page.getByRole('dialog').getByLabel('폭').fill('100')
    await dialogOk(page)
    const d = await docInfo(page)
    assert(d.w === 100 && d.h === 50, `${d.w}x${d.h}`)
    await press(page, 'Control+z')
  })
  await t('E2 캔버스 크기 +20 (색 채우기)', async () => {
    await press(page, 'Control+Alt+c')
    await page.getByRole('dialog').getByLabel('캔버스 폭').fill('240')
    await page.getByRole('dialog').getByLabel('캔버스 높이').fill('140')
    await dialogOk(page)
    await page.waitForTimeout(300)
    const d = await docInfo(page)
    assert(d.w === 240 && d.h === 140, `${d.w}x${d.h}`)
    assert(near(await px(page, 2, 2), [255, 255, 255, 255]), `fill ${await px(page, 2, 2)}`)
    assert(near(await px(page, 40, 40), [220, 40, 40, 255]), 'content moved wrong')
    await press(page, 'Control+z')
  })
  await t('E3 자르기 도구 → Enter', async () => {
    await press(page, 'c')
    await drag(page, [
      [10, 10],
      [110, 60]
    ])
    await press(page, 'Enter')
    await page.waitForTimeout(200)
    const d = await docInfo(page)
    assert(Math.abs(d.w - 100) <= 1 && Math.abs(d.h - 50) <= 1, `${d.w}x${d.h}`)
    await press(page, 'Control+z')
  })
  await t('E4 캔버스 90° 회전', async () => {
    await menu(page, '이미지(I)', '캔버스 90° 시계 방향')
    const d = await docInfo(page)
    assert(d.w === 100 && d.h === 200, `${d.w}x${d.h}`)
    await press(page, 'Control+z')
  })
  await t('E5 선택 영역으로 자르기', async () => {
    await press(page, 'm')
    await drag(page, [
      [100, 0],
      [200, 50]
    ])
    await menu(page, '이미지(I)', '선택 영역으로 자르기')
    const d = await docInfo(page)
    assert(d.w === 100 && d.h === 50, `${d.w}x${d.h}`)
    assert(near(await px(page, 10, 10), [40, 60, 220, 255]), 'crop content')
  })
  await t('E6 이동 도구: 레이어 끌기', async () => {
    await press(page, 'Control+z')
    await press(page, 'Control+j')
    await press(page, 'v')
    const x0 = await page.evaluate(() => {
      const d = window.__sc.editor.doc
      return d.layers.find((l) => l.id === d.activeId).transform.x
    })
    await drag(page, [
      [150, 25],
      [120, 25]
    ])
    const x = await page.evaluate(() => {
      const d = window.__sc.editor.doc
      return d.layers.find((l) => l.id === d.activeId).transform.x
    })
    assert(Math.abs(x - (x0 - 30)) <= 1, `x ${x0} → ${x}`)
  })
  await t('E7 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// F) 문자·도형·그라데이션·스포이트·복구·도장·흐림
groups.F = async () => {
  const { app, page, errors } = await launch()
  await newDoc(page, 300, 200)
  await t('F1 문자 도구 → 문자 레이어', async () => {
    await press(page, 't')
    await click(page, 30, 40)
    const ta = page.getByTestId('text-editor')
    await ta.waitFor()
    await ta.fill('안녕 SH')
    await ta.press('Control+Enter')
    await page.waitForTimeout(250)
    const d = await docInfo(page)
    assert(
      d.layers.some((l) => l.kind === 'text'),
      JSON.stringify(d.layers)
    )
  })
  await t('F2 도형(사각형) → 새 레이어', async () => {
    await press(page, 'u')
    const n = (await docInfo(page)).layers.length
    await drag(page, [
      [150, 100],
      [250, 180]
    ])
    const d = await docInfo(page)
    assert(d.layers.length === n + 1, 'shape layer')
    assert(near(await px(page, 200, 140), [0, 0, 0, 255]), `shape px ${await px(page, 200, 140)}`)
  })
  await t('F3 그라데이션 → Enter', async () => {
    await press(page, 'Control+Shift+n')
    await press(page, 'g')
    await drag(page, [
      [0, 100],
      [300, 100]
    ])
    await press(page, 'Enter')
    const l = await px(page, 5, 20)
    const r = await px(page, 295, 20)
    assert(l[0] < 30 && r[0] > 225, `grad ${l} ${r}`)
  })
  await t('F4 스포이트 → 전경색', async () => {
    await press(page, 'i')
    await click(page, 290, 20)
    const fg = await page.evaluate(() => window.__sc.editor.state.fg)
    assert(fg[0] > 225, `fg ${fg}`)
  })
  await t('F5 흐림 도구 획', async () => {
    await press(page, 'r')
    const n = (await docInfo(page)).undo
    await drag(page, [
      [100, 50],
      [200, 60]
    ])
    assert((await docInfo(page)).undo === n + 1, 'blur stroke')
  })
  await t('F6 복제 도장 Alt+클릭 → 획', async () => {
    await press(page, 's')
    await click(page, 20, 20, ['Alt'])
    const n = (await docInfo(page)).undo
    await drag(page, [
      [250, 150],
      [260, 160]
    ])
    assert((await docInfo(page)).undo === n + 1, 'clone stroke')
  })
  await t('F7 스팟 복구 획', async () => {
    await press(page, 'j')
    const n = (await docInfo(page)).undo
    await drag(page, [
      [150, 30],
      [160, 35]
    ])
    await page.waitForTimeout(400)
    assert((await docInfo(page)).undo === n + 1, 'heal stroke')
  })
  await t('F8 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// G) 저장·다시 열기·내보내기·내용 인식 채우기
groups.G = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'stripes.png')
  await t('G1 .shcomp 저장 → 다시 열기 (레이어·픽셀 보존)', async () => {
    await press(page, 'Control+Shift+n')
    await page.evaluate(() => window.__sc.editor.set({ fg: [10, 200, 10] }))
    await press(page, 'm')
    await drag(page, [
      [5, 5],
      [20, 20]
    ])
    await press(page, 'Alt+Backspace')
    await press(page, 'Control+d')
    await press(page, 'Control+s')
    await page.waitForTimeout(500)
    const file = path.join(OUT, 'stripes.shcomp')
    assert(fs.existsSync(file), 'not saved ' + fs.readdirSync(OUT))
    await queueOpen(app, file)
    await press(page, 'Control+o')
    await page.waitForFunction(() => window.__sc.editor.state.tabs.length === 2)
    const d = await docInfo(page)
    assert(d.layers.length === 2 && d.w === 60, JSON.stringify(d))
    assert(near(await px(page, 10, 10), [10, 200, 10, 255]), 'pixel lost')
  })
  await t('G2 PNG 내보내기', async () => {
    await menu(page, '파일(F)', 'PNG로 내보내기…')
    await page.waitForTimeout(500)
    const f = path.join(OUT, 'stripes.png')
    assert(fs.existsSync(f) && fs.readFileSync(f).readUInt32BE(16) === 60, 'png')
  })
  await t('G3 JPEG 내보내기 (미리보기 → 저장)', async () => {
    await menu(page, '파일(F)', 'JPEG로 내보내기…')
    const btn = page.getByRole('dialog').getByRole('button', { name: '저장…' })
    await page.waitForFunction(() => !document.querySelector('[role=dialog] button:disabled'), null, { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    await btn.click()
    await page.waitForTimeout(600)
    const f = path.join(OUT, 'stripes.jpg')
    assert(fs.existsSync(f) && fs.readFileSync(f)[0] === 0xff, 'jpg')
  })
  await t('G4 내용 인식 채우기 (Shift+F5)', async () => {
    await page.evaluate(() => {
      const e = window.__sc.editor
      const d = e.doc
      e.quiet({ ...d, activeId: d.layers[0].id })
    })
    await press(page, 'm')
    await drag(page, [
      [24, 10],
      [36, 30]
    ])
    await press(page, 'Delete')
    await press(page, 'Shift+F5')
    await page.waitForTimeout(800)
    const p = await px(page, 30, 20)
    assert(p[3] === 255, `not filled ${p}`)
  })
  await t('G5 탭 닫기 → 저장 확인 → 저장 안 함', async () => {
    const n = await page.evaluate(() => window.__sc.editor.state.tabs.length)
    await press(page, 'Control+w')
    await page.getByRole('button', { name: '저장 안 함' }).click()
    await page.waitForTimeout(200)
    assert((await page.evaluate(() => window.__sc.editor.state.tabs.length)) === n - 1, 'close')
  })
  await t('G6 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// H) AI 배경 제거 (실모델 — 수십 초)
groups.H = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'subject.png')
  await t('H1 배경 제거 → 마스크 (배경 가림·피사체 유지)', async () => {
    await menu(page, '필터(T)', '배경 제거 (AI)…')
    await page.getByRole('dialog').getByRole('button', { name: '배경 제거' }).click()
    await page.waitForFunction(() => window.__sc.editor.doc.layers[0].mask || window.__sc.editor.state.toast?.kind === 'err', null, { timeout: 180000 })
    const toast = await page.evaluate(() => window.__sc.editor.state.toast)
    assert(toast?.kind !== 'err', `error toast: ${toast?.text} | ${errors.join(' / ')}`)
    const bg = await px(page, 5, 5)
    const fg = await px(page, 100, 75)
    assert(bg[3] < 40 && fg[3] > 200, `bg ${bg} fg ${fg}`)
  })
  await t('H2 콘솔 오류 없음', async () => assert(errors.filter((e) => !/onnx|ort|wasm/i.test(e)).length === 0, errors.join('\n')))
  await closeApp(app)
}

// I) 2026-09-21 피드백·보완 (보기 가운데·썸네일·그룹 마스크·페더·.comp·WebP·최근 파일·복구·온라인 배경 제거)
groups.I = async () => {
  const { app, page, errors, userData } = await launch()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 750))
  await page.waitForTimeout(400)
  await openFile(app, page, 'subject.png')
  const centered = () =>
    page.evaluate(() => {
      const v = window.__sc.editor.tab.view
      const d = window.__sc.editor.doc
      const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect()
      return { dx: Math.abs(v.panX + (d.width * v.zoom) / 2 - r.width / 2), dy: Math.abs(v.panY + (d.height * v.zoom) / 2 - r.height / 2), fit: v.fit }
    })
  await t('I1 창을 최대화해도 처음 연 문서는 상하좌우 가운데', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
    await page.waitForTimeout(700)
    const c = await centered()
    assert(c.dx <= 1 && c.dy <= 1 && c.fit, JSON.stringify(c))
  })
  await t('I2 팬 후 창 크기를 바꾸면 화면 중심 유지', async () => {
    await press(page, 'h')
    await drag(page, [
      [100, 75],
      [140, 75]
    ])
    const before = await page.evaluate(() => window.__sc.editor.tab.view)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize())
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700))
    await page.waitForTimeout(700)
    const after = await page.evaluate(() => window.__sc.editor.tab.view)
    assert(!after.fit && after.zoom === before.zoom, JSON.stringify({ before, after }))
    await press(page, 'Control+0')
    const c = await centered()
    assert(c.dx <= 1 && c.dy <= 1 && c.fit, 'Ctrl+0 ' + JSON.stringify(c))
  })
  await t('I3 레이어 썸네일이 행 안에 들어감', async () => {
    await openFile(app, page, 'tall.png')
    const row = await page.locator('[role="option"][data-layer]').first().boundingBox()
    const img = await page.locator('[role="option"][data-layer] img').first().boundingBox()
    assert(img.y >= row.y - 0.5 && img.y + img.height <= row.y + row.height + 0.5, JSON.stringify({ row, img }))
  })
  await t('I4 그룹 마스크 추가 → 가리기', async () => {
    await press(page, 'Control+g')
    let d = await docInfo(page)
    assert(
      d.layers.some((l) => l.kind === 'group'),
      'group'
    )
    await press(page, 'q')
    d = await docInfo(page)
    assert(d.layers.find((l) => l.kind === 'group').mask, 'group mask')
    await page.evaluate(() => window.__sc.editor.set({ fg: [0, 0, 0] }))
    await press(page, 'Alt+Backspace')
    assert((await px(page, 5, 5))[3] === 0, `group masked ${await px(page, 5, 5)}`)
    const gpu = await screenPx(page, 5, 5)
    assert(gpu[3] === 255, 'screen')
  })
  await t('I5 마스크 반전·페더', async () => {
    await menu(page, '레이어(L)', '마스크 반전')
    assert((await px(page, 5, 5))[3] === 255, 'invert')
    await press(page, 'm')
    await drag(page, [
      [0, 0],
      [20, 40]
    ])
    await press(page, 'Delete')
    await press(page, 'Control+d')
    await menu(page, '레이어(L)', '마스크 페더…')
    await page.getByRole('dialog').getByLabel('픽셀').fill('6')
    await dialogOk(page)
    const edge = await px(page, 20, 20)
    assert(edge[3] > 10 && edge[3] < 245, `feather edge ${edge}`)
  })
  await t('I6 Compositor .comp 폴더 열기', async () => {
    const tabName = await page.evaluate(() => window.__sc.editor.tab.name)
    await press(page, 'Control+s')
    await page.waitForTimeout(500)
    const shc = fs.readdirSync(OUT).find((f) => f === `${tabName}.shcomp`)
    assert(shc, 'no shcomp')
    const { unzipSync } = require_('fflate')
    const files = unzipSync(new Uint8Array(fs.readFileSync(path.join(OUT, shc))))
    const dir = path.join(WORK, 'sample.comp')
    for (const [k, v] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true })
      fs.writeFileSync(path.join(dir, k), v)
    }
    await queueOpen(app, dir)
    const n = await page.evaluate(() => window.__sc.editor.state.tabs.length)
    await menu(page, '파일(F)', 'Compositor 프로젝트(.comp) 폴더 열기…')
    await page.waitForFunction((n) => window.__sc.editor.state.tabs.length === n + 1, n)
    const d = await docInfo(page)
    assert(
      d.layers.some((l) => l.kind === 'group' && l.mask),
      JSON.stringify(d.layers)
    )
  })
  await t('I7 WebP 내보내기 (투명 유지)', async () => {
    await menu(page, '파일(F)', 'WebP로 내보내기…')
    await page.waitForTimeout(800)
    await page.getByRole('dialog').getByRole('button', { name: '저장…' }).click()
    await page.waitForTimeout(800)
    const f = fs.readdirSync(OUT).find((x) => x.endsWith('.webp'))
    assert(f && fs.readFileSync(path.join(OUT, f)).subarray(8, 12).toString() === 'WEBP', 'webp ' + fs.readdirSync(OUT))
  })
  await t('I8 최근 파일 메뉴', async () => {
    await page.getByRole('menubar').getByRole('menuitem', { name: '파일(F)', exact: true }).click()
    const items = await page.getByRole('menuitem', { name: /^\d\. / }).count()
    await page.keyboard.press('Escape')
    assert(items >= 2, `recent ${items}`)
  })
  await t('I9 배경 제거: 오프라인이면 최신 모델 막고 안내', async () => {
    await openFile(app, page, 'subject.png')
    await page.evaluate(() => {
      window.__realFetch = window.fetch
      window.fetch = (u, o) => (String(u).startsWith('https://') ? Promise.reject(new Error('offline')) : window.__realFetch(u, o))
    })
    await menu(page, '필터(T)', '배경 제거 (AI)…')
    await page.getByRole('dialog').getByText('최신 (온라인)').click()
    await page
      .getByRole('dialog')
      .getByText(/오프라인 — 최신 모델을 쓸 수 없습니다/)
      .waitFor({ timeout: 8000 })
    await page.getByRole('dialog').getByRole('button', { name: '배경 제거' }).click()
    await page
      .getByRole('dialog')
      .getByText(/인터넷에 연결되어 있지 않아/)
      .waitFor({ timeout: 5000 })
    await page.getByRole('dialog').getByRole('button', { name: '취소' }).click()
    await page.evaluate(() => (window.fetch = window.__realFetch))
  })
  await t('I10 배경 제거: 최신(온라인) 모델 실추론', async () => {
    await menu(page, '필터(T)', '배경 제거 (AI)…')
    await page.getByRole('dialog').getByText('최신 (온라인)').click()
    await page
      .getByRole('dialog')
      .getByText(/● 온라인/)
      .waitFor({ timeout: 10000 })
    await page.getByRole('dialog').getByRole('button', { name: '배경 제거' }).click()
    await page.waitForFunction(() => window.__sc.editor.doc.layers[0].mask || window.__sc.editor.state.toast?.kind === 'err', null, { timeout: 240000 })
    const toast = await page.evaluate(() => window.__sc.editor.state.toast)
    assert(toast?.kind !== 'err', `error: ${toast?.text}`)
    const bg = await px(page, 5, 5)
    const fg = await px(page, 100, 75)
    assert(bg[3] < 40 && fg[3] > 200, `bg ${bg} fg ${fg}`)
  })
  await t('I11 콘솔 오류 없음', async () => assert(errors.filter((e) => !/onnx|ort|wasm|offline/i.test(e)).length === 0, errors.join('\n')))
  // I12: 비정상 종료 → 다음 실행에서 복구
  await t('I12 자동 저장 → 강제 종료 → 복구', async () => {
    await press(page, 'Control+Shift+n')
    await page.evaluate(() => window.__sc.autosaveNow())
    await page.waitForTimeout(300)
    app.process().kill('SIGKILL')
    await new Promise((r) => setTimeout(r, 800))
    const again = await launch(userData)
    try {
      await again.page.getByRole('dialog').getByText('문서 복구').waitFor({ timeout: 8000 })
      await again.page.getByRole('dialog').getByRole('button', { name: '복구', exact: true }).click()
      await again.page.waitForFunction(() => window.__sc.editor.state.tabs.length > 0, null, { timeout: 8000 })
      const name = await again.page.evaluate(() => window.__sc.editor.tab.name)
      assert(/복구됨/.test(name), name)
    } finally {
      await closeApp(again.app)
    }
  })
  await closeApp(app).catch(() => {})
}

const order = ONLY.length ? ONLY : Object.keys(groups)
for (const g of order) {
  console.log(`[${g}]`)
  await groups[g]()
}
const fail = results.filter((r) => !r.ok)
console.log(`\n${results.length - fail.length}/${results.length} passed`)
fs.rmSync(WORK, { recursive: true, force: true })
process.exit(fail.length ? 1 : 0)
