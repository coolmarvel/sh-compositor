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
async function menu(page, top, item, sub) {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click()
  if (sub) {
    await page.getByRole('menuitem', { name: sub }).first().hover()
    await page.waitForTimeout(150)
  }
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

/** 화면(GPU) = CPU 합성 — 문서 전체에 흩어진 격자 지점에서 (투명은 체커라 불투명 지점만 비교) */
async function gpuMatchesCpu(page, tol = 8) {
  // 도구 오버레이(핸들·테두리·개미 행진)는 비교에서 뺀다
  await page.evaluate(() => (document.querySelectorAll('[data-testid="canvas"] canvas')[1].style.visibility = 'hidden'))
  try {
    await gpuMatchesCpuInner(page, tol)
  } finally {
    await page.evaluate(() => (document.querySelectorAll('[data-testid="canvas"] canvas')[1].style.visibility = ''))
  }
}
async function gpuMatchesCpuInner(page, tol) {
  await page.waitForTimeout(250)
  const d = await docInfo(page)
  const bad = []
  for (const fy of [0.15, 0.5, 0.85])
    for (const fx of [0.15, 0.5, 0.85]) {
      const x = Math.floor(d.w * fx)
      const y = Math.floor(d.h * fy)
      const c = await px(page, x, y)
      if (c[3] < 255) continue
      const g = await screenPx(page, x, y)
      if (!near(c.slice(0, 3), g.slice(0, 3), tol)) bad.push(`(${x},${y}) cpu ${c} gpu ${g}`)
    }
  assert(bad.length === 0, bad.join(' | '))
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
  await t('C2b 방향키로 레이어 이동 뒤 화면 = CPU (영역 합성)', async () => {
    await press(page, 'v')
    await page.locator('[data-testid="canvas"]').focus()
    const before = (await docInfo(page)).undo
    for (let i = 0; i < 5; i++) await press(page, 'Shift+ArrowRight')
    await gpuMatchesCpu(page)
    const n = (await docInfo(page)).undo - before
    for (let i = 0; i < n; i++) await press(page, 'Control+z')
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
  await t('C10b 혼합 모드 16종 화면 = CPU', async () => {
    for (const mode of ['screen', 'overlay', 'difference', 'color', 'luminosity', 'softLight']) {
      await page.evaluate((m) => {
        const e = window.__sc.editor
        const d = e.doc
        const top = d.layers.filter((l) => l.kind === 'pixel').pop()
        e.commit({ ...d, layers: d.layers.map((l) => (l.id === top.id ? { ...l, blend: m, opacity: 0.8 } : l)) }, 'test')
      }, mode)
      await gpuMatchesCpu(page, 10)
    }
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
    await menu(page, '레이어(L)', '효과 설정…', '레이어 효과')
    await page.getByRole('dialog').getByText('사용').first().click()
    await page.waitForTimeout(150)
    await dialogOk(page)
    const d = await docInfo(page)
    assert(d.layers[d.layers.length - 1].fx, 'no fx')
  })
  await t('D6 조정 레이어(레벨) 설정 편집', async () => {
    await menu(page, '레이어(L)', '레벨…', '새 조정 레이어')
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
  await t('E6b 이동 후 화면 = CPU', async () => gpuMatchesCpu(page))
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
  await t('F1b 문자 입력 직후 이동 도구로 바로 끌기', async () => {
    await press(page, 't')
    await click(page, 150, 120)
    const ta = page.getByTestId('text-editor')
    await ta.waitFor()
    await ta.fill('바로 이동')
    // 레일의 이동 도구 버튼을 누른다 (문자 편집은 blur 로 확정)
    await page.locator('[data-tool="move"]').click()
    await page.waitForTimeout(250)
    const d0 = await docInfo(page)
    const tl = d0.layers.find((l) => l.kind === 'text' && l.name.startsWith('바로'))
    assert(tl && d0.active === tl.id, 'text layer not active ' + JSON.stringify(d0.layers.map((l) => l.name)) + ' active ' + d0.active)
    const x0 = await page.evaluate((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).transform.x, tl.id)
    await drag(page, [
      [160, 130],
      [190, 130]
    ])
    const x1 = await page.evaluate((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).transform.x, tl.id)
    assert(Math.abs(x1 - x0 - 30) <= 2, `moved ${x0} → ${x1}`)
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
  for (const mode of ['blur', 'smudge', 'liquify'])
    await t(`F5-${mode} WASM 픽셀 변경·실행취소·다시실행`, async () => {
      assert(await page.evaluate(() => window.__sc.retouchReady), 'WASM not loaded in built Electron')
      await page.evaluate(() => {
        const e = window.__sc.editor,
          d = e.doc
        const layer = d.layers.find((l) => l.id === d.activeId)
        const data = layer.bitmap.data.slice()
        let seed = 7919
        for (let i = 0; i < data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
          data[i] = seed >>> 24
          data[i + 1] = seed >>> 16
          data[i + 2] = seed >>> 8
          data[i + 3] = 255
        }
        e.commit({ ...d, layers: d.layers.map((l) => (l === layer ? { ...l, bitmap: { ...l.bitmap, data } } : l)) }, '리터칭 테스트 무늬')
      })
      await page.evaluate((mode) => window.__sc.editor.setSettings({ blurMode: mode, blurStrength: 90 }), mode)
      await press(page, 'r')
      const pixels = () =>
        page.evaluate(() => {
          const e = window.__sc.editor
          return Array.from(e.doc.layers.find((l) => l.id === e.doc.activeId).bitmap.data)
        })
      const before = await pixels()
      await drag(page, [
        [100, 80],
        [130, 95],
        [160, 85]
      ])
      const after = await pixels()
      assert(
        after.some((v, i) => v !== before[i]),
        `${mode} unchanged`
      )
      await press(page, 'Control+z')
      assert(JSON.stringify(await pixels()) === JSON.stringify(before), `${mode} undo differs`)
      await press(page, 'Control+Shift+z')
      assert(JSON.stringify(await pixels()) === JSON.stringify(after), `${mode} redo differs`)
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
  await t('F7b 칠·도형·그라데이션 후 화면 = CPU', async () => gpuMatchesCpu(page))
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
    await menu(page, '파일(F)', 'PNG…', '내보내기')
    await page.waitForTimeout(500)
    const f = path.join(OUT, 'stripes.png')
    assert(fs.existsSync(f) && fs.readFileSync(f).readUInt32BE(16) === 60, 'png')
  })
  await t('G3 JPEG 내보내기 (미리보기 → 저장)', async () => {
    await menu(page, '파일(F)', 'JPEG…', '내보내기')
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
    // 추론 중에도 화면 스레드가 멈추지 않는지(진행 막대가 움직이는지) 재기 위해 긴 작업·진행 문구를 기록
    await page.evaluate(() => {
      window.__lt = []
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask' })
      window.__labels = new Set()
      window.__sc.editor.subscribe(() => {
        const p = window.__sc.editor.state.progress
        if (p) window.__labels.add(p.label + (p.value !== undefined ? ' %' : ''))
      })
    })
    await menu(page, '필터(T)', '배경 제거 (AI)…')
    await page.getByRole('dialog').getByRole('button', { name: '배경 제거' }).click()
    await page.waitForFunction(() => window.__sc.editor.doc.layers[0].mask || window.__sc.editor.state.toast?.kind === 'err', null, { timeout: 180000 })
    const toast = await page.evaluate(() => window.__sc.editor.state.toast)
    assert(toast?.kind !== 'err', `error toast: ${toast?.text} | ${errors.join(' / ')}`)
    const bg = await px(page, 5, 5)
    const fg = await px(page, 100, 75)
    assert(bg[3] < 40 && fg[3] > 200, `bg ${bg} fg ${fg}`)
  })
  await t('H1c 분석 중에도 화면이 멈추지 않음 (일꾼 스레드) + 두 단계 진행 표시', async () => {
    const r = await page.evaluate(() => ({ worst: Math.max(0, ...window.__lt), labels: [...window.__labels] }))
    assert(r.worst < 800, `화면 스레드가 ${Math.round(r.worst)}ms 멈춤`)
    assert(r.labels.some((l) => l.startsWith('1/2') && l.endsWith('%')) && r.labels.some((l) => l.startsWith('2/2')), JSON.stringify(r.labels))
  })
  await t('H1b 배경 제거 결과가 화면(GPU)에도 반영', async () => {
    await page.waitForTimeout(500)
    const lost = await page.evaluate(() => document.querySelector('[data-testid="canvas"] canvas').getContext('webgl2')?.isContextLost())
    const gbg = await screenPx(page, 5, 5)
    const gfg = await screenPx(page, 100, 75)
    // 투명 = 어두운 체커(밝기 < 80), 피사체 = 빨강
    assert(!lost && gbg[0] < 80 && gfg[0] > 150, `lost ${lost} screen bg ${gbg} fg ${gfg}`)
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
  await t('I3b 캔버스를 눌러도 화면이 밀려 올라가지 않음 (작은 창)', async () => {
    const top0 = await page.evaluate(() => document.querySelector('[data-testid="canvas"]').getBoundingClientRect().top)
    await click(page, 10, 10)
    const top1 = await page.evaluate(() => document.querySelector('[data-testid="canvas"]').getBoundingClientRect().top)
    const scrolled = await page.evaluate(() => [document.scrollingElement.scrollTop, document.getElementById('root').scrollTop, document.getElementById('root').firstElementChild.scrollTop])
    assert(top0 === top1 && scrolled.every((v) => v === 0), `canvas top ${top0} → ${top1}, scroll ${scrolled}`)
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
  await t('I4b 그룹 마스크 화면 = CPU', async () => gpuMatchesCpu(page))
  await t('I5 마스크 반전·페더', async () => {
    await menu(page, '레이어(L)', '마스크 반전', '레이어 마스크')
    assert((await px(page, 5, 5))[3] === 255, 'invert')
    await press(page, 'm')
    await drag(page, [
      [0, 0],
      [20, 40]
    ])
    await press(page, 'Delete')
    await press(page, 'Control+d')
    await menu(page, '레이어(L)', '마스크 페더…', '레이어 마스크')
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
    await menu(page, '파일(F)', 'WebP…', '내보내기')
    await page.waitForTimeout(800)
    await page.getByRole('dialog').getByRole('button', { name: '저장…' }).click()
    await page.waitForTimeout(800)
    const f = fs.readdirSync(OUT).find((x) => x.endsWith('.webp'))
    assert(f && fs.readFileSync(path.join(OUT, f)).subarray(8, 12).toString() === 'WEBP', 'webp ' + fs.readdirSync(OUT))
  })
  await t('I8 최근 파일 메뉴', async () => {
    await page.getByRole('menubar').getByRole('menuitem', { name: '파일(F)', exact: true }).click()
    await page.getByRole('menuitem', { name: '최근 파일' }).hover()
    await page.waitForTimeout(200)
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
      .getByText(/인터넷에 연결되어 있지 않습니다/)
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
      .getByText(/● 인터넷에 연결되어 있어/)
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

// J) v1.0 추가 기능 — PSD·안내선·잠금·선 그리기·도형 다시 고치기·스냅샷·세로쓰기·환경 설정·내보내기·임시 이동·미리보기 묶기
groups.J = async () => {
  const { app, page, errors } = await launch()
  // PSD 픽스처 (ag-psd 로 만든 레이어 3장 + 폴더)
  const { writePsdUint8Array, readPsd } = require_('ag-psd')
  const solid = (w, h, c) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => c[i % 4]) })
  const psdFile = path.join(FIX, 'layers.psd')
  fs.writeFileSync(
    psdFile,
    writePsdUint8Array({
      width: 120,
      height: 80,
      children: [
        { name: '바탕', left: 0, top: 0, right: 120, bottom: 80, imageData: solid(120, 80, [255, 255, 255, 255]) },
        { name: '폴더', opened: true, children: [{ name: '빨강', left: 10, top: 10, right: 50, bottom: 40, blendMode: 'multiply', imageData: solid(40, 30, [220, 30, 30, 255]) }] },
        { name: '파랑', left: 60, top: 20, right: 100, bottom: 60, opacity: 0.5, imageData: solid(40, 40, [30, 60, 220, 255]) }
      ]
    })
  )
  await t('J1 PSD 열기 (레이어·폴더·혼합·불투명도)', async () => {
    await openFile(app, page, 'layers.psd')
    const d = await docInfo(page)
    assert(d.w === 120 && d.h === 80, `${d.w}x${d.h}`)
    const names = d.layers.map((l) => l.name)
    assert(
      ['바탕', '폴더', '빨강', '파랑'].every((n) => names.includes(n)),
      names.join(',')
    )
    assert(d.layers.find((l) => l.name === '빨강').blend === 'multiply', 'blend')
    assert(near(await px(page, 20, 20), [220, 30, 30, 255], 2), `px ${await px(page, 20, 20)}`)
    await gpuMatchesCpu(page)
  })
  await t('J2 Ctrl+S 는 PSD 로 다시 저장 (Photoshop 과 주고받기)', async () => {
    await page.evaluate(() => window.__sc.editor.set({ fg: [0, 200, 0] }))
    await press(page, 'Control+Shift+n')
    await press(page, 'Alt+Backspace')
    await queueOpen(app) // 저장은 대화상자 없이 같은 경로
    await press(page, 'Control+s')
    await page.waitForTimeout(800)
    const saved = path.join(OUT, 'layers.psd')
    const target = fs.existsSync(saved) ? saved : psdFile
    const r = readPsd(fs.readFileSync(target), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true })
    const count = (ls) => (ls ?? []).reduce((n, l) => n + 1 + count(l.children), 0)
    assert(count(r.children) >= 5, `layers ${count(r.children)} in ${target}`)
  })
  await t('J3 눈금자에서 끌어 안내선 → 사각 선택이 붙음', async () => {
    const ruler = await page.getByTestId('ruler-left').boundingBox()
    const at = await toScreen(page, 30, 40)
    await page.mouse.move(ruler.x + 8, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x, at.y, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const g = await page.evaluate(() => window.__sc.editor.doc.guides)
    assert(g && g.v.length === 1 && Math.abs(g.v[0] - 30) <= 1, JSON.stringify(g))
    await press(page, 'm')
    const z = await page.evaluate(() => window.__sc.editor.tab.view.zoom)
    await drag(page, [
      [5, 5],
      [30 + 3 / z, 25]
    ])
    const sel = (await docInfo(page)).sel
    assert(sel && sel.x + sel.w === Math.round(g.v[0]), `snap ${JSON.stringify(sel)} guide ${g.v[0]}`)
    await press(page, 'Control+d')
  })
  await t('J4 안내선을 눈금자로 끌어 내면 지워짐 (이동 도구)', async () => {
    await press(page, 'v')
    const at = await toScreen(page, 30, 60)
    const ruler = await page.getByTestId('ruler-left').boundingBox()
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(ruler.x + 8, at.y, { steps: 6 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const g = await page.evaluate(() => window.__sc.editor.doc.guides)
    assert(g.v.length === 0, JSON.stringify(g))
  })
  await t('J5 위치 잠금 → 이동 안 됨, 픽셀 잠금 → 칠하기 안 됨', async () => {
    await page.getByRole('button', { name: '위치 잠그기 (이동·변형 금지)' }).click()
    const x0 = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.id === window.__sc.editor.doc.activeId).transform.x)
    await drag(page, [
      [60, 40],
      [80, 40]
    ])
    const x1 = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.id === window.__sc.editor.doc.activeId).transform.x)
    assert(x0 === x1, `moved ${x0} → ${x1}`)
    await page.getByRole('button', { name: '픽셀 잠그기 (칠하기·지우기 금지)' }).click()
    const before = await px(page, 60, 40)
    await press(page, 'Alt+Backspace')
    assert(near(await px(page, 60, 40), before, 0), 'filled despite lock')
    const d = await docInfo(page)
    assert(
      d.layers.find((l) => l.id === d.active),
      'active'
    )
    await page.getByRole('button', { name: '모두 잠그기' }).click()
    await page.getByRole('button', { name: '모두 잠그기' }).click() // 모두 풀기
  })
  await t('J6 선 그리기 (선택 테두리 바깥 3px)', async () => {
    await press(page, 'm')
    await drag(page, [
      [40, 30],
      [80, 60]
    ])
    await page.evaluate(() => window.__sc.editor.set({ fg: [255, 0, 255] }))
    await menu(page, '편집(E)', '선 그리기…')
    await page.getByRole('dialog').getByText('바깥쪽', { exact: true }).click()
    await dialogOk(page)
    assert(near(await px(page, 38, 45), [255, 0, 255, 255], 30), `stroke ${await px(page, 38, 45)}`)
    assert(!near(await px(page, 50, 45), [255, 0, 255, 255], 30), 'inside painted')
    await press(page, 'Control+d')
  })
  await t('J7 도형: 크기 바꾸면 다시 그림 + 옵션으로 채우기 색 고치기', async () => {
    await press(page, 'u')
    await drag(page, [
      [10, 50],
      [30, 70]
    ])
    let d = await docInfo(page)
    const id = d.active
    const sh0 = await page.evaluate((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).shape, id)
    assert(sh0 && Math.abs(sh0.w - 20) <= 1, JSON.stringify(sh0))
    await page.getByLabel('채우기 색').fill('#00ff00')
    await page.waitForTimeout(200)
    const sh1 = await page.evaluate((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).shape, id)
    assert(sh1.fill === '#00ff00', JSON.stringify(sh1))
    assert(near(await px(page, 20, 60), [0, 255, 0, 255], 2), `fill ${await px(page, 20, 60)}`)
    // 이동 도구로 오른쪽 아래 핸들을 끌어 키움 → 도형 크기 데이터가 따라 커짐 (색 입력칸에서 포커스를 빼야 단축키가 먹는다)
    await page.evaluate(() => document.activeElement?.blur())
    await press(page, 'v')
    const t0 = await page.evaluate((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).transform, id)
    await drag(page, [
      [t0.x + t0.width, t0.y + t0.height],
      [t0.x + t0.width + 20, t0.y + t0.height + 20]
    ])
    const sh2 = await page.evaluate((id) => window.__sc.editor.doc.layers.find((l) => l.id === id), id)
    assert(sh2.shape && sh2.shape.w > 30 && sh2.bitmap.width === sh2.transform.width, `reshape ${JSON.stringify(sh2.shape)} bmp ${sh2.bitmap.width} t ${sh2.transform.width}`)
  })
  await t('J8 스냅샷 → 되돌리기', async () => {
    await page.getByRole('tab', { name: '작업 내역' }).click()
    await page.getByRole('button', { name: '스냅샷 만들기' }).click()
    const snapDocLayers = (await docInfo(page)).layers.length
    await press(page, 'Control+Shift+n')
    await press(page, 'Control+Shift+n')
    await page.locator('[aria-label="스냅샷"] [role="option"]').first().click()
    await page.waitForTimeout(200)
    assert((await docInfo(page)).layers.length === snapDocLayers, 'snapshot restore')
  })
  await t('J9 세로쓰기 문자', async () => {
    await press(page, 't')
    await page.getByRole('button', { name: '세로쓰기', exact: true }).click()
    await click(page, 100, 10)
    const ta = page.getByTestId('text-editor')
    await ta.waitFor()
    await ta.fill('세로')
    await ta.press('Control+Enter')
    await page.waitForTimeout(250)
    const d = await docInfo(page)
    const tl = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.kind === 'text'))
    assert(tl?.text?.vertical && tl.bitmap.height > tl.bitmap.width, JSON.stringify({ v: tl?.text?.vertical, w: tl?.bitmap.width, h: tl?.bitmap.height }))
    assert(d.tool === 'move', 'Ctrl+Enter → 이동 도구')
    await page.getByRole('button', { name: '세로쓰기', exact: true }).count() // 옵션 줄이 바뀌었을 수 있음
    await page.evaluate(() => window.__sc.editor.setSettings({ typeVertical: false }))
  })
  await t('J10 Ctrl+끌기 = 임시 이동 (브러시 도구에서)', async () => {
    await press(page, 'b')
    const d = await docInfo(page)
    const x0 = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.id === window.__sc.editor.doc.activeId).transform.x)
    const tl = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.id === window.__sc.editor.doc.activeId).transform)
    await drag(
      page,
      [
        [tl.x + tl.width / 2, tl.y + tl.height / 2],
        [tl.x + tl.width / 2 - 10, tl.y + tl.height / 2]
      ],
      { mods: ['Control'] }
    )
    const x1 = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.id === window.__sc.editor.doc.activeId).transform.x)
    assert(Math.abs(x1 - (x0 - 10)) <= 1 && (await docInfo(page)).tool === 'brush', `x ${x0} → ${x1}`)
    void d
  })
  await t('J11 미리보기가 남아도 새 명령 결과가 화면에 보임 (확정 안 한 그라데이션)', async () => {
    await press(page, 'Control+Shift+n')
    await press(page, 'g')
    await drag(page, [
      [0, 40],
      [120, 40]
    ])
    // Enter 로 확정하지 않은 채 다른 명령 — 화면은 새 문서를 그려야 한다
    await page.evaluate(() => {
      const e = window.__sc.editor
      const d = e.doc
      e.commit({ ...d, layers: d.layers.map((l) => ({ ...l, visible: false })) }, '모두 숨기기')
    })
    await page.waitForTimeout(300)
    const shown = await page.evaluate(() => window.__sc.editor.shownDoc === window.__sc.editor.doc)
    assert(shown, 'stale preview drawn')
    await press(page, 'Escape')
    await press(page, 'Control+z')
  })
  await t('J12 레이어를 각각 PNG 로 내보내기', async () => {
    const dir = path.join(OUT, 'layers')
    fs.mkdirSync(dir, { recursive: true })
    await queueOpen(app, dir)
    await menu(page, '파일(F)', '레이어를 각각 PNG로…', '내보내기')
    await page.waitForTimeout(1200)
    const files = fs.readdirSync(dir)
    assert(files.length >= 3 && files.every((f) => f.endsWith('.png')), files.join(','))
  })
  await t('J13 환경 설정: 실행 취소 단계 저장', async () => {
    await press(page, 'Control+k')
    await page.getByRole('dialog').getByLabel('실행 취소 단계 값').fill('120')
    await dialogOk(page)
    assert((await page.evaluate(() => window.__sc.editor.state.settings.historyLimit)) === 120, 'limit')
  })
  await t('J14 견본: 클릭하면 전경색', async () => {
    await page.getByRole('tab', { name: '견본' }).click()
    await page.getByRole('button', { name: '견본 #ffffff' }).first().click()
    const fg = await page.evaluate(() => window.__sc.editor.state.fg)
    assert(near(fg, [255, 255, 255], 0), `fg ${fg}`)
  })
  await t('J15 내비게이터: 축소본이 그려지고 끌면 화면이 따라감', async () => {
    await page.getByRole('tab', { name: '내비게이터' }).click()
    await page.waitForTimeout(900)
    const nav = await page.getByTestId('navigator').boundingBox()
    const v0 = await page.evaluate(() => window.__sc.editor.tab.view)
    await press(page, 'Control+=')
    await press(page, 'Control+=')
    await page.mouse.click(nav.x + nav.width * 0.8, nav.y + nav.height * 0.8)
    await page.waitForTimeout(200)
    const v1 = await page.evaluate(() => window.__sc.editor.tab.view)
    assert(v1.zoom > v0.zoom && (v1.panX !== v0.panX || v1.panY !== v0.panY), JSON.stringify({ v0, v1 }))
    await page.getByRole('tab', { name: '작업 내역' }).click()
  })
  await t('J16 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// K) 개체 선택 (AI, SlimSAM) — 대충 감싸면 테두리에 맞게
groups.K = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'subject.png') // 초록 바탕 + 가운데 빨간 원 (반지름 40)
  const circleIoU = () =>
    page.evaluate(() => {
      const d = window.__sc.editor.doc
      const m = d.selection?.mask
      if (!m) return 0
      let inter = 0
      let uni = 0
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          const a = (x - 100) ** 2 + (y - 75) ** 2 <= 40 ** 2
          const b = m[y * d.width + x] > 127
          if (a && b) inter++
          if (a || b) uni++
        }
      return inter / uni
    })
  await t('K1 사각형으로 넉넉히 감싸면 원 테두리에 맞게 선택', async () => {
    await page.evaluate(() => {
      window.__lt = []
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask' })
    })
    await page.locator('[data-tool="objectSelect"]').click()
    await drag(page, [
      [45, 20],
      [155, 130]
    ])
    await page.waitForFunction(() => !window.__sc.editor.state.progress && window.__sc.editor.doc.selection, null, { timeout: 120000 })
    const iou = await circleIoU()
    assert(iou > 0.9, `IoU ${iou.toFixed(3)}`)
  })
  await t('K2 분석 중에도 화면이 멈추지 않음', async () => {
    const worst = await page.evaluate(() => Math.max(0, ...window.__lt))
    assert(worst < 800, `${Math.round(worst)}ms 멈춤`)
  })
  await t('K3 테두리 +6px → 선택이 넓어짐, 되돌리면 원래대로', async () => {
    const area = () => page.evaluate(() => window.__sc.editor.doc.selection.mask.reduce((a, v) => a + (v > 127 ? 1 : 0), 0))
    const a0 = await area()
    await page.evaluate(() => window.dispatchEvent(new Event('noop')))
    const btn = page
      .getByRole('toolbar', { name: '도구 옵션' })
      .getByRole('button', { name: /넓히거나/ })
      .first()
    await btn.click()
    const slider = page.getByRole('slider', { name: /넓히거나/ })
    await slider.focus()
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)
    const a1 = await area()
    assert(a1 > a0 * 1.2, `${a0} → ${a1}`)
  })
  await t('K4 클릭 한 번으로도 개체 선택 (두 번째부터 빠름)', async () => {
    await press(page, 'Control+d')
    const t0 = Date.now()
    await click(page, 100, 75)
    await page.waitForFunction(() => !window.__sc.editor.state.progress && window.__sc.editor.doc.selection, null, { timeout: 60000 })
    const ms = Date.now() - t0
    const iou = await circleIoU()
    assert(iou > 0.85, `IoU ${iou.toFixed(3)}`)
    assert(ms < 15000, `${ms}ms`)
  })
  await t('K5 올가미로 감싸기', async () => {
    await press(page, 'Control+d')
    await page.getByRole('button', { name: '올가미로 감싸기' }).click()
    await drag(page, [
      [100, 18],
      [160, 45],
      [160, 110],
      [100, 135],
      [40, 110],
      [40, 45],
      [100, 18]
    ])
    await page.waitForFunction(() => !window.__sc.editor.state.progress && window.__sc.editor.doc.selection, null, { timeout: 60000 })
    const iou = await circleIoU()
    assert(iou > 0.9, `IoU ${iou.toFixed(3)}`)
  })
  await t('K6 W 키: 마법봉 ↔ 개체 선택', async () => {
    await press(page, 'v')
    await press(page, 'w')
    assert((await docInfo(page)).tool === 'wand', 'wand')
    await press(page, 'w')
    assert((await docInfo(page)).tool === 'objectSelect', 'object')
  })
  await t('K7 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// L) P3 — 칠해서 잡기·가장자리 다듬기·추가 조정·추가 필터·정렬/분포·외부 광선·스타일 복사·히스토그램
groups.L = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'subject.png') // 초록 바탕 + 빨간 원
  const iouCircle = () =>
    page.evaluate(() => {
      const d = window.__sc.editor.doc
      const m = d.selection?.mask
      if (!m) return 0
      let i = 0
      let u = 0
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          const a = (x - 100) ** 2 + (y - 75) ** 2 <= 1600
          const b = m[y * d.width + x] > 127
          if (a && b) i++
          if (a || b) u++
        }
      return i / u
    })
  await t('L1 칠해서 잡기: 원 위를 문지르면 원 전체', async () => {
    await page.locator('[data-tool="objectSelect"]').click()
    await page.getByRole('button', { name: '칠해서 잡기' }).click()
    await drag(page, [
      [85, 70],
      [115, 80]
    ])
    await page.waitForFunction(() => !window.__sc.editor.state.progress && window.__sc.editor.doc.selection, null, { timeout: 120000 })
    const iou = await iouCircle()
    assert(iou > 0.85, `IoU ${iou.toFixed(3)}`)
  })
  await t('L2 가장자리 다듬기: 미리보기 후 확인하면 선택이 바뀜', async () => {
    const before = await page.evaluate(() => window.__sc.editor.doc.selection.mask.slice())
    await press(page, 'Control+Alt+r')
    await page.getByRole('dialog').getByLabel('페더 값').fill('6')
    await page.waitForTimeout(500)
    assert(await page.evaluate(() => window.__sc.editor.shownDoc !== window.__sc.editor.doc), 'no preview')
    await dialogOk(page)
    const changed = await page.evaluate((b) => {
      const m = window.__sc.editor.doc.selection.mask
      let n = 0
      for (let i = 0; i < m.length; i++) if (Math.abs(m[i] - b[i]) > 20) n++
      return n
    }, Array.from(before))
    assert(changed > 50, `changed ${changed}`)
    assert(await page.evaluate(() => window.__sc.editor.shownDoc === window.__sc.editor.doc), 'preview left')
    await press(page, 'Control+d')
  })
  await t('L3 흑백 (Ctrl+Shift+Alt+B) → 회색', async () => {
    await press(page, 'Control+Shift+Alt+b')
    await page.getByRole('dialog').waitFor()
    await dialogOk(page)
    const p = await px(page, 100, 75)
    assert(p[0] === p[1] && p[1] === p[2], `${p}`)
    await press(page, 'Control+z')
  })
  await t('L4 포스터화·한계값 (조정 하위 메뉴)', async () => {
    await menu(page, '이미지(I)', '한계값…', '조정')
    await dialogOk(page)
    const p = await px(page, 5, 5)
    assert((p[0] === 0 || p[0] === 255) && p[0] === p[1], `${p}`)
    await press(page, 'Control+z')
  })
  await t('L5 필터: 모자이크 16px', async () => {
    await menu(page, '필터(T)', '모자이크·노이즈 감소…')
    await page.getByRole('dialog').getByLabel('칸 크기 값').fill('16')
    await page.waitForTimeout(300)
    await dialogOk(page)
    await page.waitForTimeout(500)
    const a = await px(page, 64, 64)
    const b = await px(page, 79, 79)
    assert(near(a, b, 0), `${a} vs ${b}`)
    await press(page, 'Control+z')
  })
  await t('L6 정렬·분포: 세 레이어를 왼쪽 맞춤 후 가로 분포', async () => {
    await page.evaluate(() => {
      const e = window.__sc.editor
      let d = e.doc
      const mk = (id, x) => ({
        id,
        name: id,
        kind: 'pixel',
        visible: true,
        opacity: 1,
        blend: 'normal',
        bitmap: { width: 10, height: 10, data: new Uint8ClampedArray(400).fill(255) },
        transform: { x, y: 10, width: 10, height: 10, rotation: 0, flipH: false, flipV: false },
        parentId: null,
        mask: null,
        clip: false,
        effects: null,
        adjustment: null,
        text: null
      })
      d = { ...d, layers: [...d.layers, mk('p1', 20), mk('p2', 50), mk('p3', 170)], activeId: 'p3' }
      e.commit(d, '테스트 레이어')
      e.set({ selectedIds: ['p1', 'p2', 'p3'] })
    })
    await press(page, 'v')
    await page.getByRole('button', { name: '가로로 고르게 분포 (3장 이상)' }).click()
    const xs = await page.evaluate(() => ['p1', 'p2', 'p3'].map((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).transform.x))
    assert(Math.abs(xs[1] - (xs[0] + xs[2]) / 2) <= 1, `distribute ${xs}`)
    await page.getByRole('button', { name: /왼쪽 맞춤/ }).click()
    const xs2 = await page.evaluate(() => ['p1', 'p2', 'p3'].map((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).transform.x))
    assert(
      xs2.every((x) => x === xs2[0]),
      `align ${xs2}`
    )
  })
  await t('L7 외부 광선 + 레이어 효과 복사·붙여넣기', async () => {
    await page.evaluate(() => {
      const e = window.__sc.editor
      e.quiet({ ...e.doc, activeId: 'p1' })
      e.set({ selectedIds: ['p1'] })
    })
    await menu(page, '레이어(L)', '효과 설정…', '레이어 효과')
    await page.getByRole('dialog').getByRole('tab', { name: '외부 광선' }).click()
    await page.getByRole('dialog').getByText('사용').first().click()
    await dialogOk(page)
    const fx = await page.evaluate(() => window.__sc.editor.doc.layers.find((l) => l.id === 'p1').effects?.outerGlow?.enabled)
    assert(fx, 'glow')
    await menu(page, '레이어(L)', '레이어 효과 복사', '레이어 효과')
    await page.evaluate(() => window.__sc.editor.set({ selectedIds: ['p2', 'p3'] }))
    await menu(page, '레이어(L)', '레이어 효과 붙여넣기', '레이어 효과')
    const both = await page.evaluate(() => ['p2', 'p3'].every((id) => window.__sc.editor.doc.layers.find((l) => l.id === id).effects?.outerGlow?.enabled))
    assert(both, 'paste')
    await gpuMatchesCpu(page, 12)
  })
  await t('L8 히스토그램 패널: 통계가 나옴', async () => {
    await page.getByRole('tab', { name: '히스토그램' }).click()
    await page.waitForTimeout(1200)
    const txt = await page.locator('[aria-label="히스토그램"]').innerText()
    assert(/평균\s*\n?\s*\d/.test(txt) && !/평균\s*\n?\s*·/.test(txt), txt)
    await page.getByRole('tab', { name: '작업 내역' }).click()
  })
  await t('L10 사용 설명서 (F1): 탭마다 내용, 가로로 넘치지 않음', async () => {
    await page
      .locator('canvas')
      .first()
      .click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('F1')
    const dlg = page.getByRole('dialog')
    await dlg.waitFor()
    for (const name of ['시작하기', '도구', '선택', '칠하기·고치기', '색 보정·필터', '레이어', '화면·파일', 'MCP']) {
      await dlg.getByRole('tab', { name, exact: true }).click()
      const r = await dlg.getByRole('tabpanel').evaluate((el) => ({ n: el.innerText.length, over: el.scrollWidth - el.clientWidth }))
      assert(r.n > 80 && r.over <= 0, `${name} ${JSON.stringify(r)}`)
    }
    await page.keyboard.press('Escape')
    await dlg.waitFor({ state: 'detached' })
  })
  await t('L9 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
}

