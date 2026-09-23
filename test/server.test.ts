import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTokens, loadConfig } from '../src/server/config'
import { TokenAuth } from '../src/server/auth'
import { principalFromAuth } from '../src/server/mcp'

const long = (c: string) => c.repeat(40)

test('server tokens: owners, scopes and weak secrets are validated', () => {
  const list = parseTokens({ SHC_TOKENS: `alice:${long('a')}; bob:${long('b')}:read` })
  assert.deepEqual(
    list.map((t) => [t.owner, t.scopes]),
    [
      ['alice', ['documents:read', 'documents:write']],
      ['bob', ['documents:read']]
    ]
  )
  assert.throws(() => parseTokens({ SHC_TOKENS: 'alice:short' }), /32/)
  assert.throws(() => parseTokens({ SHC_TOKENS: `a b:${long('a')}` }), /owner/)
  // 알 수 없는 scope·토큰 속 ':' 는 쓰기 권한으로 새지 않고 거절된다
  assert.throws(() => parseTokens({ SHC_TOKENS: `alice:${long('a')}:readonly` }), /scope/)
  assert.throws(() => parseTokens({ SHC_TOKENS: `alice:${long('a')}:x:y` }), /형식/)
  const cfg = loadConfig({ SHC_TOKENS: `alice:${long('a')}`, SHC_MAX_UPLOAD_MB: '2', SHC_JOB_TIMEOUT_MS: '1000', SHC_PORT: '9000' })
  assert.equal(cfg.limits.maxUploadBytes, 2 * 1024 * 1024)
  assert.equal(cfg.limits.jobTimeoutMs, 1000)
  assert.equal(cfg.publicUrl, 'http://127.0.0.1:9000')
  assert.throws(() => loadConfig({ SHC_PORT: 'abc' }), /숫자/)
})

test('bearer auth maps only exact tokens to principals; MCP ignores caller-supplied identity', () => {
  const auth = new TokenAuth(parseTokens({ SHC_TOKENS: `alice:${long('a')}; bob:${long('b')}:read` }))
  assert.equal(auth.verify(`Bearer ${long('a')}`)?.owner, 'alice')
  assert.deepEqual(auth.verify(`Bearer ${long('b')}`)?.scopes, ['documents:read'])
  assert.equal(auth.verify(`Bearer ${long('a')}x`), null)
  assert.equal(auth.verify(long('a')), null)
  assert.equal(auth.verify(undefined), null)
  const p = principalFromAuth({ token: 'x', clientId: 'alice', scopes: ['documents:read', 'admin'] })
  assert.deepEqual(p, { owner: 'alice', scopes: ['documents:read'] })
  assert.throws(() => principalFromAuth(undefined), /인증/)
})
