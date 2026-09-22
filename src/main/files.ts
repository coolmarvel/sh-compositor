import { join, relative, isAbsolute, resolve, dirname, basename, sep } from 'node:path'
import { writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
/** A sibling whose name starts with the root is outside the root too. */
export function assetPath(base: string, host: string, pathname: string): string | null {
  if (host !== 'assets') return null
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const root = resolve(base)
  const full = resolve(root, decoded.replace(/^[/\\]+/, ''))
  const rel = relative(root, full)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? null : full
}
/** Keep the previous file intact if writing the replacement fails. Temp file stays on the same volume. */
export async function writeAtomic(path: string, bytes: Uint8Array | string): Promise<void> {
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temp, bytes, { flag: 'wx' })
    await rename(temp, path)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
}
