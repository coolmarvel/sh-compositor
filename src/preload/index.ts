import { contextBridge, ipcRenderer, webUtils } from 'electron'

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

export interface OpenedFile {
  path: string
  name: string
  bytes: Uint8Array
}

/** 렌더러에 노출되는 안전한 API 표면 — 파일·창·클립보드는 전부 여기를 거친다 */
const api = {
  /** 실행 환경 — 웹 빌드는 같은 모양의 브라우저 구현(renderer/src/platform/web.ts)을 넣는다 */
  platform: 'electron' as 'electron' | 'web',
  open: (kind: 'project' | 'image' | 'any'): Promise<OpenedFile[]> => ipcRenderer.invoke('fs:open', kind),
  read: (path: string): Promise<OpenedFile> => ipcRenderer.invoke('fs:read', path),
  saveAs: (defaultName: string, kind: 'project' | 'psd' | 'png' | 'jpeg' | 'webp'): Promise<string | null> => ipcRenderer.invoke('fs:saveAs', defaultName, kind),
  chooseDir: (title: string): Promise<string | null> => ipcRenderer.invoke('fs:chooseDir', title),
  /** Compositor .comp 폴더 (경로를 주면 대화상자 없이) */
  openCompFolder: (path?: string): Promise<{ path: string; name: string; files: Record<string, Uint8Array> } | null> => ipcRenderer.invoke('fs:openCompFolder', path),
  recovery: {
    write: (id: string, meta: { name: string; path: string | null }, bytes: Uint8Array): Promise<void> => ipcRenderer.invoke('recovery:write', id, meta, bytes),
    list: (): Promise<{ id: string; name: string; path: string | null; savedAt: number }[]> => ipcRenderer.invoke('recovery:list'),
    read: (id: string): Promise<Uint8Array> => ipcRenderer.invoke('recovery:read', id),
    clear: (id: string): Promise<void> => ipcRenderer.invoke('recovery:clear', id)
  },
  write: (path: string, bytes: Uint8Array): Promise<string> => ipcRenderer.invoke('fs:write', path, bytes),
  showItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItem', path),
  /** 드롭한 File 의 실제 경로 (저장 위치 기억용) */
  pathOf: (file: File): string => webUtils.getPathForFile(file),
  clipboard: {
    writeImage: (png: Uint8Array): Promise<boolean> => ipcRenderer.invoke('clip:writeImage', png),
    readImage: (): Promise<Uint8Array | null> => ipcRenderer.invoke('clip:readImage')
  },
  win: {
    minimize: (): Promise<void> => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('win:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('win:close'),
    confirmClose: (): Promise<void> => ipcRenderer.invoke('win:confirmClose'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
    onMaximized: (cb: (maximized: boolean) => void): (() => void) => subscribe('win:maximized', cb),
    onCloseRequest: (cb: () => void): (() => void) => subscribe('win:closeRequest', cb)
  },
  pendingOpen: (): Promise<string[]> => ipcRenderer.invoke('app:pendingOpen'),
  onOpenFiles: (cb: (paths: string[]) => void): (() => void) => subscribe('app:openFiles', cb),
  /** AI 배경 제거 모델 에셋 베이스 URL */
  bgAssetsUrl: 'bgrm://assets/',
  /** 개체 선택(SlimSAM) 모델·ORT wasm 베이스 URL */
  samAssetsUrl: 'aimodel://assets/',
  onRecovered: (cb: (reason: string) => void): (() => void) => subscribe('app:recovered', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
