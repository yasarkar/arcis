// api/__tests__/healthDisclosure.test.ts
// ARC-015: /api/health is unauthenticated, so the liveness body must stay free of internal
// configuration and the diagnostic body (relayer address/balance, integration flags, RPC host) must
// require HEALTH_CHECK_TOKEN — and must never be served when that secret is unset.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/rpc', () => ({
  getArcPublicClient: () => ({ getBlockNumber: async () => 42n }),
  resilientReadContract: vi.fn(async () => 0n),
}))

vi.mock('../_utils/rateLimiter', () => ({
  getRedisInstance: async () => null,
  isRedisConnected: () => false,
}))

import { GET } from '../health'

const PUBLIC_ONLY_KEYS = ['relayer', 'integrations', 'environment', 'networkMode']

function healthRequest(token?: string): Request {
  const headers: Record<string, string> = {}
  if (token !== undefined) headers['x-health-token'] = token
  return new Request('http://localhost/api/health', { headers })
}

beforeEach(() => {
  // Deterministic regardless of ambient CI env: no server signer key exists in these tests.
  vi.stubEnv('RELAYER_PRIVATE_KEY', '')
  vi.stubEnv('DISTRIBUTOR_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/health — public body', () => {
  it('answers liveness without leaking internal configuration', async () => {
    const res = await GET(healthRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('healthy')
    expect(typeof body.uptimeSeconds).toBe('number')
    expect(body.network).toEqual({ name: expect.any(String) })
    expect(body.rpc).toEqual({ connected: true, latencyMs: expect.any(Number) })

    for (const key of PUBLIC_ONLY_KEYS) expect(body).not.toHaveProperty(key)
    expect(body.network).not.toHaveProperty('chainId')
    expect(body.network).not.toHaveProperty('rpcHost')
    expect(body.rpc).not.toHaveProperty('blockNumber')
  })

  it('never serves diagnostics when HEALTH_CHECK_TOKEN is unset, even with a matching header', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', '')

    const body = await (await GET(healthRequest('anything'))).json()
    for (const key of PUBLIC_ONLY_KEYS) expect(body).not.toHaveProperty(key)
  })

  it('ignores a wrong or malformed token', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'expected-token-value')

    for (const attempt of ['wrong-token-value', 'expected', 'expected-token-value-longer']) {
      const body = await (await GET(healthRequest(attempt))).json()
      for (const key of PUBLIC_ONLY_KEYS) expect(body).not.toHaveProperty(key)
    }
  })
})

describe('GET /api/health — token-gated diagnostics', () => {
  it('serves the diagnostic body to a caller holding HEALTH_CHECK_TOKEN', async () => {
    vi.stubEnv('HEALTH_CHECK_TOKEN', 'expected-token-value')

    const res = await GET(healthRequest('expected-token-value'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.relayer).toMatchObject({ configured: false, address: null, balanceUsdc: '0.00', isFunded: false })
    expect(body.integrations).toEqual({ circleApi: expect.any(Boolean), aiCopilot: expect.any(Boolean), redisCache: false })
    expect(body.network.chainId).toBe(5042002)
    expect(body.network.rpcHost).toBeTruthy()
  })
})
