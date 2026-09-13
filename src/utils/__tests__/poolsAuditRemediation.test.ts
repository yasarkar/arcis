import { describe, it, expect } from 'vitest'
import {
  POOL_TESTNET_BASE_VOLUME,
  startLiveVolumeSimulation,
  getRollingClientSwapVolume,
  recordClientSwapVolume,
  clearSwapVolumeCache,
} from '../poolVolumeUtils'
import {
  calculateLpClaimAmount,
  calculateStableSwapExpectedOut,
  calculateConstantProductExpectedOut,
} from '../poolMath'
import { poolSlippageBps, poolMinOut, POOL_DEFAULT_SLIPPAGE_BPS } from '../../config/poolsConfig'

describe('Pools Audit Remediation Verifications', () => {
  describe('Finding 1: Zero synthetic base & disabled simulation', () => {
    it('ensures base volumes are 0 for all pools', () => {
      expect(POOL_TESTNET_BASE_VOLUME['usdc-eurc-stable-pool']).toBe(0)
      expect(POOL_TESTNET_BASE_VOLUME['usdc-cirbtc-pool']).toBe(0)
      expect(POOL_TESTNET_BASE_VOLUME['usdc-yield-vault']).toBe(0)
    })

    it('startLiveVolumeSimulation is a clean no-op that does not increment volume', () => {
      clearSwapVolumeCache()
      const initial = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(initial).toBe(0)

      const teardown = startLiveVolumeSimulation()
      expect(typeof teardown).toBe('function')
      teardown()

      expect(getRollingClientSwapVolume('usdc-eurc-stable-pool')).toBe(0)
    })
  })

  describe('Finding 2: Auto-swap slippage protection', () => {
    it('correctly calculates expected out and minOut for Curve stable pool', () => {
      const reserveA = 100_000_000_000n // 100,000 USDC
      const reserveB = 100_000_000_000n // 100,000 EURC
      const amountIn = 1_000_000_000n // 1,000 EURC

      const expectedOut = calculateStableSwapExpectedOut(amountIn, reserveB, reserveA, 12n, 100n)
      expect(expectedOut).toBeGreaterThan(0n)

      const slipBps = poolSlippageBps(0.5) // 50 bps (0.5%)
      const minOut = poolMinOut(expectedOut, slipBps)
      expect(minOut).toBeGreaterThan(0n)
      expect(minOut).toBeLessThan(expectedOut)
      // minOut must be at least 99.4% of expectedOut
      expect(minOut * 10000n / expectedOut).toBeGreaterThanOrEqual(9940n)
    })

    it('correctly calculates expected out and minOut for Constant Product pool', () => {
      const reserveA = 100_000_000_000n // 100,000 USDC (6 dec)
      const reserveB = 100_000_000n // 1 cirBTC (8 dec)
      const amountIn = 10_000_000n // 0.1 cirBTC

      const expectedOut = calculateConstantProductExpectedOut(amountIn, reserveB, reserveA, 25n)
      expect(expectedOut).toBeGreaterThan(0n)

      const slipBps = poolSlippageBps(1.0) // 100 bps (1.0%)
      const minOut = poolMinOut(expectedOut, slipBps)
      expect(minOut).toBeGreaterThan(0n)
      expect(minOut).toBeLessThan(expectedOut)
      expect(minOut * 10000n / expectedOut).toBeGreaterThanOrEqual(9899n)
    })
  })

  describe('Finding 10: BigInt precision in calculateLpClaimAmount', () => {
    it('accurately calculates LP tokens to redeem without float precision distortion', () => {
      const userLpRaw = 10_000_000_000_000_000_000n // 10 LP tokens (18 dec)
      const userStakedUsd = 1000.00
      const profitUsd = 50.00 // 5% profit

      const lpToRedeem = calculateLpClaimAmount(profitUsd, userStakedUsd, userLpRaw)
      // Exactly 5% of 10 LP = 0.5 LP = 500_000_000_000_000_000n
      expect(lpToRedeem).toBe(500_000_000_000_000_000n)
    })

    it('handles small fractional profits with full precision', () => {
      const userLpRaw = 1_000_000_000_000_000_000n
      const userStakedUsd = 100.00
      const profitUsd = 0.01 // $0.01 profit = 0.01%

      const lpToRedeem = calculateLpClaimAmount(profitUsd, userStakedUsd, userLpRaw)
      expect(lpToRedeem).toBe(100_000_000_000_000n)
    })
  })
})
