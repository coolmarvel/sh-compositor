/**
 * 웹 로컬 편집기 E2E (plans/0004 3단계) — Electron 없이 `npm run build:web` 결과(out/web)를 Chromium 에서.
 *
 * 실행: npm run build:web && npm run e2e:web   (헤드리스 — 화면에 창이 뜨지 않는다)
 * 필요: `npm i --no-save playwright` + Chromium (`npx playwright install chromium`, 이미 받은 캐시가 있으면 그것).
 * 흐름: 생성 → 열기 → 레이어 편집 → 리터칭(WASM) → 실행취소 → 저장(다운로드·File System Access) → 다시 열기 → 자동 저장·복구
 *       + WASM 로딩 실패 시 TS 폴백 + 저장 공간 초과 안내 + 페이지 떠나기 확인.
 */
import { createRequire } from 'module'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'

const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-web-e2e-'))
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const { chromium } = require_('playwright')
const PORT = 5191
const URL_ = `http://127.0.0.1:${PORT}/?e2e=1`

// ── 픽스처 PNG ──
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
const QUAD = path.join(WORK, 'quad.png')
fs.writeFileSync(
  QUAD,
  png(200, 100, (x, y) => (x < 100 ? (y < 50 ? [220, 40, 40, 255] : [40, 180, 60, 255]) : y < 50 ? [40, 60, 220, 255] : [240, 240, 240, 255]))
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

/** 정적 서버 (vite preview) */
async function startServer() {
  const proc = spawn(process.execPath, [path.join(PROJECT, 'node_modules/vite/bin/vite.js'), 'preview', '-c', 'vite.web.config.ts', '--host', '127.0.0.1'], { cwd: PROJECT, stdio: 'pipe' })
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`)
      if (r.ok) return proc
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  proc.kill('SIGKILL')
  throw new Error('vite preview 가 뜨지 않았습니다 (npm run build:web 먼저)')
}

/** 저장 대화상자가 없는 브라우저처럼 (다운로드·<input> 폴백) */
const NO_PICKERS = () => {
  delete window.showOpenFilePicker
  delete window.showSaveFilePicker
  delete window.showDirectoryPicker
}
/** File System Access 흉내 — 저장 대화상자를 한 번만 열고 같은 핸들에 다시 쓰는지 */
const FAKE_PICKERS = () => {
  window.__saved = {}
  window.__pickerCalls = 0
  const handle = (name) => ({
    kind: 'file',
    name,
    async getFile() {
      return new File([window.__saved[name] ?? new Uint8Array()], name)
    },
    async createWritable() {
      const parts = []
      return {
        async write(d) {
          parts.push(d)
        },
        async close() {
          window.__saved[name] = new Uint8Array(await new Blob(parts).arrayBuffer())
        }
      }
    },
    async requestPermission() {
      return 'granted'
    }
  })
  window.showSaveFilePicker = async (o) => {
    window.__pickerCalls++
    return handle(o.suggestedName)
  }
}

let browser
async function open(init = [], opts = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } })
  for (const s of init) await context.addInitScript(s)
  const page = await context.newPage()
  if (opts.route) await opts.route(page)
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && !opts.allowErrors?.test(m.text()) && errors.push(m.text()))
  await page.goto(URL_)
  await page.getByText('SH Compositor').first().waitFor({ timeout: 20000 })
  await page.waitForFunction(() => !!window.__sc)
  await page.waitForTimeout(300)
  return { context, page, errors }
}

const docInfo = (page) =>
  page.evaluate(() => {
    const e = window.__sc.editor
    const d = e.doc
    if (!d) return null
    return {
      w: d.width,
      h: d.height,
      layers: d.layers.map((l) => ({ name: l.name, opacity: l.opacity, blend: l.blend })),
      undo: e.tab.history.past.length,
      name: e.tab.name,
      tabs: e.state.tabs.length
    }
  })
const px = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const f = window.__sc.flattenDoc(window.__sc.editor.doc)
      const i = (y * f.width + x) * 4
      return Array.from(f.data.slice(i, i + 4))
    },
    [x, y]
  )
const toScreen = (page, x, y) =>
  page.evaluate(
    ([x, y]) => {
      const v = window.__sc.editor.tab.view
      const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect()
      return { x: r.left + v.panX + x * v.zoom, y: r.top + v.panY + y * v.zoom }
    },
    [x, y]
  )
async function drag(page, pts) {
  const s = await Promise.all(pts.map((p) => toScreen(page, p[0], p[1])))
  await page.mouse.move(s[0].x, s[0].y)
  await page.mouse.down()
  for (let i = 1; i < s.length; i++) await page.mouse.move(s[i].x, s[i].y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(150)
}
const press = async (page, k) => {
  await page.keyboard.press(k)
  await page.waitForTimeout(150)
}
async function menu(page, top, item) {
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click()
  await page.getByRole('menuitem', { name: item }).first().click()
  await page.waitForTimeout(200)
}
/** 브라우저에서 Ctrl+N 은 새 창이라 앱이 가로챌 수 없다 — 메뉴로 */
async function newDoc(page, w = 400, h = 300) {
  await menu(page, '파일(F)', '새로 만들기')
  await page.getByLabel('새 문서 폭').fill(String(w))
  await page.getByLabel('새 문서 높이').fill(String(h))
  await page.getByRole('button', { name: '만들기', exact: true }).click()
  await page.waitForFunction(() => !!window.__sc.editor.doc)
  await page.waitForTimeout(300)
}
async function openViaChooser(page, file, trigger) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()])
  await chooser.setFiles(file)
  await page.waitForFunction((n) => window.__sc.editor.state.tabs.length >= n, 1)
  await page.waitForTimeout(300)
}
/** 활성 레이어에 무작위 무늬 (리터칭이 반드시 픽셀을 바꾸게) */
const noisePattern = (page) =>
  page.evaluate(() => {
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
    e.commit({ ...d, layers: d.layers.map((l) => (l === layer ? { ...l, bitmap: { ...l.bitmap, data } } : l)) }, '무늬')
  })
const activePixels = (page) => page.evaluate(() => Array.from(window.__sc.editor.doc.layers.find((l) => l.id === window.__sc.editor.doc.activeId).bitmap.data))

async function main() {
  const server = await startServer()
  browser = await chromium.launch({ headless: true })
  try {
    // W1~W7: 파일 대화상자 없는 브라우저 경로 (다운로드·<input>)
    {
      const { context, page, errors } = await open([NO_PICKERS])
      await t('W1 웹 플랫폼으로 뜨고 창 닫기·최소화 버튼이 없다', async () => {
        assert((await page.evaluate(() => window.api.platform)) === 'web', 'platform')
        assert((await page.getByRole('button', { name: '닫기', exact: true }).count()) === 0, 'close button shown')
        assert((await page.getByRole('button', { name: '최소화', exact: true }).count()) === 0, 'minimize button shown')
      })
      await t('W2 새로 만들기 → 브러시 → 실행취소·다시 실행', async () => {
        await newDoc(page)
        const d = await docInfo(page)
        assert(d.w === 400 && d.h === 300, JSON.stringify(d))
        await press(page, 'b')
        await drag(page, [
          [50, 150],
          [350, 150]
        ])
        assert((await px(page, 200, 150))[0] < 60, 'brush')
        await press(page, 'Control+z')
        assert(near(await px(page, 200, 150), [255, 255, 255, 255]), 'undo')
        await press(page, 'Control+Shift+z')
        assert((await px(page, 200, 150))[0] < 60, 'redo')
      })
      await t('W3 레이어 편집: 새 레이어·칠하기·불투명도 50%·이름 바꾸기', async () => {
        await press(page, 'Control+Shift+n')
        await press(page, 'b')
        await drag(page, [
          [50, 60],
          [350, 60]
        ])
        await page.evaluate(() => {
          const e = window.__sc.editor
          e.commit({ ...e.doc, layers: e.doc.layers.map((l) => (l.id === e.doc.activeId ? { ...l, opacity: 0.5 } : l)) }, '불투명도')
        })
        const p = await px(page, 200, 60)
        assert(p[0] > 100 && p[0] < 160, `opacity ${p}`)
        // 이름 바꾸기 = application layer.update 명령 (UI 대화상자 경로)
        await page.evaluate(() => {
          const e = window.__sc.editor
          e.set({ dialog: { kind: 'rename', layerId: e.doc.activeId } })
        })
        const input = page.getByRole('dialog').locator('input').first()
        await input.fill('웹 레이어')
        await press(page, 'Enter')
        const d = await docInfo(page)
        assert(
          d.layers.some((l) => l.name === '웹 레이어'),
          JSON.stringify(d.layers)
        )
      })
      await t('W4 리터칭(WASM) 흐림·문지르기·리퀴파이 → 실행취소', async () => {
        assert(await page.evaluate(() => window.__sc.retouchReady), 'WASM not loaded on web')
        await noisePattern(page)
        for (const mode of ['blur', 'smudge', 'liquify']) {
          await page.evaluate((mode) => window.__sc.editor.setSettings({ blurMode: mode, blurStrength: 90 }), mode)
          await press(page, 'r')
          const before = await activePixels(page)
          await drag(page, [
            [100, 80],
            [130, 95],
            [160, 85]
          ])
          const after = await activePixels(page)
          assert(
            after.some((v, i) => v !== before[i]),
            `${mode} unchanged`
          )
          await press(page, 'Control+z')
          assert(JSON.stringify(await activePixels(page)) === JSON.stringify(before), `${mode} undo`)
        }
      })
      let savedPath = null
      await t('W5 저장(Ctrl+S) → .shcomp 다운로드', async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), press(page, 'Control+s')])
        assert(/\.shcomp$/.test(dl.suggestedFilename()), dl.suggestedFilename())
        savedPath = path.join(WORK, dl.suggestedFilename())
        await dl.saveAs(savedPath)
        assert(fs.statSync(savedPath).size > 100, 'empty save')
        const tab = await page.evaluate(() => {
          const e = window.__sc.editor
          return { dirty: e.isDirty(e.tab), path: e.tab.path }
        })
        assert(!tab.dirty && tab.path.startsWith('web-'), JSON.stringify(tab))
      })
      await t('W6 다시 열기 (<input> 폴백) → 레이어·불투명도·이름 그대로', async () => {
        const before = await docInfo(page)
        await openViaChooser(page, savedPath, () => press(page, 'Control+o'))
        await page.waitForFunction(() => window.__sc.editor.state.tabs.length === 2)
        const d = await docInfo(page)
        assert(d.tabs === 2 && d.layers.length === before.layers.length, JSON.stringify(d))
        assert(
          d.layers.some((l) => l.name === '웹 레이어' && l.opacity === 0.5),
          JSON.stringify(d.layers)
        )
      })
      await t('W7 PNG 열기 200×100', async () => {
        await openViaChooser(page, QUAD, () => press(page, 'Control+o'))
        await page.waitForFunction(() => window.__sc.editor.state.tabs.length === 3)
        const d = await docInfo(page)
        assert(d.w === 200 && d.h === 100, JSON.stringify(d))
        assert(near(await px(page, 20, 20), [220, 40, 40, 255]), 'pixel')
      })
      await t('W8 이미지 크기(application 명령) → 한 단계로 실행취소', async () => {
        const n = (await docInfo(page)).undo
        await menu(page, '이미지(I)', '이미지 크기')
        const dlg = page.getByRole('dialog')
        await dlg.getByLabel('폭', { exact: true }).fill('100')
        await dlg.getByRole('button', { name: '확인', exact: true }).click()
        await page.waitForTimeout(300)
        const d = await docInfo(page)
        assert(d.w === 100 && d.h === 50 && d.undo === n + 1, JSON.stringify(d))
        await press(page, 'Control+z')
        assert((await docInfo(page)).w === 200, 'undo resize')
      })
      await t('W9 자동 저장 → 새로 고침 → 복구 대화상자로 되살림', async () => {
        // 저장 안 한 변경이 있어야 자동 저장 대상이 된다
        await press(page, 'b')
        await drag(page, [
          [20, 20],
          [180, 80]
        ])
        assert(await page.evaluate(() => window.__sc.editor.isDirty(window.__sc.editor.tab)), 'not dirty')
        await page.evaluate(() => window.__sc.autosaveNow())
        const stored = await page.evaluate(() => window.api.recovery.list())
        assert(stored.length >= 1, JSON.stringify(stored))
        // 저장 안 한 문서가 있으면 떠나기 전에 브라우저가 묻는다
        let asked = false
        page.once('dialog', (d) => {
          asked = d.type() === 'beforeunload'
          void d.accept()
        })
        await page.reload()
        assert(asked, 'no beforeunload prompt for unsaved work')
        await page.getByRole('dialog').getByText('문서 복구').waitFor({ timeout: 15000 })
        await page.getByRole('dialog').getByRole('button', { name: '복구', exact: true }).click()
        await page.waitForFunction(() => window.__sc.editor.state.tabs.length >= 1)
        await page.waitForTimeout(500)
        const names = await page.evaluate(() => window.__sc.editor.state.tabs.map((t) => t.name))
        assert(
          names.some((n) => n.endsWith('(복구됨)')),
          JSON.stringify(names)
        )
        assert((await page.evaluate(() => window.api.recovery.list())).length === 0, 'recovery not cleared')
      })
      await t('W10 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
      await context.close()
    }
    // W11: File System Access 가 있으면 같은 파일에 다시 저장 (대화상자는 처음 한 번)
    {
      const { context, page, errors } = await open([FAKE_PICKERS])
      await t('W11 File System Access: 저장 대화상자 한 번, 두 번째 Ctrl+S 는 같은 파일에', async () => {
        await newDoc(page, 64, 64)
        await press(page, 'Control+s')
        await page.waitForFunction(() => Object.keys(window.__saved).length === 1)
        const first = await page.evaluate(() => Object.values(window.__saved)[0].length)
        await press(page, 'b')
        await drag(page, [
          [5, 30],
          [60, 30]
        ])
        await press(page, 'Control+s')
        await page.waitForFunction((n) => Object.values(window.__saved)[0].length !== n, first)
        assert((await page.evaluate(() => window.__pickerCalls)) === 1, 'picker opened twice')
        assert((await page.evaluate(() => window.__sc.editor.isDirty(window.__sc.editor.tab))) === false, 'still dirty')
      })
      await t('W12 콘솔 오류 없음', async () => assert(errors.length === 0, errors.join('\n')))
      await context.close()
    }
    // W13: WASM 을 못 받으면 TS 기준 경로로 리터칭
    {
      const { context, page, errors } = await open([NO_PICKERS], { route: (p) => p.route(/retouch.*\.wasm/, (r) => r.abort()), allowErrors: /retouch|Failed to load resource/i })
      await t('W13 WASM 로딩 실패 → TS 폴백으로 흐림 도구 동작', async () => {
        assert((await page.evaluate(() => window.__sc.retouchReady)) === false, 'wasm should have failed')
        await newDoc(page, 200, 150)
        await noisePattern(page)
        await page.evaluate(() => window.__sc.editor.setSettings({ blurMode: 'blur', blurStrength: 90 }))
        await press(page, 'r')
        const before = await activePixels(page)
        await drag(page, [
          [60, 60],
          [120, 80]
        ])
        const after = await activePixels(page)
        assert(
          after.some((v, i) => v !== before[i]),
          'fallback blur unchanged'
        )
      })
      await t('W14 콘솔 오류 없음 (WASM 실패 경고 제외)', async () => assert(errors.length === 0, errors.join('\n')))
      await context.close()
    }
    // W15: 저장 공간 초과 → 안내
    {
      const QUOTA = () => {
        const put = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...a) {
          if (this.name === 'recovery') throw new DOMException('full', 'QuotaExceededError')
          return put.apply(this, a)
        }
      }
      const { context, page } = await open([NO_PICKERS, QUOTA])
      await t('W15 IndexedDB 용량 초과 → 저장 공간 부족 안내, 편집은 계속', async () => {
        await newDoc(page, 64, 64)
        await press(page, 'b')
        await drag(page, [
          [5, 30],
          [60, 30]
        ])
        await page.evaluate(() => window.__sc.autosaveNow())
        await page.getByText('브라우저 저장 공간이 부족해').first().waitFor({ timeout: 5000 })
        assert((await docInfo(page)).undo >= 1, 'editing broken')
      })
      await context.close()
    }
  } finally {
    await browser.close()
    server.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 200))
    if (server.exitCode === null) server.kill('SIGKILL')
  }
  const fail = results.filter((r) => !r.ok)
  console.log(`\n${results.length - fail.length}/${results.length} passed`)
  for (const f of fail) console.log(`  ✗ ${f.name}: ${f.err}`)
  fs.rmSync(WORK, { recursive: true, force: true })
  process.exit(fail.length ? 1 : 0)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
