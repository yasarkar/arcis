import { describe, it, expect } from 'vitest'
import { calculateVaultClaimShares, calculateLpClaimAmount } from '../poolMath'

describe('claimMath', () => {
  describe('calculateVaultClaimShares', () => {
    it('returns 0n for non-positive profit or empty vault', () => {
      expect(calculateVaultClaimShares(0, 1000n, 1000n, 500n)).toBe(0n)
      expect(calculateVaultClaimShares(10, 0n, 1000n, 500n)).toBe(0n)
      expect(calculateVaultClaimShares(10, 1000n, 0n, 500n)).toBe(0n)
      expect(calculateVaultClaimShares(10, 1000n, 1000n, 0n)).toBe(0n)
    })

    it('calculates exact shares to redeem for a 1:1 share price vault', () => {
      // 1000 USDC totalAssets, 1000 shares totalSupply -> share price = 1.0 USDC
      // profit = 50 USDC -> 50 shares
      const totalAssets = 1_000_000_000n // 1000 * 1e6
      const totalSupply = 1_000_000_000n // 1000 * 1e6
      const userShares = 200_000_000n // 200 shares
      const profitUsd = 50

      const shares = calculateVaultClaimShares(profitUsd, totalAssets, totalSupply, userShares)
      expect(shares).toBe(50_000_000n)
    })

    it('calculates fewer shares when shares have appreciated (e.g. 1.25 USDC per share)', () => {
      // 1250 USDC totalAssets, 1000 shares totalSupply -> 1 share = 1.25 USDC
      // profit = 50 USDC -> needs 50 / 1.25 = 40 shares
      const totalAssets = 1_250_000_000n
      const totalSupply = 1_000_000_000n
      const userShares = 200_000_000n
      const profitUsd = 50

      const shares = calculateVaultClaimShares(profitUsd, totalAssets, totalSupply, userShares)
      expect(shares).toBe(40_000_000n)
    })

    it('clamps to userShares if profit exceeds total user holding', () => {
      const totalAssets = 1_000_000_000n
      const totalSupply = 1_000_000_000n
      const userShares = 50_000_000n // 50 shares
      const profitUsd = 100

      const shares = calculateVaultClaimShares(profitUsd, totalAssets, totalSupply, userShares)
      expect(shares).toBe(userShares)
    })
  })

  describe('calculateLpClaimAmount', () => {
    it('returns 0n for invalid inputs', () => {
      expect(calculateLpClaimAmount(0, 100, 1_000_000_000_000_000_000n)).toBe(0n)
      expect(calculateLpClaimAmount(10, 0, 1_000_000_000_000_000_000n)).toBe(0n)
      expect(calculateLpClaimAmount(10, 100, 0n)).toBe(0n)
    })

    it('calculates proportional LP tokens to redeem for target profit', () => {
      // User staked 1000 USD, holds 100 LP tokens (18 decimals)
      // Profit is 100 USD (10% of position) -> redeem 10 LP tokens
      const userStakedUsd = 1000
      const profitUsd = 100
      const userLpRaw = 100_000_000_000_000_000_000n // 100 LP

      const lpToRedeem = calculateLpClaimAmount(profitUsd, userStakedUsd, userLpRaw)
      expect(lpToRedeem).toBe(10_000_000_000_000_000_000n) // 10 LP
    })

    it('clamps to userLpRaw if profit exceeds staked USD', () => {
      const userStakedUsd = 100
      const profitUsd = 150
      const userLpRaw = 100_000_000_000_000_000_000n

      const lpToRedeem = calculateLpClaimAmount(profitUsd, userStakedUsd, userLpRaw)
      expect(lpToRedeem).toBe(userLpRaw)
    })
  })
})
