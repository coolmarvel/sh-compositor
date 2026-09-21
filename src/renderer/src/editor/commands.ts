/**
 * 명령 등록소 — 캔버스가 가진 것(도구 확정·취소, 화면 맞춤)을 메뉴·도구 헤더·단축키가 부를 수 있게.
 * React 트리 밖에서 이름으로 부른다 (CanvasView 가 마운트될 때 등록).
 */
const registry = new Map<string, () => void>()

export type CanvasCommand = 'toolCommit' | 'toolCancel' | 'fit' | 'actualSize' | 'zoomIn' | 'zoomOut' | 'redraw'

export function registerCommands(cmds: Partial<Record<CanvasCommand, () => void>>): () => void {
  for (const [k, fn] of Object.entries(cmds)) registry.set(k, fn as () => void)
  return () => {
    for (const k of Object.keys(cmds)) registry.delete(k)
  }
}

export function runCommand(name: CanvasCommand): void {
  registry.get(name)?.()
}