// N) v1.1 명령 계층 · 요청 당시 탭에 커밋 · 이력 메모리 예산
groups.N = async () => {
  const { app, page, errors } = await launch()
  await openFile(app, page, 'quad.png')
  await t('N1 이미지 크기 (application 명령) → 한 단계·같은 결과', async () => {
    const n = (await docInfo(page)).undo
    await press(page, 'Control+Alt+i')
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('폭', { exact: true }).fill('100')
    await dialogOk(page)
    const d = await docInfo(page)
    assert(d.w === 100 && d.h === 50 && d.undo === n + 1, JSON.stringify(d))
    assert((await page.evaluate(() => window.__sc.editor.tab.history.label)) === '이미지 크기', 'label')
    await press(page, 'Control+z')
    assert((await docInfo(page)).w === 200, 'undo')
  })
  await t('N2 오래 걸린 결과는 시작한 탭에만 들어가고, 그사이 바뀐 문서는 덮지 않는다', async () => {
    const r = await page.evaluate(() => {
      const { editor, bridge } = window.__sc
      const at = bridge.capture()
      const next = { ...at.doc, resolution: 300 }
      editor.addTab({ ...at.doc, id: 'other', resolution: 72 }, '다른 탭')
      const landed = bridge.land(at, next, '배경 제거')
      const a = editor.state.tabs.find((t) => t.id === at.tabId)
      const out = { landed, aRes: a.history.present.resolution, activeRes: editor.doc.resolution, active: editor.tab.name }
      // 같은 캡처로 한 번 더 = 문서가 이미 바뀜 → 버림
      out.stale = bridge.land(at, { ...at.doc, resolution: 150 }, '늦은 결과')
      out.aRes2 = editor.state.tabs.find((t) => t.id === at.tabId).history.present.resolution
      editor.closeTab(editor.tab.id)
      return out
    })
    assert(r.landed && r.aRes === 300 && r.activeRes === 72 && r.active === '다른 탭', JSON.stringify(r))
    assert(!r.stale && r.aRes2 === 300, JSON.stringify(r))
    await page.getByText('결과를 적용하지 않았습니다').first().waitFor({ timeout: 3000 })
  })
  await t('N3 실행 취소 메모리 예산: 큰 편집이 쌓이면 오래된 단계부터 지우고 패널에 MB 표시', async () => {
    await newDoc(page, 2000, 2000)
    await page.evaluate(() => window.__sc.editor.setSettings({ historyBudgetMB: 40 }))
    for (let i = 0; i < 5; i++) {
      await press(page, 'x')
      await press(page, 'Alt+Backspace')
    }
    const r = await page.evaluate(() => {
      const h = window.__sc.editor.tab.history
      return { past: h.past.length }
    })
    assert(r.past >= 1 && r.past <= 2, JSON.stringify(r))
    await page
      .getByText(/약 \d+MB/)
      .first()
      .waitFor({ timeout: 3000 })
    await page.evaluate(() => window.__sc.editor.setSettings({ historyBudgetMB: 1024 }))
  })
  await t('N4 환경 설정: 실행 취소 메모리 슬라이더', async () => {
    await press(page, 'Control+k')
    const dlg = page.getByRole('dialog')
    await dlg.getByText('실행 취소 메모리', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await dlg.waitFor({ state: 'detached' })
  })
  await t('N5 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
  await closeApp(app)
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
