import { assetPath, writeAtomic } from './files'
import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net, clipboard, nativeImage } from 'electron'
import { join, basename, extname } from 'path'
import { readFile, readdir, stat, mkdir, rm } from 'fs/promises'
import { pathToFileURL } from 'url'

// ── AI 배경 제거 모델 서빙 (bgrm://) — 파일 변환기와 같은 방식 (완전 오프라인) ──
protocol.registerSchemesAsPrivileged([
  { scheme: 'bgrm', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  // 개체 선택 AI(SlimSAM) 모델·onnxruntime wasm — resources/sam (scripts/fetch-models.cjs)
  { scheme: 'aimodel', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
])

function samDataDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'sam') : join(app.getAppPath(), 'resources/sam')
}

/** 폴더 하나를 커스텀 프로토콜로 (경로 탈출 방지, CORS 허용, 모듈 스크립트는 JS 형식으로) */
function serveDir(scheme: string, dirOf: () => string): void {
  protocol.handle(scheme, async (request) => {
    const url = new URL(request.url)
    const full = assetPath(dirOf(), url.hostname, url.pathname)
    if (!full) return new Response('forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(full).toString())
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    if (full.endsWith('.mjs') || full.endsWith('.js')) headers.set('Content-Type', 'text/javascript')
    if (full.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm')
    return new Response(res.body, { status: res.status, headers })
  })
}

function bgrmDataDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bgrm-data') : join(app.getAppPath(), 'node_modules/@imgly/background-removal-data/dist')
}

/** 실행 인자로 넘어온 파일(더블클릭으로 연 .shcomp·이미지) */
const pendingOpen: string[] = process.argv.slice(1).filter((a) => /\.(shcomp|psd|psb|png|jpe?g|webp|bmp|gif|tiff?|heic|heif)$/i.test(a))

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false, // 앱이 그리는 클래식 타이틀바 (ADR-0002, DESIGN.md)
    backgroundColor: '#2a2c32',
    title: 'SH Compositor',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../build/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true }
  })
  const win = mainWindow
  win.on('ready-to-show', () => win.show())
  const pushMaximized = (): void => win.webContents.send('win:maximized', win.isMaximized())
  win.on('maximize', pushMaximized)
  win.on('unmaximize', pushMaximized)
  // 닫기 전에 렌더러가 "저장하지 않은 변경" 을 물을 수 있게 — 렌더러가 승인하면 destroy
  win.on('close', (e) => {
    if ((win as unknown as { allowClose?: boolean }).allowClose) return
    e.preventDefault()
    win.webContents.send('win:closeRequest')
  })

  let lastRecover = 0
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    if (now - lastRecover < 10_000) return
    lastRecover = now
    win.webContents.once('did-finish-load', () => win.webContents.send('app:recovered', details.reason))
    win.webContents.reload()
  })
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  // SC_E2E=1 이면 렌더러가 테스트용 상태 조회 창구(window.__sc)를 연다 (E2E 전용)
  else win.loadFile(join(__dirname, '../renderer/index.html'), process.env['SC_E2E'] ? { query: { e2e: '1' } } : undefined)
}

const sender = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)

// ── 창 ──
ipcMain.handle('win:minimize', (e) => sender(e)?.minimize())
ipcMain.handle('win:toggleMaximize', (e) => {
  const w = sender(e)
  if (!w) return false
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
  return w.isMaximized()
})
ipcMain.handle('win:close', (e) => sender(e)?.close())
ipcMain.handle('win:isMaximized', (e) => sender(e)?.isMaximized() ?? false)
/** 렌더러가 닫기를 승인 */
ipcMain.handle('win:confirmClose', (e) => {
  const w = sender(e)
  if (!w) return
  ;(w as unknown as { allowClose?: boolean }).allowClose = true
  w.close()
})

// ── 파일 ──
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'psd', 'psb']

/** 열기 대화상자 → [{ path, name, bytes }] */
ipcMain.handle('fs:open', async (e, kind: 'project' | 'image' | 'any') => {
  const filters =
    kind === 'project'
      ? [{ name: '프로젝트', extensions: ['shcomp'] }]
      : kind === 'image'
        ? [{ name: '이미지', extensions: IMAGE_EXT }]
        : [
            { name: '프로젝트·이미지', extensions: ['shcomp', ...IMAGE_EXT] },
            { name: '모든 파일', extensions: ['*'] }
          ]
  const r = await dialog.showOpenDialog(sender(e)!, { title: '열기', properties: ['openFile', 'multiSelections'], filters })
  if (r.canceled) return []
  return Promise.all(r.filePaths.map(async (p) => ({ path: p, name: basename(p), bytes: new Uint8Array(await readFile(p)) })))
})

