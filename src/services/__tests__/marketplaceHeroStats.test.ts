import { describe, expect, it } from 'vitest'
import type { PlatformStatsSnapshot } from '../../types/x402'
import { deriveMarketplaceHeroStats, WEB2_CALL_BASELINE_USD } from '../marketplaceHeroStats'

function ledger(overrides: Partial<PlatformStatsSnapshot> = {}): PlatformStatsSnapshot {
  return {
    source: 'ledger',
    acceptedCalls: 8,
    settledCalls: 3,
    volumeUsdc: 0.032,
    byService: [],
    updatedAt: 1_792_608_233_492,
    ...overrides,
  }
}

describe('marketplace hero stats', () => {
  it('derives savings from the ledger totals, not from a browser-local tally', () => {
    const stats = deriveMarketplaceHeroStats(ledger(), 0)

    expect(stats.paidCalls).toBe(8)
    expect(stats.userSavingsUsd).toBe(Number((8 * WEB2_CALL_BASELINE_USD - 0.032).toFixed(6)))
    expect(stats.pendingCalls).toBe(5)
  })

  it('tracks a growing ledger without any local spending', () => {
    const first = deriveMarketplaceHeroStats(ledger(), 0)
    const next = deriveMarketplaceHeroStats(ledger({ acceptedCalls: 10, volumeUsdc: 0.04 }), 0)

    expect(next.userSavingsUsd).toBeGreaterThan(first.userSavingsUsd ?? 0)
    expect(next.paidCalls).toBe(10)
  })

  it('computes the protocol fee from ledger volume and the manifest bps', () => {
    const stats = deriveMarketplaceHeroStats(ledger({ volumeUsdc: 10 }), 100)

    expect(stats.protocolFeeUsdc).toBe(0.1)
  })

  it('reports a zero fee when every service charges zero bps', () => {
    const stats = deriveMarketplaceHeroStats(ledger({ volumeUsdc: 0.032 }), 0)

    expect(stats.protocolFeeUsdc).toBe(0)
  })

  it('floors savings at zero when the ledger volume exceeds the baseline', () => {
    const stats = deriveMarketplaceHeroStats(ledger({ acceptedCalls: 1, volumeUsdc: 1 }), 0)

    expect(stats.userSavingsUsd).toBe(0)
  })

  it('never reports negative counters or fees from a malformed snapshot', () => {
    const stats = deriveMarketplaceHeroStats(
      ledger({ acceptedCalls: -4, settledCalls: 99, volumeUsdc: Number.NaN }),
      Number.NaN
    )

    expect(stats.paidCalls).toBe(0)
    expect(stats.pendingCalls).toBe(0)
    expect(stats.userSavingsUsd).toBe(0)
    expect(stats.protocolFeeUsdc).toBe(0)
  })

  it('renders as unavailable, not as zero, when the shared ledger cannot be read', () => {
    const unavailable = deriveMarketplaceHeroStats(ledger({ source: 'unavailable' }), 100)
    const missing = deriveMarketplaceHeroStats(null, 100)

    for (const stats of [unavailable, missing]) {
      expect(stats).toEqual({
        paidCalls: null,
        userSavingsUsd: null,
        protocolFeeUsdc: null,
        pendingCalls: null,
      })
    }
  })

  it('still derives the development memory counter, which is a real local ledger', () => {
    const stats = deriveMarketplaceHeroStats(ledger({ source: 'memory', acceptedCalls: 2 }), 0)

    expect(stats.paidCalls).toBe(2)
    expect(stats.userSavingsUsd).toBe(Number((2 * WEB2_CALL_BASELINE_USD - 0.032).toFixed(6)))
  })
})
