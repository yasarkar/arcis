import { describe, expect, it } from 'vitest'
import {
  CIRCLE_UCW_BLOCKCHAIN_MAP,
  isCircleUcwChain,
  normalizeCircleBlockchain,
} from '../circleBlockchain'

describe('normalizeCircleBlockchain — shared fail-closed chain map', () => {
  it('resolves every whitelisted app chain key', () => {
    expect(normalizeCircleBlockchain('Arc_Testnet')).toBe('ARC-TESTNET')
    expect(normalizeCircleBlockchain('Base_Sepolia')).toBe('BASE-SEPOLIA')
    expect(normalizeCircleBlockchain('Ethereum_Sepolia')).toBe('ETH-SEPOLIA')
    expect(normalizeCircleBlockchain('Avalanche_Fuji')).toBe('AVAX-FUJI')
    expect(normalizeCircleBlockchain('Polygon_Amoy')).toBe('MATIC-AMOY')
  })

  it('is idempotent for already-canonical Circle identifiers', () => {
    // Callers hand canonical values back into the mapper (pools pass
    // 'ARC-TESTNET', Send passes 'ETH'/'BASE-SEPOLIA', ...). Those must pass
    // through unchanged instead of throwing or being rewritten.
    const values = new Set(Object.values(CIRCLE_UCW_BLOCKCHAIN_MAP))
    for (const value of values) {
      expect(normalizeCircleBlockchain(value)).toBe(value)
      expect(normalizeCircleBlockchain(value.toLowerCase())).toBe(value)
    }
    expect(normalizeCircleBlockchain('ETH-SEPOLIA')).toBe('ETH-SEPOLIA')
    expect(normalizeCircleBlockchain('ETH')).toBe('ETH')
    expect(normalizeCircleBlockchain('SOL-DEVNET')).toBe('SOL-DEVNET')
  })

  it('never rewrites a mainnet identifier to its testnet counterpart', () => {
    // Regression: the legacy substring heuristic mapped ETH → ETH-SEPOLIA.
    expect(normalizeCircleBlockchain('ETH')).not.toBe('ETH-SEPOLIA')
    expect(normalizeCircleBlockchain('BASE')).not.toBe('BASE-SEPOLIA')
    expect(normalizeCircleBlockchain('ARB')).not.toBe('ARB-SEPOLIA')
    expect(normalizeCircleBlockchain('OP')).not.toBe('OP-SEPOLIA')
  })

  it('throws for chains Circle UCW cannot sign on', () => {
    expect(() => normalizeCircleBlockchain('Unknown_Chain')).toThrow(/not supported/i)
    expect(() => normalizeCircleBlockchain('Unichain_Sepolia')).toThrow(/not supported/i)
    expect(() => normalizeCircleBlockchain('World_Chain_Sepolia')).toThrow(/not supported/i)
    expect(() => normalizeCircleBlockchain('HyperEVM_Testnet')).toThrow(/not supported/i)
    expect(() => normalizeCircleBlockchain('Sei_Testnet')).toThrow(/not supported/i)
    expect(() => normalizeCircleBlockchain('Sonic_Testnet')).toThrow(/not supported/i)
    expect(() => normalizeCircleBlockchain('Linea_Sepolia')).toThrow(/not supported/i)
  })

  it('keeps the documented empty default', () => {
    expect(normalizeCircleBlockchain()).toBe('ARC-TESTNET')
    expect(normalizeCircleBlockchain('')).toBe('ARC-TESTNET')
  })
})

describe('isCircleUcwChain', () => {
  it('flags exactly the Circle-UCW-capable chains', () => {
    expect(isCircleUcwChain('Arc_Testnet')).toBe(true)
    expect(isCircleUcwChain('Base_Sepolia')).toBe(true)
    expect(isCircleUcwChain('Unichain_Sepolia')).toBe(false)
    expect(isCircleUcwChain('Sei_Testnet')).toBe(false)
    expect(isCircleUcwChain(undefined)).toBe(false)
    expect(isCircleUcwChain('')).toBe(false)
  })
})
