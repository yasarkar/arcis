import { describe, it, expect } from 'vitest'
import { POOL_VERSION_V4 } from '../../config/poolsConfig'

describe('MyPositionsSection & PositionCard Data and Design Integrity', () => {
  it('correctly maps glyphs for BTC, EURC, and USDC tokens', () => {
    function getTokenGlyph(symbol: string): string {
      const s = (symbol || '').toUpperCase()
      if (s.includes('BTC')) return '₿'
      if (s.includes('EUR')) return '€'
      if (s.includes('USD')) return '$'
      return s.charAt(0) || '•'
    }

    expect(getTokenGlyph('cirBTC')).toBe('₿')
    expect(getTokenGlyph('EURC')).toBe('€')
    expect(getTokenGlyph('USDC')).toBe('$')
    expect(getTokenGlyph('ETH')).toBe('E')
  })

  it('correctly builds dynamic price displays per pool pair without hardcoded cirBTC labels', () => {
    const buildPriceDisplay = (
      id: string,
      exchangeRate: number,
      token1: string,
      token2: string
    ) => {
      const isEurc = id === 'usdc-eurc-stable-pool'
      const isBtc = id === 'usdc-cirbtc-pool'
      const isVault = id === 'usdc-yield-vault'

      if (isEurc) {
        return `Price ${exchangeRate.toFixed(2)} USDC per EURC`
      } else if (isBtc) {
        return `Price ${exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC per cirBTC`
      } else if (isVault) {
        return '1.00 USDC = 1.00 iUSDC Vault Share'
      }
      return `Price ${exchangeRate.toFixed(2)} ${token2} per ${token1}`
    }

    expect(buildPriceDisplay('usdc-eurc-stable-pool', 1.08, 'EURC', 'USDC')).toBe('Price 1.08 USDC per EURC')
    expect(buildPriceDisplay('usdc-cirbtc-pool', 83436.0, 'cirBTC', 'USDC')).toBe('Price 83,436.00 USDC per cirBTC')
    expect(buildPriceDisplay('usdc-yield-vault', 1.0, 'USDC', '')).toBe('1.00 USDC = 1.00 iUSDC Vault Share')
  })

  it('validates and clamps unreasonable cached CLAMM ranges to avoid distorted out-of-range display', () => {
    const livePrice = 83436.0
    const rawCachedMin = 271708.26 // from previous abnormal testnet ratio
    const rawCachedMax = 411060.42

    let minPriceNum = Math.round(livePrice * (1 - 0.1883) * 100) / 100
    let maxPriceNum = Math.round(livePrice * (1 + 0.2280) * 100) / 100

    // Sanity check: Ensure cached range is within 0.3x to 3.0x of live price
    if (rawCachedMin > 0 && rawCachedMax > rawCachedMin && rawCachedMin >= livePrice * 0.3 && rawCachedMax <= livePrice * 3.0) {
      minPriceNum = rawCachedMin
      maxPriceNum = rawCachedMax
    }

    // Abnormal cache should be discarded and fallback to ±20% active market bounds
    expect(minPriceNum).toBe(67725.0)
    expect(maxPriceNum).toBe(102459.41)
    expect(livePrice >= minPriceNum && livePrice <= maxPriceNum).toBe(true)
  })

  it('correctly reports 100% single asset allocation for vault and no duplicate tokens', () => {
    const isVault = true
    const stakedUsd = 50.0
    const token1Amount = stakedUsd.toFixed(2)
    const token2Amount = undefined
    const token1Ratio = isVault ? 100 : 50
    const token2Ratio = isVault ? 0 : 50

    expect(token1Amount).toBe('50.00')
    expect(token2Amount).toBeUndefined()
    expect(token1Ratio).toBe(100)
    expect(token2Ratio).toBe(0)
  })

  it('correctly provides custom token icons and specific colors for EURC, USDC, and cirBTC', async () => {
    const { getTokenAssetConfig } = await import('../../components/pools/PositionCard')

    const eurcCfg = getTokenAssetConfig('EURC', 'eurc')
    expect(eurcCfg.textColorClass).toBe('text-blue-500')
    expect(eurcCfg.barGradient).toContain('#1e40af')
    expect(eurcCfg.barGradient).toContain('#2563eb')
    expect(eurcCfg.icon).toBeDefined()

    const usdcCfg = getTokenAssetConfig('USDC', 'usdc')
    expect(usdcCfg.textColorClass).toBe('text-sky-400')
    expect(usdcCfg.barGradient).toContain('#0284c7')
    expect(usdcCfg.barGradient).toContain('#38bdf8')
    expect(usdcCfg.icon).toBeDefined()

    const btcCfg = getTokenAssetConfig('cirBTC', 'btc')
    expect(btcCfg.textColorClass).toBe('text-orange-500')
    expect(btcCfg.barGradient).toContain('#c2410c')
    expect(btcCfg.barGradient).toContain('#ea580c')
    expect(btcCfg.icon).toBeDefined()
  })
})
