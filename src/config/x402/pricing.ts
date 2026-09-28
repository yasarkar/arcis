// src/config/x402/pricing.ts
// Fee calculations, precision helpers, and protocol fee parameters

export const DEFAULT_PROTOCOL_FEE_BPS = 100 // 1% fee diverted to YieldVault

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
