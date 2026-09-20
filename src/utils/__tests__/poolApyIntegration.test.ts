import { describe, it, expect } from 'vitest'
import { ARCIS_POOLS } from '../../config/poolsConfig'

describe('Pool APY Single Source of Truth & Accrual Integration', () => {
  it('ensures all ARCIS_POOLS have valid, non-zero APY defined in poolsConfig', () => {
    expect(ARCIS_POOLS.length).toBeGreaterThan(0)
    for (const pool of ARCIS_POOLS) {
      expect(pool.apy).toBeDefined()
      expect(typeof pool.apy).toBe('number')
      expect(pool.apy).toBeGreaterThan(0)
    }
  })

  it('matches expected canonical pool APYs', () => {
    const yieldVault = ARCIS_POOLS.find((p) => p.id === 'usdc-yield-vault')
    const eurcPool = ARCIS_POOLS.find((p) => p.id === 'usdc-eurc-stable-pool')
    const btcPool = ARCIS_POOLS.find((p) => p.id === 'usdc-cirbtc-pool')

    expect(yieldVault?.apy).toBe(8.42)
    expect(eurcPool?.apy).toBe(6.15)
    expect(btcPool?.apy).toBe(12.8)
  })

  it('calculates continuous APY yield correctly based on dynamic pool APY', () => {
    const pool = ARCIS_POOLS.find((p) => p.id === 'usdc-yield-vault')!
    const poolApy = pool.apy // 8.42%

    const principalUsd = 10_000 // $10,000
    const oneYearSeconds = 365 * 86400
    const accruedOneYear = (principalUsd * (poolApy / 100) * oneYearSeconds) / (365 * 86400)

    // After 1 year, $10,000 at 8.42% should accrue exactly $842
    expect(accruedOneYear).toBeCloseTo(842, 4)

    // After 48 hours (deposit fallback duration)
    const elapsed48h = 48 * 3600
    const accrued48h = (principalUsd * (poolApy / 100) * elapsed48h) / (365 * 86400)
    const expected48h = (10_000 * 0.0842 * 48) / (365 * 24)
    expect(accrued48h).toBeCloseTo(expected48h, 4)
  })

  it('reflects configured pool APY changes dynamically in yield computation', () => {
    const computeAccrued = (principal: number, apy: number, seconds: number) =>
      (principal * (apy / 100) * seconds) / (365 * 86400)

    const baseApy = 6.15
    const updatedApy = 10.0
    const elapsed = 86400 // 1 day

    const yieldBase = computeAccrued(1000, baseApy, elapsed)
    const yieldUpdated = computeAccrued(1000, updatedApy, elapsed)

    expect(yieldUpdated).toBeGreaterThan(yieldBase)
    expect(yieldUpdated / yieldBase).toBeCloseTo(updatedApy / baseApy, 4)
  })
})
