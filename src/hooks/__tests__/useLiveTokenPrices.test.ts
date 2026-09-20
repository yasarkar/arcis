import { describe, it, expect } from 'vitest'
import { formatFiatEstimate } from '../useLiveTokenPrices'

describe('formatFiatEstimate', () => {
  it('returns undefined for empty, zero, negative, or invalid amounts', () => {
    expect(formatFiatEstimate('', 'USDC')).toBeUndefined()
    expect(formatFiatEstimate('0', 'USDC')).toBeUndefined()
    expect(formatFiatEstimate('-5', 'USDC')).toBeUndefined()
    expect(formatFiatEstimate('abc', 'USDC')).toBeUndefined()
    expect(formatFiatEstimate(null, 'USDC')).toBeUndefined()
    expect(formatFiatEstimate(undefined, 'USDC')).toBeUndefined()
  })

  it('correctly calculates 1:1 USD equivalent for USDC', () => {
    expect(formatFiatEstimate('100', 'USDC')).toBe('≈ $100.00 USD')
    expect(formatFiatEstimate('1.5', 'USDC')).toBe('≈ $1.50 USD')
    expect(formatFiatEstimate('250000', 'USDC')).toBe('≈ $250,000.00 USD')
  })

  it('correctly calculates USD equivalent for cirBTC with live price (e.g. 0.00009541 cirBTC at $80,973)', () => {
    const mockPrices = {
      CIRBTC: 80973.0,
      BTC: 80973.0,
      EURC: 1.082,
      USDC: 1.0,
    }

    const result = formatFiatEstimate('0.00009541', 'cirBTC', mockPrices)
    // 0.00009541 * 80973 = 7.72563393 -> ≈ $7.73 USD
    expect(result).toBe('≈ $7.73 USD')
  })

  it('correctly calculates USD equivalent for EURC with live price', () => {
    const mockPrices = {
      CIRBTC: 80973.0,
      EURC: 1.082,
      USDC: 1.0,
    }

    const result = formatFiatEstimate('100', 'EURC', mockPrices)
    // 100 * 1.082 = 108.20
    expect(result).toBe('≈ $108.20 USD')
  })

  it('uses active pool exchange rate if provided', () => {
    const result = formatFiatEstimate('0.1', 'cirBTC', null, 85000)
    // 0.1 * 85000 = 8500.00
    expect(result).toBe('≈ $8,500.00 USD')
  })

  it('returns undefined if no live price and no pool exchange rate are available (no fake fallbacks)', () => {
    // When prices map is empty or undefined and poolExchangeRate is absent
    expect(formatFiatEstimate('0.00009541', 'cirBTC', {})).toBeUndefined()
    expect(formatFiatEstimate('0.00009541', 'cirBTC', null)).toBeUndefined()
    expect(formatFiatEstimate('100', 'EURC', {})).toBeUndefined()
  })

  it('displays "< $0.01 USD" for micro amounts whose total is less than 1 cent', () => {
    const mockPrices = {
      CIRBTC: 80000.0,
    }
    // 0.00000005 * 80000 = 0.004 (< 0.01)
    expect(formatFiatEstimate('0.00000005', 'cirBTC', mockPrices)).toBe('< $0.01 USD')
  })

  it('never applies counter-token poolExchangeRate to LP tokens and prices them accurately', () => {
    // 46.36 af-USDC-cirBTC in a pool with BTC rate 467562.71 must NOT become $21M!
    const btcPoolRate = 467562.71
    expect(formatFiatEstimate('46.36', 'af-USDC-cirBTC', null, btcPoolRate)).toBe('≈ $46.36 USD')
    expect(formatFiatEstimate('100', 'af-USDC-EURC', null, 1.082)).toBe('≈ $100.00 USD')
    expect(formatFiatEstimate('50', 'LP', null, btcPoolRate)).toBe('≈ $50.00 USD')
  })
})
