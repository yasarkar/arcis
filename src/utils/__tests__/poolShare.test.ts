import { describe, it, expect } from 'vitest'
import { calculatePoolShare } from '../poolMath'
import { parseUnits } from 'viem'

describe('calculatePoolShare (K1 Edge Case Fix)', () => {
  it('returns 0 when lpMinted is zero or negative', () => {
    expect(calculatePoolShare(0n, parseUnits('1000', 18))).toBe(0)
  })

  it('returns 0 when totalLpAfter is zero or unseeded (eliminates false 100% bug)', () => {
    expect(calculatePoolShare(parseUnits('100', 18), 0n)).toBe(0)
  })

  it('correctly calculates 50% pool share', () => {
    const lpMinted = parseUnits('500', 18)
    const totalLp = parseUnits('1000', 18)
    expect(calculatePoolShare(lpMinted, totalLp)).toBe(50)
  })

  it('correctly calculates 10% pool share', () => {
    const lpMinted = parseUnits('100', 18)
    const totalLp = parseUnits('1000', 18)
    expect(calculatePoolShare(lpMinted, totalLp)).toBe(10)
  })

  it('correctly calculates fractional 0.125% pool share', () => {
    const lpMinted = parseUnits('125', 18)
    const totalLp = parseUnits('100000', 18)
    expect(calculatePoolShare(lpMinted, totalLp)).toBe(0.125)
  })

  it('returns 100% when user owns total LP supply', () => {
    const lpMinted = parseUnits('1000', 18)
    const totalLp = parseUnits('1000', 18)
    expect(calculatePoolShare(lpMinted, totalLp)).toBe(100)
  })

  it('handles first bootstrap deposit with MINIMUM_LIQUIDITY dead lock (1000 units)', () => {
    const lpMinted = parseUnits('100', 18) // 100 LP tokens minted to user
    const totalLp = lpMinted + 1000n // 1000 units burned to dead address
    const share = calculatePoolShare(lpMinted, totalLp)
    // Should be virtually ~99.999...%
    expect(share).toBeGreaterThan(99.9)
    expect(share).toBeLessThanOrEqual(100)
  })
})
