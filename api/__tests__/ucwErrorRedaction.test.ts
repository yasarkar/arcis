// api/__tests__/ucwErrorRedaction.test.ts
// ARC-022: a failed UCW call must not write Circle's body — or the account e-mail / userToken it
// carries — into the server log. These tests pin the redactor itself, the shape of the log entry,
// and the end-to-end catch-all path in api/ucw.ts (which used to `JSON.stringify` the body).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { circleErrorForLog, redactCircleErrorPayload } from '../_utils/circleError'

vi.mock('../_utils/rateLimiter', () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  getRedisInstance: async () => null,
  isRedisConnected: () => false,
}))

const sdkFailure = {
  response: {
    status: 400,
    data: {
      code: 155106,
      message: 'User alice@example.com is not initialized',
      userToken: 'user-token-secret-value',
      email: 'alice@example.com',
      deviceToken: 'device-token-secret-value',
      encryptionKey: 'encryption-key-secret-value',
      walletId: 'wallet-123',
      nested: { userToken: 'nested-secret', ok: 'visible' },
    },
  },
  message: 'Circle request failed',
}

vi.mock('@circle-fin/user-controlled-wallets', () => ({
  initiateUserControlledWalletsClient: () => ({
    listWallets: async () => {
      throw sdkFailure
    },
  }),
}))

import { POST } from '../ucw'

const SECRETS = [
  'user-token-secret-value',
  'device-token-secret-value',
  'encryption-key-secret-value',
  'nested-secret',
  'alice@example.com',
]

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('CIRCLE_API_KEY', 'test-circle-key')
  vi.stubEnv('UCW_SESSION_SECRET', 'test-ucw-session-secret')
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  errorSpy.mockRestore()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function loggedText(): string {
  const calls = errorSpy.mock.calls as unknown[][]
  return calls
    .map((call: unknown[]) => call.map((part: unknown) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' '))
    .join('\n')
}

describe('redactCircleErrorPayload', () => {
  it('masks credentials and e-mail fields while keeping diagnostics', () => {
    const redacted = redactCircleErrorPayload(sdkFailure.response.data) as Record<string, unknown>

    expect(redacted.code).toBe(155106)
    expect(redacted.walletId).toBe('wallet-123')
    expect(redacted.userToken).toBe('[REDACTED]')
    expect(redacted.email).toBe('[REDACTED]')
    expect(redacted.deviceToken).toBe('[REDACTED]')
    expect(redacted.encryptionKey).toBe('[REDACTED]')
    expect((redacted.nested as Record<string, unknown>).userToken).toBe('[REDACTED]')
    expect((redacted.nested as Record<string, unknown>).ok).toBe('visible')
  })

  it('scrubs an e-mail embedded in a free-text field', () => {
    const redacted = redactCircleErrorPayload({ message: 'no user alice@example.com' }) as Record<string, unknown>
    expect(String(redacted.message)).not.toContain('alice@example.com')
    expect(String(redacted.message)).toContain('[REDACTED_EMAIL]')
  })

  it('bounds depth, array length and string length', () => {
    const deep = { a: { b: { c: { d: { e: 'too deep' } } } } }
    expect(JSON.stringify(redactCircleErrorPayload(deep))).toContain('[DEPTH_LIMIT]')

    const long = redactCircleErrorPayload({ items: Array.from({ length: 25 }, (_, i) => i) }) as any
    expect(long.items).toHaveLength(11)
    expect(long.items[10]).toBe('[+15 more]')

    const huge = redactCircleErrorPayload({ message: 'x'.repeat(1000) }) as any
    expect(huge.message.endsWith('…[truncated]')).toBe(true)
    expect(huge.message.length).toBeLessThan(400)
  })
})

describe('circleErrorForLog', () => {
  it('keeps code/status/message and redacts the provider body', () => {
    const entry = circleErrorForLog(sdkFailure)
    const serialized = JSON.stringify(entry)

    expect(entry.code).toBe(155106)
    expect(entry.status).toBe(400)
    expect(serialized).toContain('[REDACTED]')
    for (const secret of SECRETS) expect(serialized).not.toContain(secret)
  })

  it('never returns the raw error object', () => {
    const entry = circleErrorForLog(sdkFailure)
    expect(entry).not.toHaveProperty('response')
    expect(Object.keys(entry).sort()).toEqual(['code', 'message', 'responseData', 'status'])
  })

  it('survives a non-Error rejection', () => {
    expect(circleErrorForLog('boom').message).toBe('boom')
    expect(circleErrorForLog(undefined).message).toBeTruthy()
  })
})

describe('POST /api/ucw — provider failure path', () => {
  it('logs only the redacted entry when Circle rejects the call', async () => {
    const response = await POST(
      new Request('http://localhost/api/ucw?action=getUserWallets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userToken: 'user-token-secret-value' }),
      })
    )

    expect(response.status).toBe(500)
    const text = loggedText()
    // The body was actually logged (so the fix did not just silence the failure) …
    expect(text).toContain('[UCW API Error]')
    expect(text).toContain('155106')
    // … and no credential or e-mail survived.
    for (const secret of SECRETS) expect(text).not.toContain(secret)

    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain('alice@example.com')
    expect(JSON.stringify(body)).not.toContain('user-token-secret-value')
  })
})

describe('api/ucw.ts log sites', () => {
  it('routes every console.warn/error through the redactor', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'api/ucw.ts'), 'utf8')
    const logLines = source.split('\n').filter((line) => /console\.(warn|error)\(/.test(line))

    expect(logLines.length).toBeGreaterThan(0)
    for (const line of logLines) expect(line).toMatch(/circleErrorForLog\(|safeError/)
    expect(source).toContain('const safeError = circleErrorForLog(error)')
    expect(source).not.toContain('JSON.stringify(error.response.data')
    expect(source).not.toContain('err?.response?.data,\n')
  })
})
