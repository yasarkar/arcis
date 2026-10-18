// O2 + O4 guard verification.
//
// O2: both V4 pool contracts transfer BOTH full input amounts but only credit
// min(lpA, lpB) (ConstantProduct) or the Curve D-delta (StableSwap), so an off-ratio
// dual deposit silently donates the excess to existing LPs. analyzeDualDepositBalance
// must quantify that donation accurately per pool type.
//
// O4: USD valuations must never collapse to $0 when the price feed is unavailable, and
// unpriceable tokens must fail closed in tokenAmountToUsd.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  analyzeDualDepositBalance,
  optimizeDualDepositAmounts,
  DUAL_DEPOSIT_DONATION_WARN_PCT,
  DUAL_DEPOSIT_DONATION_BLOCK_PCT,
} from '../poolMath'

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
const priceServiceSource = readFileSync(new URL('../../services/tokenPriceService.ts', import.meta.url), 'utf8')

describe('analyzeDualDepositBalance (O2 — unbalanced deposit donation)', () => {
  it('credits a ratio-matched constant-product deposit in full (no donation)', () => {
    // Pool: 1000 USDC / 0.1 cirBTC. Ratio-matched deposit: 100 USDC / 0.01 cirBTC.
    const balance = analyzeDualDepositBalance({
      poolId: 'usdc-cirbtc-pool',
      amountA: 100,
      amountB: 0.01,
      reserveA: 1000,
      reserveB: 0.1,
      totalLp: 100,
    })
    expect(balance).not.toBeNull()
    expect(balance!.donationValueA).toBeLessThan(1e-9)
    expect(balance!.donationPct).toBeLessThan(1e-9)
    expect(balance!.estimatedShares).toBeCloseTo(10, 6)
  })

  it('quantifies the excess donated to existing LPs on an off-ratio constant-product deposit', () => {
    // 100 USDC + 0.02 cirBTC (200 USDC worth) into 1000 USDC / 0.1 cirBTC:
    // shares = min(lpA, lpB) = lpA → only 100 USDC worth mints LP; the surplus cirBTC
    // stays in the reserves. Honest donation = excess × reserveA/(reserveA+amountA)
    // = 100 × 1000/1100 ≈ 90.91 USDC.
    const balance = analyzeDualDepositBalance({
      poolId: 'usdc-cirbtc-pool',
      amountA: 100,
      amountB: 0.02,
      reserveA: 1000,
      reserveB: 0.1,
      totalLp: 100,
    })
    expect(balance).not.toBeNull()
    expect(balance!.donationValueA).toBeCloseTo(90.91, 1)
    expect(balance!.donationPct).toBeCloseTo(30.3, 1)
    expect(balance!.donationPct).toBeGreaterThan(DUAL_DEPOSIT_DONATION_BLOCK_PCT)
  })

  it('flags excess on the token-A side symmetrically', () => {
    // 200 USDC (2× the matched amount) + 0.01 cirBTC.
    const balance = analyzeDualDepositBalance({
      poolId: 'usdc-cirbtc-pool',
      amountA: 200,
      amountB: 0.01,
      reserveA: 1000,
      reserveB: 0.1,
      totalLp: 100,
    })
    expect(balance).not.toBeNull()
    expect(balance!.donationValueA).toBeCloseTo(90.91, 1)
    expect(balance!.donationPct).toBeGreaterThan(DUAL_DEPOSIT_DONATION_BLOCK_PCT)
  })

  it('trims the excess side down to the pool ratio', () => {
    const optimized = optimizeDualDepositAmounts({
      poolId: 'usdc-cirbtc-pool',
      amountA: 100,
      amountB: 0.02,
      reserveA: 1000,
      reserveB: 0.1,
      totalLp: 100,
    })
    expect(optimized).not.toBeNull()
    expect(optimized!.amountA).toBeCloseTo(100, 6)
    expect(optimized!.amountB).toBeCloseTo(0.01, 8)

    // Symmetric case: excess on side A is trimmed instead.
    const optimizedA = optimizeDualDepositAmounts({
      poolId: 'usdc-cirbtc-pool',
      amountA: 200,
      amountB: 0.01,
      reserveA: 1000,
      reserveB: 0.1,
      totalLp: 100,
    })
    expect(optimizedA).not.toBeNull()
    expect(optimizedA!.amountA).toBeCloseTo(100, 6)
    expect(optimizedA!.amountB).toBeCloseTo(0.01, 8)
  })

  it('credits a balanced stable-pair deposit in full via the D-delta', () => {
    const balance = analyzeDualDepositBalance({
      poolId: 'usdc-eurc-stable-pool',
      amountA: 100,
      amountB: 100,
      reserveA: 5000,
      reserveB: 5000,
      totalLp: 10000,
    })
    expect(balance).not.toBeNull()
    expect(balance!.donationValueA).toBeLessThan(0.01)
    expect(balance!.donationPct).toBeLessThan(0.01)
  })

  it('does not overstate the donation for mildly off-ratio stable-pair deposits', () => {
    // The amplified stable invariant credits imbalanced deposits at only a mild penalty,
    // so the D-delta-derived donation must stay below the UI warning threshold here.
    const balance = analyzeDualDepositBalance({
      poolId: 'usdc-eurc-stable-pool',
      amountA: 100,
      amountB: 92,
      reserveA: 5000,
      reserveB: 5000,
      totalLp: 10000,
    })
    expect(balance).not.toBeNull()
    expect(balance!.donationPct).toBeLessThan(DUAL_DEPOSIT_DONATION_WARN_PCT)
    // The optimized amounts still snap back to the 1:1 pool ratio.
    expect(balance!.optimizedAmountA).toBeCloseTo(92, 6)
    expect(balance!.optimizedAmountB).toBeCloseTo(92, 6)
  })

  it('returns null when live reserves or total LP supply are missing (empty pool seeding)', () => {
    expect(
      analyzeDualDepositBalance({ poolId: 'usdc-cirbtc-pool', amountA: 100, amountB: 0.01, reserveA: 0, reserveB: 0, totalLp: 0 })
    ).toBeNull()
    expect(
      analyzeDualDepositBalance({ poolId: 'usdc-cirbtc-pool', amountA: 0, amountB: 0.01, reserveA: 1000, reserveB: 0.1, totalLp: 100 })
    ).toBeNull()
    expect(
      analyzeDualDepositBalance({ poolId: 'usdc-cirbtc-pool', amountA: NaN, amountB: 0.01, reserveA: 1000, reserveB: 0.1, totalLp: 100 })
    ).toBeNull()
  })
})

