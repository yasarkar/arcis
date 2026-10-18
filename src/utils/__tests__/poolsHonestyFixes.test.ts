// Pools Honesty Fixes — audit report findings H1 / H2 / H3.
//
//   H1: the Harvest button's amount and enabled state come ONLY from the on-chain claimable
//       (`pendingFees` / `pendingYield`, surfaced as `userPosition.earnedUsd`). The ticking
//       client-side yield stream is a display-only projection and must never be presented
//       as claimable (PoolCard previously did `Math.max(earnedUsd, accumulatedYield, ...)`).
//   H2: the vault APY's dynamic component is a MEASURED rolling-window rate of real
//       distributed yield — never the cumulative lifetime `totalYieldDistributed` annualized
//       (`totalYield * 365 / tvl` overstated APY by orders of magnitude).
//   H3: a partial withdrawal can never silently become a 100% exit when the position
//       valuation is missing (`|| userStakedUsd <= 0` used to redeem/remove everything).

import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import PoolCard from '../../components/pools/PoolCard'
import { measureVaultYieldApy, safeStorage } from '../../hooks/usePoolsData'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'

const usePoolsSource = [
  readFileSync(new URL('../../hooks/usePoolsData.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolQueries.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolDepositService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolWithdrawService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolSwapService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolClaimService.ts', import.meta.url), 'utf8'),
].join('\n')
const poolCardSource = readFileSync(new URL('../../components/pools/PoolCard.tsx', import.meta.url), 'utf8')

