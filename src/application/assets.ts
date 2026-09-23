/**
 * 자산 저장소 — 업로드한 입력과 내보낸 결과 바이트. 소유자·만료 시각을 함께 둔다.
 * 이미지 원문을 도구 인자(base64)로 반복 전달하지 않도록 별도 업로드 경로가 assetId 를 발급한다 (plans/0004 §5).
 */
import { newToken } from './repository'

export interface Asset {
  readonly id: string
  readonly owner: string
  readonly kind: 'upload' | 'artifact'
  readonly name: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly createdAt: number
  readonly expiresAt: number
  /** 결과 자산이면 만든 문서·revision */
  readonly source?: { docId: string; revision: number; format: string }
}
export type AssetInfo = Omit<Asset, 'bytes' | 'owner'> & { size: number }

export interface AssetStore {
  put(a: Omit<Asset, 'id'>): Asset
  get(id: string): Asset | null
  delete(id: string): boolean
  bytesByOwner(owner: string): number
  sweep(now: number): string[]
}

export const assetInfo = (a: Asset): AssetInfo => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  mediaType: a.mediaType,
  size: a.bytes.byteLength,
  createdAt: a.createdAt,
  expiresAt: a.expiresAt,
  ...(a.source ? { source: a.source } : {})
})

export class MemoryAssetStore implements AssetStore {
  private assets = new Map<string, Asset>()
  put(a: Omit<Asset, 'id'>): Asset {
    const asset = { ...a, id: newToken('asset') }
    this.assets.set(asset.id, asset)
    return asset
  }
  get(id: string): Asset | null {
    return this.assets.get(id) ?? null
  }
  delete(id: string): boolean {
    return this.assets.delete(id)
  }
  bytesByOwner(owner: string): number {
    let n = 0
    for (const a of this.assets.values()) if (a.owner === owner) n += a.bytes.byteLength
    return n
  }
  sweep(now: number): string[] {
    const gone = [...this.assets.values()].filter((a) => a.expiresAt <= now).map((a) => a.id)
    for (const id of gone) this.assets.delete(id)
    return gone
  }
}
