// src/config/x402/__tests__/treasury.test.ts
// The fee-bearing settlement route: who receives a paid call, and when it must refuse.
//
// One EIP-3009 authorization names one payee, so a fee cannot be taken from a payment that already
// pays the provider. These tests pin the rule the tollgate, the buyer and the withdraw endpoint share.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { resolveSettlementRoute, resolveX402TreasuryAddress } from '../treasury'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import { OFFICIAL_MANIFESTS } from '../manifests'

const treasuryKey = generatePrivateKey()
const treasury = privateKeyToAccount(treasuryKey).address
// An official manifest whose provider address is not checksummed (viem's strict isAddress rejects it).
const manifest = OFFICIAL_MANIFESTS[0]
const provider = getAddress(manifest.provider.address.toLowerCase())

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('X402_TREASURY_ADDRESS', '')
  vi.stubEnv('VITE_EVM_TREASURY_ADDRESS', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveSettlementRoute', () => {
  it('pays the provider directly when the service charges no fee', () => {
    const route = resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: 0 } })
    expect(route).toEqual({ payTo: provider, feeBps: 0 })
  })

  it('routes a fee-bearing call to the treasury', () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    const route = resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: 50 } })
    expect(route).toEqual({ payTo: getAddress(treasury.toLowerCase()), feeBps: 50 })
    expect(route?.payTo.toLowerCase()).not.toBe(provider.toLowerCase())
  })

  it('falls back to the protocol treasury already configured for the rest of the app', () => {
    vi.stubEnv('VITE_EVM_TREASURY_ADDRESS', treasury)
    expect(resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: 50 } })?.payTo).toBe(
      getAddress(treasury.toLowerCase())
    )
  })

  it('refuses a fee-bearing call when no usable treasury exists', () => {
    expect(resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: 50 } })).toBeNull()
    // A token contract could never pay a provider out of the collected fees.
    vi.stubEnv('X402_TREASURY_ADDRESS', ARC_TESTNET_TOKENS.USDC)
    expect(resolveX402TreasuryAddress()).toBeNull()
    expect(resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: 50 } })).toBeNull()
  })

  it('clamps an out-of-range fee instead of computing a negative payout', () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    expect(resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: -10 } })).toEqual({
      payTo: provider,
      feeBps: 0,
    })
    expect(resolveSettlementRoute({ provider: { address: manifest.provider.address }, pricing: { protocolFeeBps: 20_000 } })?.feeBps).toBe(10_000)
  })

  it('refuses a manifest whose provider address is not an address', () => {
    vi.stubEnv('X402_TREASURY_ADDRESS', treasury)
    expect(resolveSettlementRoute({ provider: { address: 'not-an-address' }, pricing: { protocolFeeBps: 50 } })).toBeNull()
  })
})
