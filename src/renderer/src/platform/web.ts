/**
 * 웹 플랫폼 어댑터 — preload 의 `window.api` 와 같은 모양을 브라우저 기능으로 구현한다 (plans/0004 §3, ADR-0005).
 *
 *  - 파일: File System Access(가능하면 — 같은 파일에 다시 저장) → 아니면 <input type=file> 열기 + 다운로드 저장.
 *    OS 경로가 없으므로 "경로"는 이 탭 안에서만 통하는 토큰(web-file:…)이다. 새로 고치면 다시 열어야 한다.
 *  - 자동 저장·복구: IndexedDB. 용량이 모자라면 알림을 띄운다.
 *  - 클립보드: Async Clipboard (브라우저가 권한을 물을 수 있다). 창 버튼: 최대화 = 전체 화면, 닫기·최소화는 없음.
 *  - 모델: 배포 경로 아래 models/sam/, models/bgrm/ (build:web 이 있으면 복사한다).
 */
type Api = Window['api']
type OpenedFile = Awaited<ReturnType<Api['open']>>[number]
import { idbDelete, idbGet, idbKeys, idbPut, isQuotaError } from './idb'

type Handle = {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(d: BlobPart): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }>
  requestPermission?(o: { mode: string }): Promise<string>
}
type DirHandle = {
  kind: 'directory'
  name: string
  values(): AsyncIterable<Handle | DirHandle>
  getFileHandle(name: string, o?: { create?: boolean }): Promise<Handle>
  requestPermission?(o: { mode: string }): Promise<string>
}
type PickerWindow = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<Handle[]>
  showSaveFilePicker?: (o: unknown) => Promise<Handle>
  showDirectoryPicker?: (o?: unknown) => Promise<DirHandle>
}
const w = window as PickerWindow

export interface WebHooks {
  /** 저장하지 않은 문서가 있는가 (페이지를 떠나기 전 확인) */
  hasUnsaved: () => boolean
  /** 사용자에게 알림 */
  notify: (kind: 'info' | 'err', text: string) => void
}
let hooks: WebHooks = { hasUnsaved: () => false, notify: () => {} }
export function setWebHooks(h: WebHooks): void {
  hooks = h
}

// ── 경로 토큰 ──
let seq = 0
const files = new Map<string, Handle | null>()
const dirs = new Map<string, DirHandle | null>()
const token = (kind: string, name: string): string => `web-${kind}:${++seq}/${name}`
const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

const ACCEPT: Record<string, string[]> = {
  project: ['.shcomp'],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif', '.psd', '.psb'],
  psd: ['.psd'],
  png: ['.png'],
  jpeg: ['.jpg', '.jpeg'],
  webp: ['.webp']
}
const MIME: Record<string, string> = { project: 'application/zip', psd: 'image/vnd.adobe.photoshop', png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', image: 'image/*' }

async function readFile(file: File, path: string): Promise<OpenedFile> {
  return { path, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
}

/** <input type=file> 폴백 — 취소는 cancel 이벤트로 안다 (지원하지 않는 브라우저에서는 대기만 남는다) */
function pickWithInput(accept: string[], directory = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = !directory
    if (directory) input.setAttribute('webkitdirectory', '')
    else if (accept.length) input.accept = accept.join(',')
    let done = false
    const finish = (list: File[]): void => {
      if (done) return
      done = true
      resolve(list)
    }
    input.addEventListener('change', () => finish([...(input.files ?? [])]))
    input.addEventListener('cancel', () => finish([]))
    input.click()
  })
}

