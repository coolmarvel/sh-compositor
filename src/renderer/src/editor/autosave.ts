/**
 * 자동 저장·복구 — 저장 안 한 문서를 1분마다 userData/recovery 에 .shcomp 로 떠 둔다.
 * 앱이 비정상 종료되면 다음 실행 때 "복구할 문서" 대화상자로 되살린다. 저장하거나 닫으면 지운다.
 * (Compositor 는 macOS 문서 자동 저장에 기댄다 — Windows 에서는 우리가 직접.)
 */
import { editor } from './store'
import { type Doc } from '@core/index'
import { packDoc } from './pack'
import { RecoveryWriter } from '../util/recoveryWriter'

/** 이번 실행의 접두사 — 다른 실행(이전 크래시)의 복구본과 구별 */
export const SESSION = `s${Date.now().toString(36)}`
const INTERVAL = 60_000

const rid = (tabId: string): string => `${SESSION}-${tabId}`
const writer = new RecoveryWriter<Doc>(
  () => editor.state.tabs.map((t) => ({ id: t.id, name: t.name, path: t.path, doc: t.history.present, dirty: editor.isDirty(t) })),
  async (doc) => (await packDoc(doc, 'shcomp')).bytes,
  (t, bytes) => window.api.recovery.write(rid(t.id), { name: t.name, path: t.path }, bytes),
  (id) => window.api.recovery.clear(rid(id))
)
export const autosaveNow = (): Promise<void> => writer.run()
/** One subscription and timer per mount; React StrictMode cleanup is supported. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setInterval> | null = null
  let minutes = -1
  const apply = (): void => {
    const m = editor.state.settings.autosaveMinutes
    if (m === minutes) return
    minutes = m
    if (timer) clearInterval(timer)
    timer = m > 0 ? setInterval(() => void autosaveNow(), m * INTERVAL) : null
  }
  apply()
  const unsubscribe = editor.subscribe(apply)
  return () => {
    unsubscribe()
    if (timer) clearInterval(timer)
  }
}
/** Wait for an in-flight write before clearing this session's recovery files. */
export const clearSessionRecovery = (): Promise<void> => writer.shutdown()

/** 이전 실행이 남긴 복구본 (이번 실행 것 제외) */
export async function pendingRecovery(): Promise<{ id: string; name: string; path: string | null; savedAt: number }[]> {
  const list = await window.api.recovery.list().catch(() => [])
  return list.filter((r) => !r.id.startsWith(`${SESSION}-`))
}
