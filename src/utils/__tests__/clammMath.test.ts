import { describe, it, expect } from 'vitest'
import {
  calculateClammRatio,
  calculateCounterTokenAmount,
  calculateConcentratedApr,
  generateLiquidityBars,
} from '../clammMath'

describe('Concentrated Liquidity (CLAMM) Math Utilities', () => {
  const currentPrice = 82739.9905
  const minPrice = 67160.7788 // -18.83%
  const maxPrice = 101602.5598 // +22.80%

  it('calculates balanced ratio around the center of the range', () => {
    const ratio = calculateClammRatio(currentPrice, minPrice, maxPrice)
    expect(ratio.isOutOfRange).toBe(false)
    expect(ratio.percentA).toBeGreaterThan(40)
    expect(ratio.percentA).toBeLessThan(60)
    expect(ratio.percentA + ratio.percentB).toBe(100)
  })

  it('correctly returns 100% Token A when current price is below range', () => {
    const ratio = calculateClammRatio(50000, minPrice, maxPrice)
    expect(ratio.isOutOfRange).toBe(true)
    expect(ratio.outOfRangeSide).toBe('below')
    expect(ratio.percentA).toBe(100)
    expect(ratio.percentB).toBe(0)
  })

  it('correctly returns 100% Token B when current price is above range', () => {
    const ratio = calculateClammRatio(120000, minPrice, maxPrice)
    expect(ratio.isOutOfRange).toBe(true)
    expect(ratio.outOfRangeSide).toBe('above')
    expect(ratio.percentA).toBe(0)
    expect(ratio.percentB).toBe(100)
  })

  it('calculates counter token amount proportionally', () => {
    const { amountB } = calculateCounterTokenAmount({
      amountA: 1.0, // 1 BTC
      currentPrice,
      minPrice,
      maxPrice,
    })
    // 1 BTC should require a non-zero, proportional amount of USDC
    expect(amountB).toBeGreaterThan(0)
    expect(amountB).toBeLessThan(currentPrice * 2)
  })

  it('calculates concentrated APR dynamically', () => {
    const apr = calculateConcentratedApr(currentPrice, minPrice, maxPrice, 126, 3129636, 0.3)
    expect(apr).toBeGreaterThan(1.5)
    expect(apr).toBeLessThan(50)
  })

  it('dynamically changes Estimated APR as range narrows or widens', () => {
    const wethPrice = 2600
    const wethBaseApy = 15.4
    const defaultRangeApr = calculateConcentratedApr(wethPrice, 2110, 3192, 0, 0, 0.3, wethBaseApy)
    const narrowRangeApr = calculateConcentratedApr(wethPrice, 2450, 2750, 0, 0, 0.3, wethBaseApy)
    const wideRangeApr = calculateConcentratedApr(wethPrice, 1300, 4800, 0, 0, 0.3, wethBaseApy)
    const outOfRangeApr = calculateConcentratedApr(wethPrice, 1000, 2000, 0, 0, 0.3, wethBaseApy)

    // Baseline should match WETH APY at reference range
    expect(defaultRangeApr).toBeCloseTo(15.4, 0)
    // Narrow range should have significantly higher concentrated APR
    expect(narrowRangeApr).toBeGreaterThan(defaultRangeApr)
    // Wide range should have lower APR than default range
    expect(wideRangeApr).toBeLessThan(defaultRangeApr)
    // Out of range should be 0
    expect(outOfRangeApr).toBe(0)
  })

  it('generates histogram depth bars with in-range flags', () => {
    const bars = generateLiquidityBars(currentPrice, minPrice, maxPrice, 38)
    expect(bars.length).toBe(38)
    const inRangeBars = bars.filter((b) => b.inRange)
    expect(inRangeBars.length).toBeGreaterThan(0)
  })
})