async function writeHandle(h: Handle, bytes: Uint8Array): Promise<void> {
  if (h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('파일에 쓸 권한이 없습니다.')
  const out = await h.createWritable()
  try {
    await out.write(bytes as unknown as BlobPart)
    await out.close()
  } catch (e) {
    // 반쯤 쓴 내용을 원본에 반영하지 않는다 (close 전에 버리면 원래 파일이 남는다)
    await out.abort?.().catch(() => {})
    throw e
  }
}

function download(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function readTree(dir: DirHandle, prefix = '', out: Record<string, Uint8Array> = {}, budget = { files: 0 }): Promise<Record<string, Uint8Array>> {
  for await (const ent of dir.values()) {
    if (++budget.files > 20000) throw new Error('폴더에 파일이 너무 많습니다.')
    if (ent.kind === 'directory') await readTree(ent, `${prefix}${ent.name}/`, out, budget)
    else out[`${prefix}${ent.name}`] = new Uint8Array(await (await ent.getFile()).arrayBuffer())
  }
  return out
}

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError'

// ── 복구 (IndexedDB) ──
interface RecoveryRow {
  meta: { name: string; path: string | null }
  bytes: Uint8Array
  savedAt: number
}

const assetsUrl = (sub: string): string => new URL(`models/${sub}/`, document.baseURI).toString()

export function createWebApi(): Api {
  const api: Api = {
    platform: 'web',
    async open(kind) {
      const accept = kind === 'any' ? [...ACCEPT.project, ...ACCEPT.image] : ACCEPT[kind]
      if (w.showOpenFilePicker) {
        try {
          const hs = await w.showOpenFilePicker({ multiple: true, types: [{ description: '프로젝트·이미지', accept: { 'application/octet-stream': accept } }] })
          return Promise.all(
            hs.map(async (h) => {
              const p = token('file', h.name)
              files.set(p, h)
              return readFile(await h.getFile(), p)
            })
          )
        } catch (e) {
          if (isAbort(e)) return []
          throw e
        }
      }
      const list = await pickWithInput(accept)
      return Promise.all(
        list.map((f) => {
          const p = token('file', f.name)
          files.set(p, null)
          return readFile(f, p)
        })
      )
    },
    async read(path) {
      const h = files.get(path)
      if (!h) throw new Error('웹에서는 이 파일을 다시 열 수 없습니다. 파일 ▸ 열기로 다시 골라 주세요.')
      return readFile(await h.getFile(), path)
    },
    async saveAs(defaultName, kind) {
      if (w.showSaveFilePicker) {
        try {
          const ext = ACCEPT[kind] ?? ACCEPT.png
          const h = await w.showSaveFilePicker({ suggestedName: defaultName, types: [{ description: kind, accept: { [MIME[kind] ?? 'application/octet-stream']: ext } }] })
          const p = token('file', h.name)
          files.set(p, h)
          return p
        } catch (e) {
          if (isAbort(e)) return null
          throw e
        }
      }
      // 저장 대화상자가 없는 브라우저 — 제안한 이름으로 내려받는다
      const p = token('download', defaultName)
      files.set(p, null)
      return p
    },
    async chooseDir() {
      if (w.showDirectoryPicker) {
        try {
          const d = await w.showDirectoryPicker({ mode: 'readwrite' })
          const p = token('dir', d.name)
          dirs.set(p, d)
          return p
        } catch (e) {
          if (isAbort(e)) return null
          throw e
        }
      }
      const p = token('dir', 'downloads')
      dirs.set(p, null)
      return p
    },
    async openCompFolder(path) {
      if (path) throw new Error('웹에서는 폴더 경로로 열 수 없습니다. 파일 ▸ Compositor 폴더 열기로 골라 주세요.')
      if (w.showDirectoryPicker) {
        try {
          const d = await w.showDirectoryPicker()
          const tree = await readTree(d)
          if (!tree['manifest.json']) throw new Error('manifest.json 이 없습니다. Compositor 프로젝트(.comp) 폴더가 아닙니다.')
          return { path: token('dir', d.name), name: d.name, files: tree }
        } catch (e) {
          if (isAbort(e)) return null
          throw e
        }
      }
      const list = await pickWithInput([], true)
      if (!list.length) return null
      const root = (list[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split('/')[0] ?? 'folder'
      const tree: Record<string, Uint8Array> = {}
      for (const f of list) tree[((f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name).slice(root.length + 1)] = new Uint8Array(await f.arrayBuffer())
      if (!tree['manifest.json']) throw new Error('manifest.json 이 없습니다. Compositor 프로젝트(.comp) 폴더가 아닙니다.')
      return { path: token('dir', root), name: root, files: tree }
    },
    recovery: {
      async write(id, meta, bytes) {
        try {
          await idbPut('recovery', id, { meta, bytes, savedAt: Date.now() } satisfies RecoveryRow)
        } catch (e) {
          if (isQuotaError(e)) hooks.notify('err', '브라우저 저장 공간이 부족해 자동 저장하지 못했습니다. 문서를 파일로 저장해 두세요.')
          throw e
        }
      },
      async list() {
        const out: { id: string; name: string; path: string | null; savedAt: number }[] = []
        for (const key of await idbKeys('recovery')) {
          const row = await idbGet<RecoveryRow>('recovery', String(key))
          if (row) out.push({ id: String(key), name: row.meta.name, path: row.meta.path, savedAt: row.savedAt })
        }
        return out.sort((a, b) => b.savedAt - a.savedAt)
      },
      async read(id) {
        const row = await idbGet<RecoveryRow>('recovery', id)
        if (!row) throw new Error('복구본이 없습니다.')
        return row.bytes
      },
      async clear(id) {
        await idbDelete('recovery', id)
      }
    },
    async write(path, bytes) {
      const dirKey = [...dirs.keys()].find((d) => path.startsWith(`${d}/`))
      if (dirKey) {
        const d = dirs.get(dirKey)
        const name = path.slice(dirKey.length + 1)
        if (d) {
          if (d.requestPermission && (await d.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('폴더에 쓸 권한이 없습니다.')
          await writeHandle(await d.getFileHandle(name, { create: true }), bytes)
        } else download(name, bytes)
        return path
      }
      const h = files.get(path)
      if (h) await writeHandle(h, bytes)
      else download(baseName(path), bytes)
      return path
    },
    async showItem() {},
    pathOf(file) {
      const p = token('file', file.name)
      files.set(p, null)
      return p
    },
    clipboard: {
      async writeImage(png) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([png as unknown as BlobPart], { type: 'image/png' }) })])
          return true
        } catch {
          hooks.notify('info', '브라우저가 클립보드 쓰기를 허용하지 않았습니다.')
          return false
        }
      },
      async readImage() {
        try {
          for (const item of await navigator.clipboard.read()) if (item.types.includes('image/png')) return new Uint8Array(await (await item.getType('image/png')).arrayBuffer())
        } catch {
          hooks.notify('info', '브라우저가 클립보드 읽기를 허용하지 않았습니다. Ctrl+V 로 붙여 넣어 보세요.')
        }
        return null
      }
    },
    win: {
      async minimize() {},
      async toggleMaximize() {
        if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
        else await document.documentElement.requestFullscreen().catch(() => {})
        return !!document.fullscreenElement
      },
      async close() {
        hooks.notify('info', '웹에서는 브라우저 탭을 닫아 끝냅니다. 저장하지 않은 문서가 있으면 브라우저가 먼저 묻습니다.')
      },
      async confirmClose() {
        allowUnload = true
      },
      async isMaximized() {
        return !!document.fullscreenElement
      },
      onMaximized(cb) {
        const on = (): void => cb(!!document.fullscreenElement)
        document.addEventListener('fullscreenchange', on)
        return () => document.removeEventListener('fullscreenchange', on)
      },
      onCloseRequest() {
        return () => {}
      }
    },
    async pendingOpen() {
      return []
    },
    onOpenFiles() {
      return () => {}
    },
    bgAssetsUrl: assetsUrl('bgrm'),
    samAssetsUrl: assetsUrl('sam'),
    onRecovered() {
      return () => {}
    }
  }
  return api
}

let allowUnload = false
/** 저장 안 한 문서가 있으면 브라우저 기본 확인 창 (사용자 정의 대화상자는 띄울 수 없다) */
export function installUnloadGuard(): void {
  window.addEventListener('beforeunload', (e) => {
    if (allowUnload || !hooks.hasUnsaved()) return
    e.preventDefault()
    e.returnValue = ''
  })
}
