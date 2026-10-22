import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../x402'
import {
  kvConfirmPendingProviderSettlement,
  kvCreateProviderSettlementIntent,
  kvMarkProviderSettlementAccepted,
  kvUpdateProviderLedger,
} from '../_utils/redisStorage'

const PAYER = `0x${'3'.repeat(40)}`
const TRANSFER_ID = '11111111-1111-4111-8111-111111111111'

function providerKey(address: string): string {
  return `arcis:x402:provider:{${address.toLowerCase()}}`
}
function pendingKey(address: string, nonce: string): string {
  return `arcis:x402:pending:{${address.toLowerCase()}}:${nonce.toLowerCase()}`
}
function nonceKey(address: string, nonce: string): string {
  return `arcis:x402:nonce:{${address.toLowerCase()}}:${nonce.toLowerCase()}`
}

async function recordAcceptedCall(
  address: string,
  nonce: string,
  serviceId = 'arc-cross-dex-arbitrage-sentinel'
) {
  const created = await kvCreateProviderSettlementIntent(
    providerKey(address),
    pendingKey(address, nonce),
    nonceKey(address, nonce),
    {
      providerAddress: address.toLowerCase(),
      payerAddress: PAYER,
      serviceId,
      amountMicros: 5000,
      amountUsdc: 0.005,
      nonce: nonce.toLowerCase(),
      status: 'settling',
      createdAt: Date.now(),
    }
  )
  expect(created).toBe('created')
  const accepted = await kvMarkProviderSettlementAccepted(
    providerKey(address),
    pendingKey(address, nonce),
    'circle-transfer-ref'
  )
  expect(accepted).toBe('pending')
}

async function readLedger(address: string) {
  const response = await GET(
    new Request(`http://localhost:3000/api/x402/provider/${address}`, {
      headers: { Accept: 'application/json' },
    })
  )
  return { response, body: await response.json() }
}

describe('GET /api/x402/provider/:address', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('KV_URL', '')
    vi.stubEnv('VERCEL_ENV', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns wallet-wide totals together with the per-service row', async () => {
    const provider = `0x${'1'.repeat(40)}`
    await recordAcceptedCall(provider, `0x${'a'.repeat(64)}`)

    const { response, body } = await readLedger(provider)
    expect(response.status).toBe(200)
    expect(body.ledger.totalCallsServed).toBe(1)
    expect(body.ledger.totalUsdcEarned).toBe(0)
    expect(body.ledger.pendingUsdc).toBe(0.005)
    expect(body.ledger.services).toEqual([
      {
        serviceId: 'arc-cross-dex-arbitrage-sentinel',
        callsServed: 1,
        grossUsdc: 0,
        pendingUsdc: 0.005,
      },
    ])
  })

  it('moves the per-service amount from pending to earned on confirmation', async () => {
    const provider = `0x${'6'.repeat(40)}`
    const nonce = `0x${'d'.repeat(64)}`
    await recordAcceptedCall(provider, nonce)

    const confirmed = await kvConfirmPendingProviderSettlement(
      providerKey(provider),
      pendingKey(provider, nonce),
      TRANSFER_ID,
      undefined
    )
    expect(confirmed).toBe('confirmed')

    const { body } = await readLedger(provider)
    expect(body.ledger.totalUsdcEarned).toBe(0.005)
    expect(body.ledger.services[0]).toMatchObject({
      callsServed: 1,
      grossUsdc: 0.005,
      pendingUsdc: 0,
    })
  })

  it('attributes calls to each service separately and sorts by call count', async () => {
    const provider = `0x${'7'.repeat(40)}`
    await recordAcceptedCall(provider, `0x${'e'.repeat(64)}`, 'svc-alpha')
    await recordAcceptedCall(provider, `0x${'f'.repeat(64)}`, 'svc-beta')
    await recordAcceptedCall(provider, `0x${'1'.repeat(63)}7`, 'svc-beta')

    const { body } = await readLedger(provider)
    expect(body.ledger.totalCallsServed).toBe(3)
    expect(body.ledger.services).toEqual([
      { serviceId: 'svc-beta', callsServed: 2, grossUsdc: 0, pendingUsdc: 0.01 },
      { serviceId: 'svc-alpha', callsServed: 1, grossUsdc: 0, pendingUsdc: 0.005 },
    ])
  })

  it('keeps the breakdown when a wallet-wide withdrawal adjusts the ledger', async () => {
    const provider = `0x${'8'.repeat(40)}`
    const nonce = `0x${'2'.repeat(63)}a`
    await recordAcceptedCall(provider, nonce)
    await kvConfirmPendingProviderSettlement(
      providerKey(provider),
      pendingKey(provider, nonce),
      TRANSFER_ID,
      undefined
    )

    const withdrawal = await kvUpdateProviderLedger(providerKey(provider), { withdrawMicros: 1000 })
    expect(withdrawal.status).toBe('updated')

    const { body } = await readLedger(provider)
    expect(body.ledger.withdrawnUsdc).toBe(0.001)
    expect(body.ledger.services[0]).toMatchObject({
      serviceId: 'arc-cross-dex-arbitrage-sentinel',
      callsServed: 1,
      grossUsdc: 0.005,
    })
  })

  it('keeps each provider wallet scoped to its own calls', async () => {
    const own = `0x${'4'.repeat(40)}`
    const other = `0x${'5'.repeat(40)}`
    await recordAcceptedCall(own, `0x${'c'.repeat(64)}`)

    expect((await readLedger(other)).body.ledger.totalCallsServed).toBe(0)
    expect((await readLedger(other)).body.ledger.services).toEqual([])
    expect((await readLedger(own)).body.ledger.totalCallsServed).toBe(1)
  })

  it('rejects an address that is not a wallet', async () => {
    const { response } = await readLedger('not-an-address')
    expect(response.status).toBe(400)
  })
})
