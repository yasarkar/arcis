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
    BRIDGE_CUSTOM_FEE_CONFIG.enabled && BRIDGE_CUSTOM_FEE_CONFIG.minUsdc > 0

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

  it('correctly calculates dynamic volume fee with min floor (0.10) and max ceiling (1.00)', () => {
    // 50 USDC * 0.05% = 0.025 USDC -> Clamped to min 0.10 USDC
    expect(getBridgePlatformFeeValue(50)).toBe(0.10)
    // 100 USDC * 0.05% = 0.05 USDC -> Clamped to min 0.10 USDC
    expect(getBridgePlatformFeeValue(100)).toBe(0.10)
    // 200 USDC * 0.05% = 0.10 USDC -> Exactly min 0.10 USDC
    expect(getBridgePlatformFeeValue(200)).toBe(0.10)
    // 500 USDC * 0.05% = 0.25 USDC -> Linear range
    expect(getBridgePlatformFeeValue(500)).toBe(0.25)
    // 1000 USDC * 0.05% = 0.50 USDC -> Linear range
    expect(getBridgePlatformFeeValue(1000)).toBe(0.50)
    // 2000 USDC * 0.05% = 1.00 USDC -> Exactly max 1.00 USDC
    expect(getBridgePlatformFeeValue(2000)).toBe(1.00)
    // 5000 USDC * 0.05% = 2.50 USDC -> Clamped to max 1.00 USDC
    expect(getBridgePlatformFeeValue(5000)).toBe(1.00)
    // Empty / null amount defaults to min floor
    expect(getBridgePlatformFeeValue()).toBe(0.10)
  })

  it('formats display copy accurately with dynamic percentages and bounds', () => {
    const displayLow = getBridgePlatformFeeDisplay(50)
    expect(displayLow.amount).toBe('0.10 USDC')
    expect(displayLow.description).toContain('0.05%')
    expect(displayLow.description).toContain('Min 0.10 USDC')
    expect(displayLow.description).toContain('Max 1.00 USDC')

    const displayMid = getBridgePlatformFeeDisplay(500)
    expect(displayMid.amount).toBe('0.25 USDC')

    const displayHigh = getBridgePlatformFeeDisplay(5000)
    expect(displayHigh.amount).toBe('1.00 USDC')
  })
})
