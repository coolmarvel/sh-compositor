import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assetPath, writeAtomic } from '../src/main/files'
test('asset path rejects sibling prefixes, traversal, foreign hosts and malformed escapes', () => {
  const base = join(tmpdir(), 'models')
  assert.equal(assetPath(base, 'assets', '/a/b.wasm'), join(base, 'a', 'b.wasm'))
  for (const path of ['/../models-copy/secret', '/%2e%2e%2fprivate', '/%zz', '/%00']) assert.equal(assetPath(base, 'assets', path), null)
  assert.equal(assetPath(base, 'elsewhere', '/a'), null)
})
test('atomic write replaces a file and cleans temporary files when replacement fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sc-write-'))
  try {
    const file = join(dir, 'document')
    await writeAtomic(file, 'old')
    await writeAtomic(file, 'new')
    assert.equal(await readFile(file, 'utf8'), 'new')
    const target = join(dir, 'directory')
    await mkdir(target)
    await writeAtomic(join(target, 'keep'), 'original')
    await assert.rejects(writeAtomic(target, 'fail'))
    assert.equal(await readFile(join(target, 'keep'), 'utf8'), 'original')
    assert.deepEqual((await readdir(dir)).sort(), ['directory', 'document'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
