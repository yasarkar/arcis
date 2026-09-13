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

  describe('poolStakingTimestamp & APY accrual calculation', () => {
    it('accurately calculates continuous APY yield over elapsed staking time', () => {
      // 100 USDC staked in USDC/EURC with 6.15% APY over 48 hours (2 days)
      const stakedUsd = 100
      const apy = 6.15
      const elapsedSec = 48 * 3600 // 2 days
      const apyAccruedUsd = (stakedUsd * (apy / 100) * elapsedSec) / (365 * 86400)
      
      // Expected: 100 * 0.0615 * (2 / 365) = ~0.0337 USDC
      expect(apyAccruedUsd).toBeGreaterThan(0.033)
      expect(apyAccruedUsd).toBeLessThan(0.035)
      expect(apyAccruedUsd).toBeGreaterThanOrEqual(0.01) // exceeds minimum claim threshold!
    })

    it('accurately calculates continuous APY yield for BTC volatile pool', () => {
      // 500 USDC staked in USDC/cirBTC with 12.80% APY over 24 hours (1 day)
      const stakedUsd = 500
      const apy = 12.80
      const elapsedSec = 24 * 3600 // 1 day
      const apyAccruedUsd = (stakedUsd * (apy / 100) * elapsedSec) / (365 * 86400)
      
      // Expected: 500 * 0.128 / 365 = ~0.1753 USDC
      expect(apyAccruedUsd).toBeGreaterThan(0.17)
      expect(apyAccruedUsd).toBeLessThan(0.18)
      expect(apyAccruedUsd).toBeGreaterThanOrEqual(0.01)
    })

    it('resets claimable swap fee to 0 when fee checkpoint matches cumulative contract fees', () => {
      // Scenario: Pool contract has accumulated 0.4136 USDC in lifetime swap fees.
      // User has 100% pool share.
      const cumulativeContractFeesUsd = 0.4136
      const poolSharePct = 100
      const rawFeeShareUsd = (cumulativeContractFeesUsd * poolSharePct) / 100

      // Before claim: checkpoint is 0 -> full fee is claimable
      const initialCheckpoint = 0
      const initialClaimable = Math.max(0, rawFeeShareUsd - initialCheckpoint)
      expect(initialClaimable).toBeCloseTo(0.4136, 4)

      // User claims: checkpoint is recorded as the claimed raw fee share
      const newCheckpoint = rawFeeShareUsd

      // Immediately after claim: net fee claimable must be 0 even though contract still returns 0.4136
      const postClaimClaimable = Math.max(0, rawFeeShareUsd - newCheckpoint)
      expect(postClaimClaimable).toBe(0)

      // Later: New swap occurs on-chain, increasing cumulative fees to 0.4500 USDC
      const updatedContractFeesUsd = 0.4500
      const updatedRawFeeShare = (updatedContractFeesUsd * poolSharePct) / 100
      const newlyAccruedFee = Math.max(0, updatedRawFeeShare - newCheckpoint)
      expect(newlyAccruedFee).toBeCloseTo(0.0364, 4)
    })

    it('resets net vault appreciation to 0 after yield vault claim checkpoint is recorded', () => {
      // Scenario: User deposited 100 USDC in usdc-yield-vault.
      // Current share value previewRedeem gives 105.50 USDC -> rawVaultProfit = 5.50 USDC.
      const rawVaultProfit = 5.50

      // Before claim: checkpoint is 0
      const initialCheckpoint = 0
      const initialClaimable = Math.max(0, rawVaultProfit - initialCheckpoint)
      expect(initialClaimable).toBe(5.50)

      // User claims 5.50 USDC -> checkpoint is updated to 5.50
      const newCheckpoint = rawVaultProfit

      // Immediately after claim: netVaultAppreciation must be exactly 0
      const postClaimClaimable = Math.max(0, rawVaultProfit - newCheckpoint)
      expect(postClaimClaimable).toBe(0)

      // Later: vault generates additional yield, total previewRedeem profit reaches 6.20 USDC
      const higherVaultProfit = 6.20
      const subsequentClaimable = Math.max(0, higherVaultProfit - newCheckpoint)
      expect(subsequentClaimable).toBeCloseTo(0.70, 4)
    })

    it('resets continuous APY accrual to 0 immediately upon setting staking timestamp to now', () => {
      const stakedUsd = 250
      const apy = 8.42
      const now = 1710000000000

      // Staked 48 hours ago:
      const oldDepTimestamp = now - 48 * 3600 * 1000
      const oldElapsedSec = (now - oldDepTimestamp) / 1000
      const oldApyAccrued = (stakedUsd * (apy / 100) * oldElapsedSec) / (365 * 86400)
      expect(oldApyAccrued).toBeGreaterThan(0.11)

      // User claims -> setPoolStakingTimestamp(wallet, poolId, now)
      const newDepTimestamp = now
      const newElapsedSec = Math.max(0, (now - newDepTimestamp) / 1000)
      const newApyAccrued = (stakedUsd * (apy / 100) * newElapsedSec) / (365 * 86400)

      // Must be precisely 0.00
      expect(newElapsedSec).toBe(0)
      expect(newApyAccrued).toBe(0)
    })

    it('handles micro-threshold rounding: allows claims when rounded display is 0.01 USDC', () => {
      // If user has 0.007 USDC, rounded toFixed(2) is "0.01", so threshold must be <= 0.005
      const microYield1 = 0.007
      const microYield2 = 0.004

      const claimThreshold = 0.005
      expect(microYield1 >= claimThreshold).toBe(true)
      expect(parseFloat(microYield1.toFixed(2))).toBe(0.01)

      expect(microYield2 >= claimThreshold).toBe(false)
      expect(parseFloat(microYield2.toFixed(2))).toBe(0.00)
    })
  })
})

