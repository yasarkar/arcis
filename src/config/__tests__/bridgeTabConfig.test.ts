import { describe, it, expect } from 'vitest'
import {
  BRIDGE_SELECTABLE_CHAINS,
  BRIDGE_CHAIN_META,
  getBridgeChainDisplayName,
} from '../bridgeConfig'
import { isSolanaChain } from '../chainMeta'
import { GATEWAY_SUPPORTED_CHAINS } from '../gatewayConfig'
import {
  BRIDGE_CUSTOM_FEE_CONFIG,
  isBridgePlatformFeeCharged,
  getBridgePlatformFeeValue,
  getBridgePlatformFeeDisplay,
} from '../fees'

describe('BRIDGE_SELECTABLE_CHAINS', () => {
  it('never offers Solana on the Bridge route selectors', () => {
    expect(BRIDGE_SELECTABLE_CHAINS.length).toBeGreaterThan(0)
    expect(BRIDGE_SELECTABLE_CHAINS.some((chainKey) => isSolanaChain(chainKey))).toBe(false)
    expect(BRIDGE_SELECTABLE_CHAINS).not.toContain('Solana_Devnet')
    expect(BRIDGE_SELECTABLE_CHAINS).not.toContain('Solana')
  })

  it('is a strict subset of the Gateway-supported chains', () => {
    for (const chainKey of BRIDGE_SELECTABLE_CHAINS) {
      expect(GATEWAY_SUPPORTED_CHAINS).toContain(chainKey)
    }
    // Solana exists upstream but is filtered only for the Bridge tab.
    expect(GATEWAY_SUPPORTED_CHAINS.length).toBeGreaterThan(BRIDGE_SELECTABLE_CHAINS.length - 1)
  })

  it('only offers chains that render in the selector (meta + display name)', () => {
    for (const chainKey of BRIDGE_SELECTABLE_CHAINS) {
      expect(BRIDGE_CHAIN_META[chainKey]).toBeTruthy()
      expect(getBridgeChainDisplayName(chainKey)).toBeTruthy()
    }
  })
})

describe('bridge platform fee single source of truth', () => {
  const configured =
    BRIDGE_CUSTOM_FEE_CONFIG.enabled && parseFloat(BRIDGE_CUSTOM_FEE_CONFIG.value) > 0

  it('charges only on the Direct CCTP path with a non-UCW signer', () => {
    expect(isBridgePlatformFeeCharged({ bridgeMode: 'direct', authSource: 'evm' })).toBe(configured)
    expect(isBridgePlatformFeeCharged({ bridgeMode: 'direct', authSource: 'passkey' })).toBe(
      configured
    )
  })

  it('never charges where the execution path cannot collect it', () => {
    expect(isBridgePlatformFeeCharged({ bridgeMode: 'direct', authSource: 'ucw' })).toBe(false)
    expect(isBridgePlatformFeeCharged({ bridgeMode: 'gateway', authSource: 'evm' })).toBe(false)
    expect(isBridgePlatformFeeCharged({ bridgeMode: 'gateway', authSource: 'ucw' })).toBe(false)
    expect(isBridgePlatformFeeCharged({ bridgeMode: 'direct', authSource: null })).toBe(configured)
  })

  it('shows exactly the configured per-speed fee (never the published per-tier schedule)', () => {
    const standard = getBridgePlatformFeeDisplay('standard')
    const fast = getBridgePlatformFeeDisplay('fast')

    if (configured) {
      expect(standard.amount).toBe(
        `${parseFloat(BRIDGE_CUSTOM_FEE_CONFIG.values.standard).toFixed(2)} USDC`
      )
      expect(fast.amount).toBe(
        `${parseFloat(BRIDGE_CUSTOM_FEE_CONFIG.values.fast).toFixed(2)} USDC`
      )
    } else {
      expect(standard.amount).toBe('Free')
      expect(fast.amount).toBe('Free')
    }
    expect(standard.description.length).toBeGreaterThan(0)
    expect(fast.description.length).toBeGreaterThan(0)
  })

  it('loads the configured 0.25 / 0.50 / 1.00 speed ladder from the environment', () => {
    // Guards the env plumbing: if the per-tier vars stop loading, every surface
    // silently falls back to the flat fee.
    expect(BRIDGE_CUSTOM_FEE_CONFIG.values.standard).toBe('0.25')
    expect(BRIDGE_CUSTOM_FEE_CONFIG.values.fast).toBe('0.50')
    expect(BRIDGE_CUSTOM_FEE_CONFIG.values.turbo).toBe('1.00')
  })

  it('prices the Turbo (fastest Direct CCTP) rung at its configured value', () => {
    // Turbo is a Direct tier carrying its own platform fee — not a synonym for
    // the Gateway route — so its row must quote the configured 1.00 USDC.
    const turbo = getBridgePlatformFeeDisplay('turbo')
    if (configured) {
      expect(turbo.amount).toBe(
        `${parseFloat(BRIDGE_CUSTOM_FEE_CONFIG.values.turbo).toFixed(2)} USDC`
      )
      expect(turbo.description).toContain('Direct CCTP')
      expect(turbo.description).toContain('Gateway routes are free')
    } else {
      expect(turbo.amount).toBe('Free')
    }
  })

  it('exposes the per-speed ladder the execution path charges', () => {
    const enabled = BRIDGE_CUSTOM_FEE_CONFIG.enabled
    const expected = (tier: 'standard' | 'fast' | 'turbo') =>
      enabled ? parseFloat(BRIDGE_CUSTOM_FEE_CONFIG.values[tier]) : 0

    expect(getBridgePlatformFeeValue('standard')).toBe(expected('standard'))
    expect(getBridgePlatformFeeValue('fast')).toBe(expected('fast'))
    expect(getBridgePlatformFeeValue('turbo')).toBe(expected('turbo'))

    // Display and charge read the same rung for the Direct CCTP tiers.
    if (getBridgePlatformFeeValue('standard') > 0) {
      expect(getBridgePlatformFeeDisplay('standard').amount).toBe(
        `${getBridgePlatformFeeValue('standard').toFixed(2)} USDC`
      )
    }
    if (getBridgePlatformFeeValue('fast') > 0) {
      expect(getBridgePlatformFeeDisplay('fast').amount).toBe(
        `${getBridgePlatformFeeValue('fast').toFixed(2)} USDC`
      )
    }
  })
})
