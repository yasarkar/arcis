import { describe, expect, it } from 'vitest'
import {
  isCircleUcwChain,
  normalizeCircleBlockchain,
} from '../../utils/circleBlockchain'
import { gatewayMaxFeeUsdc } from '../../utils/bridgeAmountUtils'

describe('normalizeCircleBlockchain fail-closed mapping (critical fix #2)', () => {
  it('keeps resolving every whitelisted chain correctly', () => {
    expect(normalizeCircleBlockchain('Arc_Testnet')).toBe('ARC-TESTNET')
    expect(normalizeCircleBlockchain('Base_Sepolia')).toBe('BASE-SEPOLIA')
    expect(normalizeCircleBlockchain('Ethereum_Sepolia')).toBe('ETH-SEPOLIA')
    expect(normalizeCircleBlockchain('Arbitrum_Sepolia')).toBe('ARB-SEPOLIA')
    expect(normalizeCircleBlockchain('Optimism_Sepolia')).toBe('OP-SEPOLIA')
    expect(normalizeCircleBlockchain('Avalanche_Fuji')).toBe('AVAX-FUJI')
    expect(normalizeCircleBlockchain('Polygon_Amoy_Testnet')).toBe('MATIC-AMOY')
    expect(normalizeCircleBlockchain('Polygon_Amoy')).toBe('MATIC-AMOY')
  })

  it('keeps the documented empty/undefined default', () => {
    expect(normalizeCircleBlockchain()).toBe('ARC-TESTNET')
    expect(normalizeCircleBlockchain('')).toBe('ARC-TESTNET')
  })

  it('still tolerates display-style inputs via key canonicalization', () => {
    expect(normalizeCircleBlockchain('Arc Testnet')).toBe('ARC-TESTNET')
    expect(normalizeCircleBlockchain('base sepolia')).toBe('BASE-SEPOLIA')
  })

  it('never guesses a substitute chain for unknown networks', () => {
    // regression: these used to collapse into ETH-SEPOLIA (wrong-chain transfer risk)
    expect(() => normalizeCircleBlockchain('Unichain_Sepolia')).toThrow()
    expect(() => normalizeCircleBlockchain('World_Chain_Sepolia')).toThrow()
    expect(() => normalizeCircleBlockchain('Linea_Sepolia')).toThrow()
    expect(() => normalizeCircleBlockchain('HyperEVM_Testnet')).toThrow()
    expect(() => normalizeCircleBlockchain('Sei_Testnet')).toThrow()
    expect(() => normalizeCircleBlockchain('Sonic_Testnet')).toThrow()
  })

  it('flags exactly the Circle-UCW-capable chains', () => {
    expect(isCircleUcwChain('Arc_Testnet')).toBe(true)
    expect(isCircleUcwChain('Base_Sepolia')).toBe(true)
    expect(isCircleUcwChain('Unichain_Sepolia')).toBe(false)
    expect(isCircleUcwChain('HyperEVM_Testnet')).toBe(false)
    expect(isCircleUcwChain(undefined)).toBe(false)
  })
})

describe('gatewayMaxFeeUsdc — Circle amount + maxFee rule (critical fix #3)', () => {
  it('applies the 1.0 USDC minimum maxFee floor', () => {
    expect(gatewayMaxFeeUsdc(0)).toBe(1)
    expect(gatewayMaxFeeUsdc(50)).toBe(1)
    expect(gatewayMaxFeeUsdc(10000)).toBe(1) // 0.50 + 0.05 is still below the floor
  })

  it('scales past the floor with the 0.005% fee + 0.05 gas buffer', () => {
    expect(gatewayMaxFeeUsdc(20000)).toBeCloseTo(1.05, 6)
    expect(gatewayMaxFeeUsdc(100000)).toBeCloseTo(5.05, 6)
  })

  it('matches the source-domain requirement amount + maxFee', () => {
    expect(100 + gatewayMaxFeeUsdc(100)).toBe(101)
  })
})
