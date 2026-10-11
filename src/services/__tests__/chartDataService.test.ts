import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getPairChartData,
  normalizeChartSymbol,
  resolveChartPair,
} from '../chartDataService'

describe('chartDataService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('normalizes token symbols correctly', () => {
    expect(normalizeChartSymbol('cirBTC')).toBe('BTC')
    expect(normalizeChartSymbol('WBTC')).toBe('BTC')
    expect(normalizeChartSymbol('WETH')).toBe('ETH')
    expect(normalizeChartSymbol('MATIC')).toBe('POL')
    expect(normalizeChartSymbol('USDC')).toBe('USDC')
  })

  it('resolves chart pair with USDC as quote when swapping cirBTC to USDC', () => {
    const { base, quote, isReversed } = resolveChartPair('cirBTC', 'USDC')
    expect(base).toBe('BTC')
    expect(quote).toBe('USDC')
    expect(isReversed).toBe(false)
  })

  it('resolves chart pair with source coin (tokenIn) as base by default', () => {
    const { base, quote, isReversed } = resolveChartPair('USDC', 'cirBTC')
    expect(base).toBe('USDC')
    expect(quote).toBe('BTC')
    expect(isReversed).toBe(false)
  })

  it('allows dynamically switching chart focus to target token', () => {
    const { base, quote, isReversed } = resolveChartPair('USDC', 'cirBTC', 'cirBTC')
    expect(base).toBe('BTC')
    expect(quote).toBe('USDC')
    expect(isReversed).toBe(true)
  })

  it('resolves EURC and USDC correctly', () => {
    const { base, quote } = resolveChartPair('EURC', 'USDC')
    expect(base).toBe('EURC')
    expect(quote).toBe('USDC')
  })

  it('generates high-fidelity synthetic chart data when API calls fail or offline', async () => {
    // Mock fetch to simulate offline
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network offline')))

    const data = await getPairChartData('cirBTC', 'USDC', '1D', 82713)

    expect(data).toBeDefined()
    expect(data.baseSymbol).toBe('BTC')
    expect(data.quoteSymbol).toBe('USDC')
    expect(data.timeframe).toBe('1D')
    expect(data.points.length).toBeGreaterThan(10)
    expect(data.currentPrice).toBe(82713)
    expect(data.highPrice).toBeGreaterThanOrEqual(data.lowPrice)
    expect(typeof data.priceChangePercent24h).toBe('number')
  })

  it('correctly maps 1W and 1M timeframes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network offline')))

    const data1W = await getPairChartData('ETH', 'USDC', '1W', 2500)
    expect(data1W.timeframe).toBe('1W')
    expect(data1W.points.length).toBeGreaterThan(15)

    const data1M = await getPairChartData('ETH', 'USDC', '1M', 2500)
    expect(data1M.timeframe).toBe('1M')
    expect(data1M.points.length).toBeGreaterThan(15)
  })
})
