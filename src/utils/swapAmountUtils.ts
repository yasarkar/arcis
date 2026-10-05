// src/utils/swapAmountUtils.ts
//
// Shared rounding helpers for swap input amounts and MAX / quick-% actions.
//
// Balances and swap inputs are always FLOORED to the displayed precision. `toFixed()` rounds
// half-up, so `12.345678 USDC` used to display (and MAX-fill) as `12.35` — an amount larger than
// the wallet actually holds, which made swaps revert after the allowance check passed.

/** Floors a value to `places` decimals; never returns a value above the real amount. */
export function floorToPlaces(value: number, places: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const factor = 10 ** places
  // Small epsilon absorbs binary float error (1.13 * 100 === 112.99999999999999) without ever
  // pushing a genuinely sub-integer value over the next step.
  return Math.floor(value * factor + 1e-6) / factor
}

/**
 * Arc Testnet pays gas natively in USDC, so a MAX swap on USDC must leave a reserve behind —
 * otherwise the entire balance is spent as input and the transaction can never be paid for.
 * Passkey (MSCA) swaps are paymaster-sponsored and do not need the reserve.
 */
export const ARC_GAS_BUFFER_USDC = 0.01

/**
 * Largest spendable input amount for a swap: the floored balance minus the optional gas reserve.
 * Returns 0 when nothing usable is left (so callers show "enter an amount" instead of swapping 0).
 */
export function computeMaxSpendable(
  balance: string | number,
  places: number,
  reserveGasBuffer: boolean
): number {
  const parsed = typeof balance === 'number' ? balance : parseFloat(balance)
  const floored = floorToPlaces(parsed, places)
  if (floored <= 0) return 0
  if (!reserveGasBuffer) return floored
  return floorToPlaces(floored - ARC_GAS_BUFFER_USDC, places)
}

/**
 * Clamps a decimal input string to `maxDecimals` fractional digits (audit #13): `parseUnits`
 * throws on excess precision and that raw error used to leak into the quote panel.
 * Returns the (possibly truncated) value, or null when it is not a well-formed decimal number.
 */
export function clampDecimalInput(value: string, maxDecimals?: number): string | null {
  const normalized = String(value ?? '').replace(/,/g, '.')
  if (normalized === '') return ''
  if (!/^\d*\.?\d*$/.test(normalized)) return null
  if (maxDecimals === undefined || !Number.isFinite(maxDecimals) || maxDecimals < 0) return normalized

  const dot = normalized.indexOf('.')
  if (dot === -1) return normalized
  const fraction = normalized.slice(dot + 1)
  if (fraction.length <= maxDecimals) return normalized
  return normalized.slice(0, dot + 1 + maxDecimals)
}

/** Floors a quick-percentage selection (25/50/75/100) against the spendable cap. */
export function computeQuickAmount(cap: number, pct: number, places: number): number {
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(pct) || pct <= 0) return 0
  const calculated = pct >= 100 ? cap : (cap * pct) / 100
  return floorToPlaces(calculated, places)
}
