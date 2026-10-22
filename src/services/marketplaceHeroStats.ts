// src/services/marketplaceHeroStats.ts
// Financial figures for the AI Services hero card, derived from the shared settlement ledger.
//
// `User Savings` and `Protocol Fee` used to read the browser-local ecosystem tally: a per-device
// counter that a visitor who had never paid from this tab always saw as 0, presented next to two
// protocol-wide numbers. They are now pure functions of `PlatformStatsSnapshot`, so all four figures
// on the card agree about their source and about what "unavailable" means.

import type { PlatformStatsSnapshot } from '../types/x402'

/**
 * What a standard Web2 API request costs per call, in USD. This is the baseline a pay-per-call route
 * is measured against; it is a stated assumption, not a measurement, and lives here so the card and
 * the local tally cannot disagree about it.
 */
export const WEB2_CALL_BASELINE_USD = 0.05

export interface MarketplaceHeroStats {
  /** Facilitator-accepted calls, or null when the shared counter is unreadable. */
  paidCalls: number | null
  /** accepted × baseline − ledger volume, floored at zero. Null when unreadable. */
  userSavingsUsd: number | null
  /** protocolFeeBps of the ledger volume, in USDC. Null when unreadable. */
  protocolFeeUsdc: number | null
  /** Accepted but not yet Circle-confirmed calls. Null when unreadable. */
  pendingCalls: number | null
}

function round6(value: number): number {
  return Number(value.toFixed(6))
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * A missing or `unavailable` snapshot yields nulls rather than zeros: the card renders a dash, so a
 * counter outage can never be mistaken for "no paid calls" or "no savings".
 */
export function deriveMarketplaceHeroStats(
  snapshot: PlatformStatsSnapshot | null,
  protocolFeeBps: number
): MarketplaceHeroStats {
  if (!snapshot || snapshot.source === 'unavailable') {
    return { paidCalls: null, userSavingsUsd: null, protocolFeeUsdc: null, pendingCalls: null }
  }

  const accepted = Math.max(0, Math.trunc(finiteOrZero(snapshot.acceptedCalls)))
  const settled = Math.max(0, Math.trunc(finiteOrZero(snapshot.settledCalls)))
  const volumeUsdc = Math.max(0, finiteOrZero(snapshot.volumeUsdc))
  const bps = Math.max(0, finiteOrZero(protocolFeeBps))

  return {
    paidCalls: accepted,
    // Summing per-call savings is the same as comparing the ledger's totals, because the ledger
    // counts the amount of every accepted call.
    userSavingsUsd: round6(Math.max(0, accepted * WEB2_CALL_BASELINE_USD - volumeUsdc)),
    protocolFeeUsdc: round6((volumeUsdc * bps) / 10000),
    pendingCalls: Math.max(0, accepted - settled),
  }
}
