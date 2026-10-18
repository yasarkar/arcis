// Low-severity (D) cleanup pins for the Pools surface.
//
// These guard the honest-valuation and display-consistency fixes applied while closing the
// Pools audit: no 1:1 USD valuation of unpriceable/unvalueable amounts, no stale price-trust
// flags from cache, and no unit-less numeric fallbacks in the LP composition display.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const usePoolsSource = [
  readFileSync(new URL('../../hooks/usePoolsData.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolQueries.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolDepositService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolWithdrawService.ts', import.meta.url), 'utf8'),
].join('\n')
const poolCardSource = readFileSync(new URL('../../components/pools/PoolCard.tsx', import.meta.url), 'utf8')
const heroStatsSource = readFileSync(new URL('../../components/pools/PoolsHeroStats.tsx', import.meta.url), 'utf8')

describe('D1 — raw LP tokens are never counted 1:1 as USD', () => {
  it('drops the fabricated LP→USD fallback when totalLp is unreadable', () => {
    expect(usePoolsSource).not.toMatch(/stakedUsd = parseFloat\(formatUnits\(lpRaw, 18\)\)/)
  })

  it('marks the position unvalueable so the withdrawal guard refuses instead', () => {
    expect(usePoolsSource).toMatch(/priceUnavailable: !isValuationTrusted \|\| !\(totalLp > 0n\)/)
  })
})

describe('D2 — optimistic updates never price cirBTC at $1', () => {
  it('values the counter side at the live price instead of `pool.exchangeRate || 1`', () => {
    expect(usePoolsSource).not.toMatch(/pool\.exchangeRate \|\| 1\)/)
    expect(usePoolsSource).toMatch(/const counterUsdPrice = poolId === 'usdc-eurc-stable-pool' \? liveEurcPrice : liveBtcPrice/)
  })
})

describe('D3 — price trust is refreshed on every cache read', () => {
  it('recomputes priceUnavailable from the live feed instead of returning the cached flag', () => {
    expect(usePoolsSource).toMatch(/priceUnavailable: !freshTrusted/)
    expect(usePoolsSource).toMatch(/Object\.entries\(cached\)\.map/)
  })
})

describe('D4/D5 — display consistency', () => {
  it('shows an em-dash for the empty-pool composition ratio instead of a unit-less 0.00', () => {
    expect(poolCardSource).not.toContain(": '0.00'")
    expect(poolCardSource).not.toContain('No Reserves (0.00)')
  })

  it('labels the portfolio APY tooltip as including the estimated incentive component', () => {
    expect(heroStatsSource).toMatch(/Includes the estimated incentive component/)
  })
})