/** Compositor .comp 프로젝트 폴더 열기 → { 상대 경로: 바이트 } (manifest.json + images/…) */
async function readTree(dir: string, prefix = '', out: Record<string, Uint8Array> = {}, budget = { files: 0 }): Promise<Record<string, Uint8Array>> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (++budget.files > 20000) throw new Error('폴더에 파일이 너무 많습니다.')
    const full = join(dir, ent.name)
    if (ent.isDirectory()) await readTree(full, `${prefix}${ent.name}/`, out, budget)
    else if (ent.isFile()) out[`${prefix}${ent.name}`] = new Uint8Array(await readFile(full))
  }
  return out
}
ipcMain.handle('fs:openCompFolder', async (e, given?: string) => {
  let dir = given
  if (!dir) {
    const r = await dialog.showOpenDialog(sender(e)!, { title: 'Compositor 프로젝트(.comp) 폴더 열기', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    dir = r.filePaths[0]
  }
  const s = await stat(join(dir, 'manifest.json')).catch(() => null)
  if (!s) throw new Error('manifest.json 이 없습니다 — Compositor 프로젝트(.comp) 폴더가 아닙니다.')
  return { path: dir, name: basename(dir), files: await readTree(dir) }
})

// ── 자동 저장·복구 (userData/recovery/<id>.shcomp + <id>.json) ──
const recoveryDir = (): string => join(app.getPath('userData'), 'recovery')
const safeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, '')
ipcMain.handle('recovery:write', async (_e, id: string, meta: { name: string; path: string | null }, bytes: Uint8Array) => {
  await mkdir(recoveryDir(), { recursive: true })
  const base = join(recoveryDir(), safeId(id))
  await writeAtomic(`${base}.shcomp`, bytes)
  await writeAtomic(`${base}.json`, JSON.stringify({ ...meta, savedAt: Date.now() }))
})
ipcMain.handle('recovery:list', async () => {
  const names = await readdir(recoveryDir()).catch(() => [] as string[])
  const out: { id: string; name: string; path: string | null; savedAt: number }[] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const meta = JSON.parse(await readFile(join(recoveryDir(), n), 'utf8'))
      out.push({ id: n.slice(0, -5), name: meta.name, path: meta.path ?? null, savedAt: meta.savedAt ?? 0 })
    } catch {
      /* 깨진 메타 — 건너뜀 */
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt)
})
ipcMain.handle('recovery:read', async (_e, id: string) => new Uint8Array(await readFile(join(recoveryDir(), `${safeId(id)}.shcomp`))))
ipcMain.handle('recovery:clear', async (_e, id: string) => {
  const base = join(recoveryDir(), safeId(id))
  await rm(`${base}.shcomp`, { force: true })
  await rm(`${base}.json`, { force: true })
})

/** 폴더 고르기 (레이어를 각각 내보낼 곳) */
ipcMain.handle('fs:chooseDir', async (e, title: string) => {
  const r = await dialog.showOpenDialog(sender(e)!, { title, properties: ['openDirectory', 'createDirectory'] })
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
})

/** 경로로 읽기 (드롭·실행 인자·최근 파일) */
ipcMain.handle('fs:read', async (_e, p: string) => ({ path: p, name: basename(p), bytes: new Uint8Array(await readFile(p)) }))

/** 저장 대화상자 → 경로 (취소면 null) */
const SAVE_KINDS = {
  project: { name: 'SH Compositor 프로젝트', ext: ['shcomp'] },
  psd: { name: 'Photoshop (PSD)', ext: ['psd'] },
  png: { name: 'PNG', ext: ['png'] },
  jpeg: { name: 'JPEG', ext: ['jpg', 'jpeg'] },
  webp: { name: 'WebP', ext: ['webp'] }
} as const
ipcMain.handle('fs:saveAs', async (e, defaultName: string, kind: keyof typeof SAVE_KINDS) => {
  const k = SAVE_KINDS[kind] ?? SAVE_KINDS.png
  // 프로젝트 저장은 .shcomp 와 .psd 중에서 고른다 (포토샵과 주고받기)
  const filters =
    kind === 'project' || kind === 'psd'
      ? [SAVE_KINDS[kind], SAVE_KINDS[kind === 'project' ? 'psd' : 'project']].map((f) => ({ name: f.name, extensions: [...f.ext] }))
      : [{ name: k.name, extensions: [...k.ext] }]
  const r = await dialog.showSaveDialog(sender(e)!, { title: '저장', defaultPath: defaultName, filters })
  if (r.canceled || !r.filePath) return null
  let p = r.filePath
  if (!extname(p)) p += `.${k.ext[0]}`
  return p
})

/** 같은 폴더 임시 파일을 완성한 뒤 교체 — 실패 시 기존 문서 보존 */
ipcMain.handle('fs:write', async (_e, p: string, bytes: Uint8Array) => {
  await writeAtomic(p, bytes)
  return p
})

ipcMain.handle('shell:showItem', (_e, p: string) => shell.showItemInFolder(p))

// ── 클립보드 (Compositor Copy / Copy Merged / Paste) ──
ipcMain.handle('clip:writeImage', (_e, png: Uint8Array) => {
  const img = nativeImage.createFromBuffer(Buffer.from(png))
  if (img.isEmpty()) return false
  clipboard.writeImage(img)
  return true
})
ipcMain.handle('clip:readImage', () => {
  const img = clipboard.readImage()
  if (img.isEmpty()) return null
  return new Uint8Array(img.toPNG())
})

/** 실행 인자로 받은 파일 목록 (렌더러 준비 후 한 번) */
ipcMain.handle('app:pendingOpen', () => pendingOpen.splice(0))

app.whenReady().then(() => {
  serveDir('aimodel', samDataDir)
  serveDir('bgrm', bgrmDataDir)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 이미 실행 중일 때 파일을 더블클릭하면 그 창에서 연다
if (!app.requestSingleInstanceLock()) app.quit()
else
  app.on('second-instance', (_e, argv) => {
    const files = argv.slice(1).filter((a) => /\.(shcomp|psd|psb|png|jpe?g|webp|bmp|gif|tiff?|heic|heif)$/i.test(a))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (files.length) mainWindow.webContents.send('app:openFiles', files)
    }
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
