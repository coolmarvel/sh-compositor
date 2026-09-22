/**
 * 체감 성능 측정 — 큰 문서(4000×3000, 레이어 5장, 선택 영역 있음)에서 붓질·레이어 끌기·그냥 움직이기의
 * 긴 작업(long task, 50ms+) 합계와 프레임 간격을 잰다. `npm run build` 후 `node test/e2e/perf.mjs`.
 */
import { createRequire } from 'module'
import path from 'path'
import os from 'os'
import fs from 'fs'
const PROJECT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
const require_ = createRequire(path.join(PROJECT, 'package.json'))
const { _electron: electron } = require_('playwright')
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-perf-'))
const app = await electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${ud}`], cwd: PROJECT, env: { ...process.env, SC_E2E: '1' } })
const proc = app.process()
const out = {}
// 감시견: 어떤 경우에도 앱 프로세스를 남기지 않는다
const LIMIT = Number(process.env.PERF_LIMIT ?? 240) * 1000
const dog = setTimeout(() => {
  console.log('WATCHDOG — 시간 초과, 앱 강제 종료', JSON.stringify(out))
  try {
    proc.kill('SIGKILL')
  } catch {}
  process.exit(2)
}, LIMIT)
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)
try {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize())
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1000)
  // 큰 문서: 사진 같은 노이즈 배경 + 레이어 4장
  const SIDE = (process.env.PERF_SIZE ?? '2000x1500').split('x').map(Number)
  await page.evaluate(([w, h, n]) => ((window.__PW = w), (window.__PH = h), (window.__PL = n)), [...SIDE, Number(process.env.PERF_LAYERS ?? 5)])
  log(`문서 만들기 ${SIDE.join('×')}`)
  await page.evaluate(() => {
    const { editor } = window.__sc
    const W = window.__PW
    const H = window.__PH
    const mk = (seed, alphaHole) => {
      const d = new Uint8ClampedArray(W * H * 4)
      let s = seed
      for (let i = 0; i < W * H; i++) {
        s = (s * 1664525 + 1013904223) >>> 0
        d[i * 4] = (i % W) & 255
        d[i * 4 + 1] = ((i / W) | 0) & 255
        d[i * 4 + 2] = s >>> 24
        d[i * 4 + 3] = alphaHole && i % W > W / 2 ? 0 : 255
      }
      return { width: W, height: H, data: d }
    }
    const t = (w, h, x = 0, y = 0) => ({ x, y, width: w, height: h, rotation: 0, flipH: false, flipV: false })
    const L = (id, name, bmp, extra = {}) => ({
      id,
      name,
      kind: 'pixel',
      visible: true,
      opacity: 1,
      blend: 'normal',
      bitmap: bmp,
      transform: t(W, H),
      parentId: null,
      mask: null,
      clip: false,
      effects: null,
      adjustment: null,
      text: null,
      ...extra
    })
    const all = [
      () => L('a', '배경', mk(1)),
      () => L('b', '레이어 2', mk(2, true), { blend: 'multiply' }),
      () => L('c', '레이어 3', mk(3, true), { opacity: 0.5 }),
      () => L('d', '레이어 4', mk(4, true), { blend: 'screen' }),
      () => L('e', '레이어 5', mk(5, true))
    ]
    const layers = all.slice(0, window.__PL).map((f) => f())
    layers[layers.length - 1] = { ...layers[layers.length - 1], id: 'e' }
    const mask = new Uint8Array(W * H)
    for (let y = H >> 3; y < H - (H >> 3); y++) mask.fill(255, y * W + (W >> 3), y * W + W - (W >> 3))
    const doc = {
      id: 'perf',
      width: W,
      height: H,
      resolution: 72,
      layers,
      activeId: 'e',
      selection: { width: W, height: H, mask, bounds: { x: W >> 3, y: H >> 3, w: W - 2 * (W >> 3), h: H - 2 * (H >> 3) } }
    }
    editor.addTab(doc, 'perf', null)
  })
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    window.__lt = []
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push(e.duration)
    }).observe({ type: 'longtask', buffered: false })
    window.__frames = []
    let last = performance.now()
    const tick = (t) => {
      window.__frames.push(t - last)
      last = t
      window.__raf = requestAnimationFrame(tick)
    }
    window.__raf = requestAnimationFrame(tick)
  })
  const box = await page.locator('[data-testid="canvas"]').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const measure = async (name, fn) => {
    log(name)
    await page.evaluate(() => ((window.__lt = []), (window.__frames = [])))
    const t0 = Date.now()
    await fn()
    const wall = Date.now() - t0
    const r = await page.evaluate(() => {
      const f = window.__frames.slice(1).sort((a, b) => a - b)
      return {
        longTasks: window.__lt.length,
        longMs: Math.round(window.__lt.reduce((a, b) => a + b, 0)),
        p50: Math.round(f[Math.floor(f.length / 2)] ?? 0),
        p95: Math.round(f[Math.floor(f.length * 0.95)] ?? 0),
        worst: Math.round(f[f.length - 1] ?? 0)
      }
    })
    out[name] = { wallMs: wall, ...r }
  }
  const sweep = async (steps, mods = []) => {
    for (const m of mods) await page.keyboard.down(m)
    for (let i = 0; i <= steps; i++) await page.mouse.move(cx - 300 + (600 * i) / steps, cy + Math.sin(i / 5) * 100)
    for (const m of mods) await page.keyboard.up(m)
  }
  await page.keyboard.press('v')
  await measure('hover (이동 도구, 개미 행진)', () => sweep(120))
  await page.mouse.move(cx - 300, cy)
  const PROFILE = !!process.env.PERF_PROFILE
  let cdp = null
  const TRACE = !!process.env.PERF_TRACE
  const events = []
  if (PROFILE) {
    cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
  }
  if (TRACE) {
    cdp = await page.context().newCDPSession(page)
    cdp.on('Tracing.dataCollected', (e) => events.push(...e.value))
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,gpu', transferMode: 'ReportEvents' })
  }
  await measure('layer drag (이동 도구)', async () => {
    await page.mouse.down()
    await sweep(PROFILE || TRACE ? 10 : 120)
    await page.mouse.up()
    await page.waitForTimeout(300)
  })
  if (TRACE) {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r))
    await cdp.send('Tracing.end')
    await done
    const tot = new Map()
    for (const e of events) if (e.ph === 'X' && e.dur) tot.set(e.name, (tot.get(e.name) ?? 0) + e.dur / 1000)
    console.log(
      [...tot]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, v]) => `${Math.round(v)}ms  ${k}`)
        .join('\n')
    )
    throw new Error('trace done')
  }
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop')
    const self = new Map()
    const dt = profile.timeDeltas
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    profile.samples.forEach((id, i) => {
      const n = byId.get(id)
      const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`
      self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
    })
    console.log(
      [...self]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 25)
        .map(([k, v]) => `${Math.round(v)}ms  ${k}`)
        .join('\n')
    )
    // 누적(포함) 시간 상위: 부모 사슬
    const parent = new Map()
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
    const incl = new Map()
    profile.samples.forEach((id, i) => {
      const seen = new Set()
      for (let cur = id; cur; cur = parent.get(cur)) {
        const n = byId.get(cur)
        const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`
        if (seen.has(k)) continue
        seen.add(k)
        incl.set(k, (incl.get(k) ?? 0) + (dt[i] ?? 0) / 1000)
      }
    })
    console.log(
      '--- inclusive ---\n' +
        [...incl]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 30)
          .map(([k, v]) => `${Math.round(v)}ms  ${k}`)
          .join('\n')
    )
    throw new Error('profile done')
  }
  await page.keyboard.press('Control+d')
  await page.keyboard.press('b')
  await page.mouse.move(cx - 300, cy)
  let bcdp = null
  if (process.env.PERF_PROFILE_BRUSH) {
    bcdp = await page.context().newCDPSession(page)
    await bcdp.send('Profiler.enable')
    await bcdp.send('Profiler.start')
  }
  await measure('brush stroke (300px)', async () => {
    await page.mouse.down()
    await sweep(120)
    await page.mouse.up()
    await page.waitForTimeout(500)
  })
  if (bcdp) {
    const { profile } = await bcdp.send('Profiler.stop')
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    const parent = new Map()
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
    const incl = new Map()
    profile.samples.forEach((id, i) => {
      const seen = new Set()
      for (let cur = id; cur; cur = parent.get(cur)) {
        const n = byId.get(cur)
        const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`
        if (seen.has(k)) continue
        seen.add(k)
        incl.set(k, (incl.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000)
      }
    })
    console.log(
      [...incl]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 40)
        .map(([k, v]) => `${Math.round(v)}ms  ${k}`)
        .join('\n')
    )
  }
  await measure('undo', async () => {
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
  })
} finally {
  clearTimeout(dog)
  console.log(JSON.stringify(out, null, 1))
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  if (proc.exitCode === null) proc.kill('SIGKILL')
  fs.rmSync(ud, { recursive: true, force: true })
}
