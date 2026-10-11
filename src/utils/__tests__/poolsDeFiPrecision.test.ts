import { describe, it, expect } from 'vitest'
import {
  sqrtBigInt,
  calculateLpTokensToAssets,
  estimateLpSharesForDeposit,
  calculateConstantProductExpectedOut,
  calculateStableSwapExpectedOut,
  getStableSwapD,
} from '../poolMath'
import {
  computeMinLpShares,
  measureVaultYieldApy,
} from '../../hooks/usePoolsData'
import {
  GATEWAY_BASE_LIQUIDITY,
  GATEWAY_ROUTING_APY,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  STABLE_SWAP_LP_FEE_BPS,
  STABLE_SWAP_AMP,
  poolMinOut,
  poolSlippageBps,
} from '../../config/poolsConfig'
import { parseUnits, formatUnits } from 'viem'

describe('Pools DeFi Math Precision & Industry Standards', () => {
  describe('Babylonian Integer Square Root (sqrtBigInt)', () => {
    it('returns 0n for 0n and 1n for 1n', () => {
      expect(sqrtBigInt(0n)).toBe(0n)
      expect(sqrtBigInt(1n)).toBe(1n)
    })

    it('computes exact squares correctly', () => {
      expect(sqrtBigInt(4n)).toBe(2n)
      expect(sqrtBigInt(9n)).toBe(3n)
      expect(sqrtBigInt(16n)).toBe(4n)
      expect(sqrtBigInt(100n)).toBe(10n)
      expect(sqrtBigInt(10_000n)).toBe(100n)
      expect(sqrtBigInt(1_000_000n)).toBe(1000n)
    })

    it('rounds down integer square roots for non-perfect squares', () => {
      expect(sqrtBigInt(2n)).toBe(1n)
      expect(sqrtBigInt(3n)).toBe(1n)
      expect(sqrtBigInt(5n)).toBe(2n)
      expect(sqrtBigInt(8n)).toBe(2n)
      expect(sqrtBigInt(10n)).toBe(3n)
      expect(sqrtBigInt(99n)).toBe(9n)
    })

    it('handles high-precision 256-bit BigInt amounts accurately', () => {
      // 10^36 square root is 10^18
      const largeSquare = 10n ** 36n
      expect(sqrtBigInt(largeSquare)).toBe(10n ** 18n)

      // Test property: r^2 <= x < (r + 1)^2
      const x = 123456789012345678901234567890n
      const r = sqrtBigInt(x)
      expect(r * r <= x).toBe(true)
      expect((r + 1n) * (r + 1n) > x).toBe(true)
    })
  })

  describe('Proportional LP Asset Return (calculateLpTokensToAssets)', () => {
    const totalLpSupply = 1_000_000_000_000_000_000_000n // 1,000 LP tokens (18 dec)
    const reserveA = 100_000_000_000n // 100,000 USDC (6 dec)
    const reserveB = 10_000_000_000n // 100 cirBTC (8 dec)

    it('returns exact 50% of reserves when burning 50% of total LP supply', () => {
      const halfLp = totalLpSupply / 2n
      const result = calculateLpTokensToAssets({
        lpTokensToBurn: halfLp,
        totalLpSupply,
        reserveA,
        reserveB,
      })

      expect(result.amountA).toBe(50_000_000_000n) // 50,000 USDC
      expect(result.amountB).toBe(5_000_000_000n) // 50 cirBTC
    })

    it('returns 100% of reserves when burning all circulating LP tokens', () => {
      const result = calculateLpTokensToAssets({
        lpTokensToBurn: totalLpSupply,
        totalLpSupply,
        reserveA,
        reserveB,
      })

      expect(result.amountA).toBe(reserveA)
      expect(result.amountB).toBe(reserveB)
    })

    it('returns 0n assets if burning 0n LP tokens or totalLp is 0n', () => {
      const zeroBurn = calculateLpTokensToAssets({
        lpTokensToBurn: 0n,
        totalLpSupply,
        reserveA,
        reserveB,
      })
      expect(zeroBurn.amountA).toBe(0n)
      expect(zeroBurn.amountB).toBe(0n)

      const zeroSupply = calculateLpTokensToAssets({
        lpTokensToBurn: 100n,
        totalLpSupply: 0n,
        reserveA,
        reserveB,
      })
      expect(zeroSupply.amountA).toBe(0n)
      expect(zeroSupply.amountB).toBe(0n)
    })
  })

  describe('Zero-Liquidity Initial Pool Seeding', () => {
    it('estimates initial LP shares for Constant Product pool with 1,000 dead shares locked', () => {
      // 10,000 USDC (6 dec) and 0.1 cirBTC (8 dec)
      const res = estimateLpSharesForDeposit({
        poolId: 'usdc-cirbtc-pool',
        amountA: 10000,
        amountB: 0.1,
        reserveA: 0,
        reserveB: 0,
        totalLp: 0,
        amp: STABLE_SWAP_AMP,
        allowInitialSeed: true,
      })

      expect(res).not.toBeNull()
      expect(res!.shares).toBeGreaterThan(0)
      expect(res!.totalLpAfter).toBeCloseTo(res!.shares, 6)

      // Expected raw calculation:
      // rawA = 10,000 * 10^6 = 10^10
      // rawB = 0.1 * 10^8 = 10^7
      // rawA * rawB = 10^17
      // sqrt(10^17) = 316,227,766
      // initialLp = 316,227,766 * 10^11 = 31,622,776,600,000,000,000
      // userLp = initialLp - 1,000
      const rawA = parseUnits('10000', 6)
      const rawB = parseUnits('0.1', 8)
      const expectedInitialLp = sqrtBigInt(rawA * rawB) * 100_000_000_000n
      const expectedUserLp = expectedInitialLp - 1000n
      const expectedShares = parseFloat(formatUnits(expectedUserLp, 18))

      expect(res!.shares).toBeCloseTo(expectedShares, 4)
    })

    it('estimates initial LP shares for StableSwap pool with 1,000 dead shares locked', () => {
      // 10,000 USDC (6 dec) and 10,000 EURC (6 dec)
      const res = estimateLpSharesForDeposit({
        poolId: 'usdc-eurc-stable-pool',
        amountA: 10000,
        amountB: 10000,
        reserveA: 0,
        reserveB: 0,
        totalLp: 0,
        amp: STABLE_SWAP_AMP,
        allowInitialSeed: true,
      })

      expect(res).not.toBeNull()
      expect(res!.shares).toBeGreaterThan(0)
      expect(res!.totalLpAfter).toBe(res!.shares)

      // D for equal 10,000 units is 20,000 * 10^6
      // scaled to 18 dec = 20,000 * 10^18
      // userLp = scaled - 1,000
      expect(res!.shares).toBeCloseTo(20000, 1)
    })

    it('returns 0n for minLpShares guard when pool has 0 reserves, and positive guard when seeded', () => {
      const minLpUnseeded = computeMinLpShares(
        { id: 'usdc-cirbtc-pool' },
        '0x0000000000000000000000000000000000000001',
        {},
        parseUnits('5000', 6),
        parseUnits('0.05', 8),
        8,
        0.5
      )
      expect(minLpUnseeded).toBe(0n)

      const seededState = {
        '0x0000000000000000000000000000000000000001': {
          reserveA: '100000',
          reserveB: '1',
          totalLp: '1000',
        },
      }
      const minLpSeeded = computeMinLpShares(
        { id: 'usdc-cirbtc-pool' },
        '0x0000000000000000000000000000000000000001',
        seededState,
        parseUnits('5000', 6),
        parseUnits('0.05', 8),
        8,
        0.5
      )
      expect(minLpSeeded).toBeGreaterThan(0n)
    })
  })

  describe('Constant Product & StableSwap BigInt AMM Math', () => {
    it('applies exact fee and k-invariant in calculateConstantProductExpectedOut', () => {
      const reserveIn = parseUnits('100000', 6) // 100k USDC
      const reserveOut = parseUnits('1', 8) // 1 cirBTC
      const amountIn = parseUnits('1000', 6) // 1k USDC

      const fee = (amountIn * CONSTANT_PRODUCT_LP_FEE_BPS) / 10000n
      const netIn = amountIn - fee
      const expectedOut = (reserveOut * netIn) / (reserveIn + netIn)

      const result = calculateConstantProductExpectedOut(amountIn, reserveIn, reserveOut, CONSTANT_PRODUCT_LP_FEE_BPS)
      expect(result).toBe(expectedOut)
      expect(result).toBeGreaterThan(0n)
    })

    it('applies exact Curve amplification and fee in calculateStableSwapExpectedOut', () => {
      const reserveA = parseUnits('100000', 6) // 100k USDC
      const reserveB = parseUnits('100000', 6) // 100k EURC
      const amountIn = parseUnits('1000', 6) // 1k USDC

      const result = calculateStableSwapExpectedOut(
        amountIn,
        reserveA,
        reserveB,
        STABLE_SWAP_LP_FEE_BPS,
        STABLE_SWAP_AMP
      )

      expect(result).toBeGreaterThan(0n)
      // Because reserves are balanced 1:1 and fee is 12 bps (0.12%), output is close to 998.8 EURC
      const formatted = parseFloat(formatUnits(result, 6))
      expect(formatted).toBeGreaterThan(998)
      expect(formatted).toBeLessThan(1000)
    })
  })

  describe('Defi Metrics Honesty & Neutralized Mock Constants', () => {
    it('neutralizes deprecated gateway mock liquidity and synthetic APY to 0', () => {
      expect(GATEWAY_BASE_LIQUIDITY).toBe(0)
      expect(GATEWAY_ROUTING_APY).toBe(0)
    })

    it('measureVaultYieldApy returns 0 when no observation window has elapsed', () => {
      const apy = measureVaultYieldApy(1000, 50000)
      expect(apy).toBe(0)
    })
  })
})
