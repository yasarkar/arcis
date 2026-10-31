import { afterEach, describe, expect, it, vi } from 'vitest'
import { arePayoutAddressesConfirmed, auditManifestPayout, auditPayoutAddress } from '../payouts'
import { OFFICIAL_MANIFESTS } from '../manifests'

describe('x402 payout-address guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects the zero address and known token/Gateway contracts', () => {
    expect(auditPayoutAddress('0x0000000000000000000000000000000000000000').usable).toBe(false)
    expect(auditPayoutAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238').reason).toMatch(/USDC token/i)
    expect(auditPayoutAddress('0x0077777d7EBA4688BDeF3E311b846F25870A19B9').reason).toMatch(/Gateway Wallet/i)
  })

  it('accepts an ordinary EOA address', () => {
    expect(auditPayoutAddress('0x1111111111111111111111111111111111111111')).toEqual({ usable: true })
  })

  it('rejects a malformed address', () => {
    expect(auditPayoutAddress('not-an-address').usable).toBe(false)
    expect(auditPayoutAddress(undefined).usable).toBe(false)
  })

  it('verifies all official manifests have usable payout addresses', () => {
    const unusable = OFFICIAL_MANIFESTS.filter((manifest) => !auditManifestPayout(manifest).usable)
    expect(unusable).toEqual([])
    expect(auditManifestPayout({ provider: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' } }).usable).toBe(false)
    expect(auditManifestPayout({ provider: { address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' } }).usable).toBe(false)
  })

  it('requires an explicit operator confirmation before settlement may run', () => {
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', '')
    expect(arePayoutAddressesConfirmed()).toBe(false)
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', 'true')
    expect(arePayoutAddressesConfirmed()).toBe(true)
    vi.stubEnv('X402_PAYOUT_ADDRESSES_CONFIRMED', 'TRUE')
    expect(arePayoutAddressesConfirmed()).toBe(true)
  })
})
