// src/config/x402/pricing.ts
// Fee calculations, precision helpers, and protocol fee parameters

// Official services charge a protocol fee (`protocolFeeBps: 50` = 0.5%) and settle to the protocol
// treasury, which then pays providers their net earnings on withdrawal. The helper's own default
// stays 0 so a caller that does not pass a rate is never charged by accident.
export const DEFAULT_PROTOCOL_FEE_BPS = 0

/** Fee charged by every official service, in basis points. */
export const OFFICIAL_PROTOCOL_FEE_BPS = 50

export interface FeeSplitResult {
  grossAmountUsdc: number
  protocolFeeUsdc: number
  providerEarnedUsdc: number
  protocolFeeBps: number
}

/**
 * Calculates the exact split between the Protocol YieldVault and the Service Provider.
 * Defaults to 1% (100 basis points).
 */
export function calculateFeeSplit(
  priceUsdc: number,
  feeBps: number = DEFAULT_PROTOCOL_FEE_BPS
): FeeSplitResult {
  const safePrice = Math.max(0, priceUsdc)
  const safeBps = Math.max(0, Math.min(10000, feeBps))

  const protocolFeeUsdc = Number(((safePrice * safeBps) / 10000).toFixed(6))
  const providerEarnedUsdc = Number((safePrice - protocolFeeUsdc).toFixed(6))

  return {
    grossAmountUsdc: safePrice,
    protocolFeeUsdc,
    providerEarnedUsdc,
    protocolFeeBps: safeBps,
  }
}

/**
 * Splits a 6-decimal amount into the protocol fee and the provider's net earnings.
 *
 * Integer math, because a per-call fee at these prices is a handful of micro-USDC and float
 * rounding must never decide who receives a unit.
 */
export function splitSettlementAmount(
  amountMicros: number,
  feeBps: number
): { feeMicros: number; providerMicros: number } {
  const micros = Math.max(0, Math.trunc(Number(amountMicros) || 0))
  const rawBps = Number(feeBps)
  const bps = Number.isFinite(rawBps) ? Math.max(0, Math.min(10_000, Math.trunc(rawBps))) : 0
  const feeMicros = Math.floor((micros * bps) / 10_000)
  return { feeMicros, providerMicros: micros - feeMicros }
}

/**
 * Converts human-readable USDC decimal to 6-decimal integer units string (base units)
 */
export function usdcToBaseUnits(amountUsdc: number): string {
  return Math.round(amountUsdc * 1e6).toString()
}

/**
 * Converts 6-decimal integer base units string to human-readable USDC number
 */
export function baseUnitsToUsdc(baseUnits: string | bigint): number {
  return Number(baseUnits) / 1e6
}