describe('H1 — Harvest amount is strictly on-chain claimable', () => {
  it('never mixes the ticking projection into the claimable amount', () => {
    expect(poolCardSource).not.toMatch(/Math\.max\(earnedUsd/)
    expect(poolCardSource).not.toMatch(/effectiveClaimableUsd/)
    expect(poolCardSource).toMatch(/const claimableUsd = earnedUsd/)
    expect(poolCardSource).toMatch(/const isClaimReady = claimableUsd >= 0\.01/)
  })

  const renderCard = (earnedUsd: number) => {
    const pool = {
      id: 'usdc-eurc-stable-pool',
      name: 'USDC / EURC Stable Pool',
      subtitle: 'Earn FX swap fees.',
      description: 'Provide liquidity for USDC/EURC swaps.',
      category: 'liquidity',
      tokens: [
        { symbol: 'USDC', name: 'USD Coin', iconType: 'usdc', decimals: 6 },
        { symbol: 'EURC', name: 'Euro Coin', iconType: 'eurc', decimals: 6 },
      ],
      apy: 6.15,
      apyType: 'APY',
      apyBadge: 'badge',
      tvlUsd: 1000,
      volume24hUsd: 100,
      lockPeriod: 'No Lock',
      riskLevel: 'Safe',
      feeShare: '0.12% Swap Fee to LPs',
      contractAddress: '0x0000000000000000000000000000000000000001',
      depositTokenSymbol: 'USDC + EURC',
      rewardTokenSymbol: 'LP Fees',
      isLiveOnChain: true,
      executionMode: 'onchain_verified',
      tags: [],
      yieldOrigin: 'FX Swap Fees',
      yieldOriginDetails: 'Swap fees accrue to LPs.',
      isLpPool: true,
      lpTokenName: 'Arcis USDC-EURC LP',
      lpTokenSymbol: 'af-USDC-EURC',
      feeTierPercent: 0.12,
      reserves: { tokenA: 500, tokenB: 500, ratioA: 50, ratioB: 50 },
      impermanentLossRisk: 'Zero (Stable)',
      userPosition: {
        poolId: 'usdc-eurc-stable-pool',
        stakedAmount: '100.00',
        stakedUsd: 100,
        earnedRewards: earnedUsd.toFixed(4),
        earnedUsd,
        lastUpdatedTimestamp: 0,
        isLpPosition: true,
        lpTokenBalance: '50.00',
        poolSharePct: 1,
        tokenAStaked: '50.00',
        tokenBStaked: '50.00',
      } satisfies UserPoolPosition,
    } as unknown as PoolConfig & { userPosition?: UserPoolPosition }

    return renderToStaticMarkup(
      React.createElement(PoolCard, {
        pool,
        walletConnected: true,
        onDeposit: () => {},
        onWithdraw: () => {},
        onClaim: () => {},
      })
    )
  }

  it('shows the real on-chain amount on the Harvest button', () => {
    const html = renderCard(5)
    expect(html).toContain('Harvest +5.0000')
    expect(html).not.toContain('Harvest (< 0.01)')
  })

  it('keeps Harvest disabled below the 0.01 on-chain threshold', () => {
    const html = renderCard(0.004)
    expect(html).toContain('Harvest (&lt; 0.01)')
    expect(html).not.toContain('Harvest +0.0040')
  })
})

describe('H2 — vault APY uses a measured window, never cumulative × 365', () => {
  const T0 = 1_700_000_000_000
  const DAY = 24 * 60 * 60 * 1000

  beforeEach(() => {
    safeStorage.clearMemory()
  })

  it('does not annualize the lifetime cumulative yield figure', () => {
    expect(usePoolsSource).not.toMatch(/totalYield \* 365/)
    expect(usePoolsSource).toMatch(/measureVaultYieldApy\(totalYield, assetsUsd\)/)
  })

  it('reports 0 until a full observation window has elapsed', () => {
    expect(measureVaultYieldApy(100, 1000, T0)).toBe(0) // seeds baseline
    expect(measureVaultYieldApy(100, 1000, T0 + 6 * 3600 * 1000)).toBe(0) // 6h < 24h
    expect(measureVaultYieldApy(110, 1000, T0 + 12 * 3600 * 1000)).toBe(0) // still < 24h
  })

  it('annualizes only the measured yield delta over the window', () => {
    expect(measureVaultYieldApy(100, 1000, T0)).toBe(0) // seed: yield=100 @ T0
    // +10 USDC distributed over exactly 1 day on a 1000 USDC vault => 10/day => 3650/yr => 365%
    expect(measureVaultYieldApy(110, 1000, T0 + DAY)).toBe(365)
    // Next window: no new distribution => measured rate is 0, not the lifetime figure.
    expect(measureVaultYieldApy(110, 1000, T0 + 2 * DAY)).toBe(0)
  })

  it('re-seeds the baseline when the cumulative counter regresses (new deployment)', () => {
    expect(measureVaultYieldApy(100, 1000, T0)).toBe(0)
    // Counter went backwards -> re-seed at the new value, report 0.
    expect(measureVaultYieldApy(50, 1000, T0 + 2 * DAY)).toBe(0)
    // From the new baseline: +10 over 1 day => 365% annualized on 1000 TVL.
    expect(measureVaultYieldApy(60, 1000, T0 + 3 * DAY)).toBe(365)
  })

  it('returns 0 for zero or invalid inputs', () => {
    expect(measureVaultYieldApy(0, 1000, T0)).toBe(0)
    expect(measureVaultYieldApy(100, 0, T0)).toBe(0)
    expect(measureVaultYieldApy(Number.NaN, 1000, T0)).toBe(0)
    expect(measureVaultYieldApy(100, Number.NaN, T0)).toBe(0)
  })
})

describe('H3 — partial withdrawal can never silently become a full exit', () => {
  it('requires a positive position valuation for the full-exit path', () => {
    // Both the vault and the LP branch must gate the full-exit path on a real valuation.
    expect(usePoolsSource).not.toMatch(/\|\| userStakedUsd <= 0/)
    expect(usePoolsSource).toMatch(/userStakedUsd > 0 && withdrawAmountUsd >= userStakedUsd \* 0\.999/)
  })

  it('refuses (rather than exits) LP withdrawals when the valuation is unavailable', () => {
    expect(usePoolsSource).toMatch(/prevents an unintended full exit/)
  })

  it('guards tiny vault redemptions instead of submitting a zero-share redeem', () => {
    expect(usePoolsSource).toMatch(/if \(sharesToRedeem === 0n\) \{[\s\S]*?Withdrawal amount too small/)
  })
})
