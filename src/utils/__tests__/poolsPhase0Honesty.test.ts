import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { calculatePriceImpactPct, estimateLpSharesForDeposit } from '../poolMath'

const usePoolsSource = [
  readFileSync(new URL('../../hooks/usePoolsData.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolQueries.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolDepositService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolWithdrawService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolSwapService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolClaimService.ts', import.meta.url), 'utf8'),
].join('\n')
const poolModalSource = [
  readFileSync(new URL('../../components/pools/PoolActionModal.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../../components/pools/actions/PoolDepositTab.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../../components/pools/actions/PoolSwapTab.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../../components/pools/actions/PoolWithdrawTab.tsx', import.meta.url), 'utf8'),
  readFileSync(new URL('../../components/pools/actions/PoolSlippagePanel.tsx', import.meta.url), 'utf8'),
].join('\n')

describe('Phase 0 — honesty & correctness regressions', () => {
  describe('0.1 No synthetic yield is ever surfaced as claimable', () => {
    it('never backdates a deposit by 48h', () => {
      expect(usePoolsSource).not.toMatch(/48 \* 3600 \* 1000/)
    })

    it('removes synthetic APY accrual and localStorage checkpoints entirely (Phase 1)', () => {
      // No synthetic accrual variable or projection formula may remain.
      expect(usePoolsSource).not.toMatch(/apyAccruedUsd/)
      // Per-user claim accounting is on-chain now: no client-side checkpoint keys remain.
      expect(usePoolsSource).not.toMatch(/arcis:pool:timestamp/)
      expect(usePoolsSource).not.toMatch(/arcis:pool:fee_checkpoint/)
      expect(usePoolsSource).not.toMatch(/arcis:pool:vault_claimed/)
      // …and the on-chain sources of truth are wired in instead.
      expect(usePoolsSource).toMatch(/pendingFees/)
      expect(usePoolsSource).toMatch(/pendingYield/)
    })
  })

  describe('0.3 No fabricated 24h volume', () => {
    it('does not mint swap volume from dual-asset deposits', () => {
      expect(usePoolsSource).not.toMatch(/totalUsdAdded \* 0\.15/)
    })

    it('does not record vault deposits/withdrawals as trading volume', () => {
      expect(usePoolsSource).not.toMatch(/recordClientSwapVolume\('usdc-yield-vault'/)
    })
  })

  describe('0.4 Base APY is labelled as an estimate, never as realized yield', () => {
    it('labels the fixed base component as "Incentive Est."', async () => {
      const { formatPoolApyBadge } = await import('../../hooks/usePoolsData')

      // No fee component yet -> the base is explicitly attributed to an incentive estimate.
      const baseOnly = formatPoolApyBadge(6.15, 6.15, 0, 'FX Incentive')
      expect(baseOnly).toContain('FX Incentive')
      expect(baseOnly).not.toMatch(/Base/)

      // With a real fee component the badge must separate incentive from realized fees.
      const mixed = formatPoolApyBadge(6.5, 6.15, 0.35, 'FX Incentive')
      expect(mixed).toContain('Incentive Est.')
      expect(mixed).toContain('Fees')
      expect(mixed).not.toMatch(/\% Base \+/)
    })
  })

  describe('0.5 Real price impact (never a hard-coded "< 0.05%")', () => {
    it('scales with trade size for a constant-product pool', () => {
      const small = calculatePriceImpactPct(1_000, 100_000, 100_000, false)
      const large = calculatePriceImpactPct(50_000, 100_000, 100_000, false)

      // amountIn / (reserveIn + amountIn) * 100
      expect(small).toBeCloseTo((1_000 / 101_000) * 100, 4)
      expect(large).toBeCloseTo((50_000 / 150_000) * 100, 4)
      expect(large).toBeGreaterThan(small)
    })

    it('reports near-zero impact for a small trade on a deep stable pool', () => {
      const impact = calculatePriceImpactPct(1_000, 500_000, 500_000, true)
      expect(impact).toBeGreaterThanOrEqual(0)
      expect(impact).toBeLessThan(0.05)
    })

    it('returns 0 for invalid inputs instead of fabricating a number', () => {
      expect(calculatePriceImpactPct(0, 100_000, 100_000, false)).toBe(0)
      expect(calculatePriceImpactPct(1_000, 0, 100_000, false)).toBe(0)
      expect(calculatePriceImpactPct(1_000, 100_000, 0, false)).toBe(0)
    })

    it('removes the hard-coded price impact from the modal source', () => {
      expect(poolModalSource).toMatch(/calculatePriceImpactPct/)
      expect(poolModalSource).not.toMatch(/0\.05%/)
    })
  })

  describe('0.5 LP preview is derived from the pool invariant (no 0.998 factor)', () => {
    it('uses min(proportional) for the x*y=k pool', () => {
      const res = estimateLpSharesForDeposit({
        poolId: 'usdc-cirbtc-pool',
        amountA: 1_000,
        amountB: 0.01,
        reserveA: 100_000,
        reserveB: 1,
        totalLp: 10_000,
      })
      expect(res).not.toBeNull()
      expect(res!.shares).toBeCloseTo(100, 6)
      expect(res!.totalLpAfter).toBeCloseTo(10_100, 6)
    })

    it('uses the exact Curve D-delta for the stable pool', () => {
      const res = estimateLpSharesForDeposit({
        poolId: 'usdc-eurc-stable-pool',
        amountA: 10,
        amountB: 10,
        reserveA: 50,
        reserveB: 50,
        totalLp: 100,
      })
      expect(res).not.toBeNull()
      expect(res!.shares).toBeCloseTo(20, 1)
    })

    it('returns null (unavailable) instead of a fabricated number when reserves/totalLp are missing', () => {
      expect(
        estimateLpSharesForDeposit({
          poolId: 'usdc-eurc-stable-pool',
          amountA: 10,
          amountB: 10,
          reserveA: 0,
          reserveB: 0,
          totalLp: 0,
        })
      ).toBeNull()
    })

    it('removes the fabricated 0.998 LP conversion from the modal source', () => {
      expect(poolModalSource).not.toMatch(/inputAmountNum \* 0\.998/)
      expect(poolModalSource).toMatch(/estimateLpSharesForDeposit/)
    })
  })

  describe('0.6 Slippage guards are never silently zero', () => {
    it('refuses swaps without a positive minimum-output guard', () => {
      expect(usePoolsSource).toMatch(/A positive minimum-output guard is required/)
    })

    it('refuses addLiquidity without a positive minLpShares guard on a seeded pool', () => {
      expect(usePoolsSource).toMatch(/Unable to compute a safe minimum LP-shares guard/)
    })
  })
})
