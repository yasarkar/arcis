import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { GET } from '../x402'

import * as payoutsModule from '../../src/config/x402/payouts'

// Official services charge a fee and settle to the treasury, so the treasury gates below can only
// be reached (and asserted) when the treasury and its payout key are configured.
const treasuryKey = generatePrivateKey()
const treasuryAddress = privateKeyToAccount(treasuryKey).address

const CONFIG_URL = 'http://localhost:3000/api/x402/config'

async function readConfig() {
  const response = await GET(new Request(CONFIG_URL, { headers: { Accept: 'application/json' } }))
  return { response, body: await response.json() }
}

describe('GET /api/x402/config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'false')
    vi.stubEnv('X402_TREASURY_ADDRESS', treasuryAddress)
    vi.stubEnv('X402_TREASURY_PRIVATE_KEY', treasuryKey)
    vi.stubEnv('X402_RECONCILIATION_SECRET', '')
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', 'false')
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('KV_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reports a disabled, process-local setup by default', async () => {
    const { response, body } = await readConfig()
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.settlementEnabled).toBe(false)
    expect(body.payoutsConfirmed).toBe(false)
    expect(body.payoutsReady).toBe(false)
    expect(body.storage).toEqual({ driver: 'memory', shared: false })
    expect(body.reconciliation.configured).toBe(false)
    expect(body.chainId).toBe(5042002)
  })

  it('reports all official services have usable payout addresses', async () => {
    const { body } = await readConfig()
    expect(body.payoutIssues).toEqual([])
  })

  it('reports an enabled setup with shared storage without leaking secrets', async () => {
    const secret = 'r'.repeat(48)
    const token = 'super-private-kv-token'
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'true')
    vi.stubEnv('KV_REST_API_URL', 'https://kv-stage.upstash.io')
    vi.stubEnv('KV_REST_API_TOKEN', token)
    vi.stubEnv('X402_RECONCILIATION_SECRET', secret)
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', 'true')

    const { response, body } = await readConfig()
    expect(response.status).toBe(200)
    expect(body.settlementEnabled).toBe(true)
    expect(body.payoutsConfirmed).toBe(true)
    expect(body.storage).toEqual({ driver: 'upstash-rest', shared: true })
    expect(body.reconciliation.configured).toBe(true)
    expect(body.payoutsReady).toBe(true)

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(token)
  })

  it('refuses a challenge when settlement is enabled but payouts are unconfirmed', async () => {
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'true')
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', 'false')
    const response = await GET(
      new Request('http://localhost:3000/api/x402/arc-cross-dex-arbitrage-sentinel')
    )
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('payout_addresses_unconfirmed')
  })

  it('refuses a challenge for a service with an unusable payout address', async () => {
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'true')
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', 'true')
    const spy = vi.spyOn(payoutsModule, 'auditManifestPayout').mockReturnValueOnce({
      usable: false,
      reason: 'Ethereum Sepolia USDC token contract',
    })
    const response = await GET(
      new Request('http://localhost:3000/api/x402/arc-cross-chain-gateway-flow-indexer')
    )
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('payout_address_unusable')
    expect(body.error).toMatch(/Sepolia USDC token contract/i)
    spy.mockRestore()
  })

  it('names the treasury as the payee and discloses the fee on a fee-bearing challenge', async () => {
    const response = await GET(
      new Request('http://localhost:3000/api/x402/arc-cross-dex-arbitrage-sentinel')
    )
    expect(response.status).toBe(402)
    expect(response.headers.get('X-Payment-Recipient')?.toLowerCase()).toBe(treasuryAddress.toLowerCase())
    const body = await response.json()
    expect(body.requirements.accepts[0].payTo).toBe(body.challenge.recipient)
    expect(body.challenge.recipient.toLowerCase()).toBe(treasuryAddress.toLowerCase())
    expect(body.challenge.protocolFeeBps).toBe(50)
    // 50 bps of the 0.005 USDC price.
    expect(body.challenge.feeUsdc).toBe(0.000025)
    expect(body.challenge.providerAddress.toLowerCase()).not.toBe(treasuryAddress.toLowerCase())
  })

  it('keeps the 402 probe unchanged while settlement is disabled', async () => {
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'false')
    const response = await GET(
      new Request('http://localhost:3000/api/x402/arc-cross-chain-gateway-flow-indexer')
    )
    expect(response.status).toBe(402)
    expect(response.headers.get('PAYMENT-REQUIRED')).toBeTruthy()
  })
})