describe('source pins (O2 guard wiring)', () => {
  it('refuses off-ratio dual deposits in depositDual before any transfer', () => {
    expect(usePoolsSource).toMatch(/analyzeDualDepositBalance/)
    expect(usePoolsSource).toMatch(/would be donated to existing LPs instead of minting LP shares/)
  })

  it('warns and blocks in the dual-deposit modal, with a ratio-balancing action', () => {
    expect(poolModalSource).toMatch(/analyzeDualDepositBalance/)
    expect(poolModalSource).toMatch(/Unbalanced deposit — excess is donated to existing LPs/)
    expect(poolModalSource).toMatch(/Balance amounts to pool ratio/)
    expect(poolModalSource).toMatch(/isDualIncomplete \|\| isDualInsuffA \|\| isDualInsuffB \|\| isDualDonationBlock/)
  })
})

describe('source pins (O4 price-feed fail-closed wiring)', () => {
  it('marks LP positions when the counter-token price is not oracle-verified', () => {
    expect(usePoolsSource).toMatch(/priceUnavailable: !isValuationTrusted/)
    expect(usePoolsSource).toMatch(/userStakedUsd <= 0 \|\| userPos\?\.priceUnavailable/)
  })

  it('never multiplies USD valuations by a zero fallback price', () => {
    expect(usePoolsSource).not.toMatch(/getCachedTokenPrice\('BTC'\) : 0/)
    expect(usePoolsSource).not.toMatch(/getCachedTokenPrice\('EURC'\) : 0/)
  })

  it('fails tokenAmountToUsd closed for unpriceable tokens (no 1:1 USD fallback)', () => {
    expect(priceServiceSource).toMatch(/UNPRICED_TOKEN_USD_CEILING/)
    expect(priceServiceSource).not.toMatch(/price > 0 \? safeAmount \* price : safeAmount/)
  })
})
