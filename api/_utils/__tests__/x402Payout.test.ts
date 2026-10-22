// api/_utils/__tests__/x402Payout.test.ts
// The treasury payout signer must belong to the configured treasury. Anything else is a refusal:
// a key that does not match the treasury address would move a different wallet's USDC.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { isX402PayoutConfigured, resolveX402TreasurySigner, sendProviderPayout } from '../x402Payout'
import { ARC_TESTNET_TOKENS } from '../../../src/config/arcChain'

const treasuryKey = generatePrivateKey()
const treasury = privateKeyToAccount(treasuryKey).address

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveX402TreasurySigner', () => {
  it('accepts a key that derives to the configured treasury address', () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    vi.stubEnv('X402_TREASURY_PRIVATE_KEY', treasuryKey)
    const signer = resolveX402TreasurySigner()
    expect('account' in signer && signer.account.address).toBe(treasury)
    expect(isX402PayoutConfigured()).toBe(true)
  })

  it('refuses a key that belongs to another wallet', () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    vi.stubEnv('X402_TREASURY_PRIVATE_KEY', generatePrivateKey())
    const signer = resolveX402TreasurySigner()
    expect('reason' in signer && signer.reason).toMatch(/does not belong/)
    expect(isX402PayoutConfigured()).toBe(false)
  })

  it('refuses a malformed key and a missing treasury', () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    vi.stubEnv('X402_TREASURY_PRIVATE_KEY', 'not-a-key')
    expect(isX402PayoutConfigured()).toBe(false)

    vi.stubEnv('X402_TREASURY_ADDRESS', '')
    vi.stubEnv('VITE_EVM_TREASURY_ADDRESS', ARC_TESTNET_TOKENS.USDC)
    vi.stubEnv('X402_TREASURY_PRIVATE_KEY', treasuryKey)
    const signer = resolveX402TreasurySigner()
    expect('reason' in signer && signer.reason).toMatch(/treasury address/)
  })
})

describe('sendProviderPayout', () => {
  it('refuses invalid amounts before touching the treasury', async () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    vi.stubEnv('X402_TREASURY_PRIVATE_KEY', treasuryKey)
    const result = await sendProviderPayout({ provider: treasury, amountMicros: 0 })
    expect(result.status).toBe('failed')
  })

  it('reports an unconfigured payout instead of broadcasting without a signer', async () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', '')
    vi.stubEnv('VITE_EVM_TREASURY_ADDRESS', '')
    const result = await sendProviderPayout({ provider: treasury, amountMicros: 5000 })
    expect(result.status).toBe('unconfigured')
  })
})
