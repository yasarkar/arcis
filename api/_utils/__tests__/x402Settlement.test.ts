import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileSettlementByNonce } from '../x402Settlement'
import {
  kvCreateProviderSettlementIntent,
  kvGet,
  kvMarkProviderSettlementAccepted,
} from '../redisStorage'

let sequence = 0

function fixture() {
  sequence += 1
  const provider = `0x${sequence.toString(16).padStart(40, '0')}`
  const payer = `0x${(sequence + 1).toString(16).padStart(40, '0')}`
  const nonce = `0x${sequence.toString(16).padStart(64, '0')}`
  const transferId = `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`
  return {
    provider,
    payer,
    nonce,
    transferId,
    providerKey: `arcis:x402:provider:{${provider}}`,
    pendingKey: `arcis:x402:pending:{${provider}}:${nonce}`,
    nonceKey: `arcis:x402:nonce:{${provider}}:${nonce}`,
  }
}

async function seedPending(f: ReturnType<typeof fixture>) {
  const created = await kvCreateProviderSettlementIntent(f.providerKey, f.pendingKey, f.nonceKey, {
    providerAddress: f.provider,
    payerAddress: f.payer,
    serviceId: 'arc-test-service',
    amountMicros: 5000,
    amountUsdc: 0.005,
    nonce: f.nonce,
    status: 'settling' as const,
    createdAt: Date.now(),
  })
  expect(created).toBe('created')
  expect(await kvMarkProviderSettlementAccepted(f.providerKey, f.pendingKey, 'opaque-circle-ref')).toBe('pending')
}

function transferFor(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  return {
    nonce: f.nonce,
    status: 'confirmed',
    token: 'USDC',
    sendingNetwork: 'eip155:5042002',
    recipientNetwork: 'eip155:5042002',
    fromAddress: f.payer,
    toAddress: f.provider,
    amount: '0.005',
    id: f.transferId,
    txHash: `0x${'a'.repeat(64)}`,
    ...overrides,
  }
}

function stubCircle(transfers: unknown[]) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ transfers }),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('reconcileSettlementByNonce', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('KV_URL', '')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('credits the provider only on an exact transfer match, then answers idempotently', async () => {
    const f = fixture()
    await seedPending(f)
    const fetchMock = stubCircle([transferFor(f)])

    const result = await reconcileSettlementByNonce(f.provider, f.nonce)
    expect(result.status).toBe(200)
    expect(result.body.status).toBe('confirmed')
    expect(result.body.idempotent).toBe(false)
    expect(result.body.transferId).toBe(f.transferId)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const ledger = JSON.parse((await kvGet(f.providerKey)) || '{}')
    expect(ledger.pendingUsdc).toBe(0)
    expect(ledger.totalUsdcEarned).toBe(0.005)
    expect(ledger.unclaimedEarningsUsdc).toBe(0.005)

    const second = await reconcileSettlementByNonce(f.provider, f.nonce)
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ status: 'confirmed', idempotent: true, pendingUsdc: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses an amount mismatch and leaves the pending balance untouched', async () => {
    const f = fixture()
    await seedPending(f)
    stubCircle([transferFor(f, { amount: '0.006' })])

    const result = await reconcileSettlementByNonce(f.provider, f.nonce)
    expect(result.status).toBe(409)
    expect(result.body.error).toMatch(/does not exactly match/i)

    const ledger = JSON.parse((await kvGet(f.providerKey)) || '{}')
    expect(ledger.pendingUsdc).toBe(0.005)
    expect(ledger.unclaimedEarningsUsdc).toBe(0)
    expect(ledger.totalUsdcEarned).toBe(0)
  })

  it('refuses a transfer to a different provider', async () => {
    const f = fixture()
    await seedPending(f)
    stubCircle([transferFor(f, { toAddress: '0x9999999999999999999999999999999999999999' })])

    const result = await reconcileSettlementByNonce(f.provider, f.nonce)
    expect(result.status).toBe(409)
    const ledger = JSON.parse((await kvGet(f.providerKey)) || '{}')
    expect(ledger.pendingUsdc).toBe(0.005)
  })

  it('reports pending when Circle has no transfer for the nonce yet', async () => {
    const f = fixture()
    await seedPending(f)
    stubCircle([])

    const result = await reconcileSettlementByNonce(f.provider, f.nonce)
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ status: 'pending', transferFound: false, pendingUsdc: 0.005 })
  })

  it('rejects malformed identifiers without touching the network', async () => {
    const fetchMock = stubCircle([])
    expect((await reconcileSettlementByNonce('nope', '0x1234')).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown authorization', async () => {
    const f = fixture()
    stubCircle([])
    const result = await reconcileSettlementByNonce(f.provider, f.nonce)
    expect(result.status).toBe(404)
  })
})
