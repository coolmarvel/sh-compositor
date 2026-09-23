/** 아주 작은 IndexedDB 키-값 저장소 (웹 복구본·파일 핸들). 실패는 호출측이 다룬다 */
const DB = 'sh-compositor'
const STORES = ['recovery', 'handles'] as const
type StoreName = (typeof STORES)[number]

let opening: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 를 열지 못했습니다.'))
  }).catch((e) => {
    opening = null
    throw e
  })
  return opening
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = tx.onabort = () => reject(tx.error ?? req.error ?? new Error('IndexedDB 작업이 실패했습니다.'))
      })
  )
}

export const idbGet = <T>(store: StoreName, key: string): Promise<T | undefined> => run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
export const idbPut = (store: StoreName, key: string, value: unknown): Promise<IDBValidKey> => run(store, 'readwrite', (s) => s.put(value, key))
export const idbDelete = (store: StoreName, key: string): Promise<undefined> => run(store, 'readwrite', (s) => s.delete(key))
export const idbKeys = (store: StoreName): Promise<IDBValidKey[]> => run(store, 'readonly', (s) => s.getAllKeys())

/** 용량 초과 — 사용자에게 저장 공간 부족으로 알린다 */
export const isQuotaError = (e: unknown): boolean => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
