import { describe, it, expect } from 'vitest'
import {
  getStableSwapD,
  getStableSwapY,
  calculateStableSwapExpectedOut,
  calculateConstantProductExpectedOut,
} from '../poolMath'

describe('poolMath', () => {
  describe('getStableSwapD', () => {
    it('returns 0n when sum of reserves is 0', () => {
      expect(getStableSwapD(0n, 0n, 100n)).toBe(0n)
    })

    it('calculates exact invariant D for equal reserves (500k USDC, 500k EURC)', () => {
      const reserve = 500_000_000_000n // 500,000 * 10^6
      const d = getStableSwapD(reserve, reserve, 100n)
      // When reserves are equal, D must exactly equal the sum of reserves
      expect(d).toBe(reserve * 2n)
    })

    it('calculates invariant D for imbalanced reserves', () => {
      const x = 700_000_000_000n
      const y = 300_000_000_000n
      const d = getStableSwapD(x, y, 100n)
      // D is slightly less than sum for imbalanced pools due to curve curvature
      expect(d).toBeLessThanOrEqual(x + y)
      expect(d).toBeGreaterThan(0n)
    })
  })

  describe('getStableSwapY', () => {
    it('solves for original reserve y given unchanged x and D', () => {
      const reserve = 500_000_000_000n
      const d = getStableSwapD(reserve, reserve, 100n)
      const y = getStableSwapY(reserve, d, 100n)
      // Difference from rounding must be <= 1
      expect(Math.abs(Number(y - reserve))).toBeLessThanOrEqual(1)
    })
  })

  describe('calculateStableSwapExpectedOut', () => {
    it('returns 0n for non-positive amountIn or reserves', () => {
      expect(calculateStableSwapExpectedOut(0n, 1000n, 1000n)).toBe(0n)
      expect(calculateStableSwapExpectedOut(100n, 0n, 1000n)).toBe(0n)
      expect(calculateStableSwapExpectedOut(100n, 1000n, 0n)).toBe(0n)
    })

    it('calculates expected out with 0.12% fee (12 bps) on equal 500k reserves', () => {
      const reserveA = 500_000_000_000n // 500k USDC (6 decimals)
      const reserveB = 500_000_000_000n // 500k EURC (6 decimals)
      const amountIn = 1_000_000_000n // 1,000 USDC

      const expectedOut = calculateStableSwapExpectedOut(amountIn, reserveA, reserveB, 12n, 100n)
      // In a 500k pool, swapping 1,000 should yield ~998.8 EURC (1000 - 0.12% fee = 998.8, with tiny curve slippage)
      const outInUnits = Number(expectedOut) / 1e6
      expect(outInUnits).toBeGreaterThan(998.7)
      expect(outInUnits).toBeLessThan(998.81)
    })

    it('returns smaller output when amplification is low and pool is heavily imbalanced', () => {
      const reserveA = 900_000_000_000n
      const reserveB = 100_000_000_000n
      const amountIn = 50_000_000_000n

      const out = calculateStableSwapExpectedOut(amountIn, reserveA, reserveB, 12n, 100n)
      expect(out).toBeGreaterThan(0n)
      expect(out).toBeLessThan(amountIn) // Price impact due to imbalance
    })
  })

  describe('calculateConstantProductExpectedOut', () => {
    it('returns 0n for invalid inputs or reserves', () => {
      expect(calculateConstantProductExpectedOut(0n, 1000n, 1000n)).toBe(0n)
      expect(calculateConstantProductExpectedOut(100n, 0n, 1000n)).toBe(0n)
      expect(calculateConstantProductExpectedOut(100n, 1000n, 0n)).toBe(0n)
    })

    it('accurately calculates constant product output: (resOut * netIn) / (resIn + netIn)', () => {
      const reserveIn = 100_000_000_000n // 100k USDC
      const reserveOut = 100_000_000_000n
      const amountIn = 1_000_000_000n // 1k USDC
      const feeBps = 25n // 0.25% fee

      // netIn = 1,000 * 9975 / 10000 = 997.5 USDC
      // expectedOut = (100k * 997.5) / (100k + 997.5) = 987.64...
      const expectedOut = calculateConstantProductExpectedOut(amountIn, reserveIn, reserveOut, feeBps)
      const outInUnits = Number(expectedOut) / 1e6

      const fee = (amountIn * feeBps) / 10000n
      const netIn = amountIn - fee
      const manualCalc = (reserveOut * netIn) / (reserveIn + netIn)

      expect(expectedOut).toBe(manualCalc)
      expect(outInUnits).toBeCloseTo(987.64, 1)
    })
  })
})
