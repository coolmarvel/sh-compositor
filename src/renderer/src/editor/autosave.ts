/**
 * 자동 저장·복구 — 저장 안 한 문서를 1분마다 userData/recovery 에 .shcomp 로 떠 둔다.
 * 앱이 비정상 종료되면 다음 실행 때 "복구할 문서" 대화상자로 되살린다. 저장하거나 닫으면 지운다.
 * (Compositor 는 macOS 문서 자동 저장에 기댄다 — Windows 에서는 우리가 직접.)
 */
import { editor } from './store'
import { packProject, type Doc } from '@core/index'

/** 이번 실행의 접두사 — 다른 실행(이전 크래시)의 복구본과 구별 */
export const SESSION = `s${Date.now().toString(36)}`
const INTERVAL = 60_000

const written = new Map<string, Doc>() // tabId → 마지막으로 떠 둔 문서
const rid = (tabId: string): string => `${SESSION}-${tabId}`

async function tick(): Promise<void> {
  const tabs = editor.state.tabs
  const alive = new Set(tabs.map((t) => t.id))
  for (const t of tabs) {
    const dirty = editor.isDirty(t)
    if (!dirty) {
      if (written.has(t.id)) {
        written.delete(t.id)
        await window.api.recovery.clear(rid(t.id)).catch(() => {})
      }
      continue
    }
    if (written.get(t.id) === t.history.present) continue
    try {
      await window.api.recovery.write(rid(t.id), { name: t.name, path: t.path }, packProject(t.history.present))
      written.set(t.id, t.history.present)
    } catch {
      /* 디스크 문제 — 다음 주기에 다시 */
    }
  }
  // 닫힌 탭의 복구본 정리
  for (const id of [...written.keys()])
    if (!alive.has(id)) {
      written.delete(id)
      await window.api.recovery.clear(rid(id)).catch(() => {})
    }
}

/** 지금 한 번 (E2E·종료 직전용) */
export const autosaveNow = tick

let timer: ReturnType<typeof setInterval> | null = null
export function startAutosave(): void {
  if (timer) return
  timer = setInterval(() => void tick(), INTERVAL)
}

/** 정상 종료 — 이번 실행의 복구본을 모두 지운다 (사용자가 "저장 안 함"을 고른 문서 포함) */
export async function clearSessionRecovery(): Promise<void> {
  for (const id of written.keys()) await window.api.recovery.clear(rid(id)).catch(() => {})
  written.clear()
}

/** 이전 실행이 남긴 복구본 (이번 실행 것 제외) */
export async function pendingRecovery(): Promise<{ id: string; name: string; path: string | null; savedAt: number }[]> {
  const list = await window.api.recovery.list().catch(() => [])
  return list.filter((r) => !r.id.startsWith(`${SESSION}-`))
}
