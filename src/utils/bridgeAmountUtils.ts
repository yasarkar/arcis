// src/utils/bridgeAmountUtils.ts
//
// Shared amount/budget helpers for cross-chain flows (Bridge, Send).

/**
 * Circle Gateway draws a transfer from a single source domain whose balance must
 * cover amount + maxFee. maxFee is floored at 1.0 USDC by Circle; cross-domain
 * transfers add a 0.005% transfer fee plus a 0.05 USDC gas buffer.
 *
 * Mirrors the requirement enforced by `transferFromGateway`'s pre-flight check.
 */
export function gatewayMaxFeeUsdc(amount: number): number {
  const transferFee = Number.isFinite(amount) && amount > 0 ? amount * 0.00005 : 0
  return Math.max(1, transferFee + 0.05)
}

export interface BridgeAmountReserves {
  /** Flat USDC debited on top of the amount (Direct CCTP platform fee). */
  platformFeeUsdc: number
  /** Gateway maxFee headroom the pre-flight requires (0 outside Gateway mode). */
  gatewayMaxFeeUsdc: number
}

/** One entry of the fee list Circle's App Kit `estimateBridge` returns. */
export interface BridgeEstimatedFee {
  /** 'provider' (CCTP burn fee), 'forwarder' (destination gas) or 'kit' (Arcis platform fee). */
  type?: string
  amount?: string | null
}

/**
 * Sum of the fees actually deducted from the bridged amount: the CCTP provider
 * fee and the forwarder fee. The `kit` entry is Arcis's own platform fee, which
 * Circle adds ON TOP of the transfer amount — the amount proceeds through CCTPv2
 * unchanged — so it must NOT reduce Net Received. It is disclosed in its own
 * Platform Fee row; counting it here understated Net Received by the platform fee.
 */
export function sumBridgeDeductedFees(fees?: BridgeEstimatedFee[] | null): number {
  return (fees ?? []).reduce((acc, fee) => {
    if (fee?.type === 'kit') return acc
    const parsed = fee?.amount ? parseFloat(fee.amount) : 0
    return acc + (Number.isFinite(parsed) ? parsed : 0)
  }, 0)
}

function toPositiveNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : parseFloat(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function clampToUsdc(value: number): string {
  // Truncate (never round up) at 6 USDC decimals: rounding 99.9999995 up to
  // 100.000000 would push the debit over the balance and re-trigger the
  // INSUFFICIENT error MAX is supposed to prevent. Mirrors truncateToDecimal.
  const truncated = Math.trunc(Math.max(0, value) * 1e6) / 1e6
  return truncated.toString()
}

/**
 * Largest amount that can actually be bridged from `balance` right now.
 *
 * Clicking MAX must never produce a request the execution layer rejects:
 * Direct CCTP debits the platform fee on top of the amount, and the Gateway
 * pre-flight requires balance ≥ amount + maxFee. Reserving both up-front is what
 * makes MAX safe in every mode.
 */
export function maxBridgeAmount(balance: string | number, reserves: BridgeAmountReserves): string {
  const available =
    toPositiveNumber(balance) - reserves.platformFeeUsdc - reserves.gatewayMaxFeeUsdc
  return clampToUsdc(available)
}

/**
 * Percentage-of-balance amount, clamped to the same available budget as MAX so
 * the 100% button can never exceed what `maxBridgeAmount` allows.
 */
export function bridgeAmountForPercentage(
  balance: string | number,
  percentage: number,
  reserves: BridgeAmountReserves
): string {
  const balanceValue = toPositiveNumber(balance)
  const pct = Math.min(100, Math.max(0, Number.isFinite(percentage) ? percentage : 0))
  const requested = (balanceValue * pct) / 100
  const available =
    balanceValue - reserves.platformFeeUsdc - reserves.gatewayMaxFeeUsdc
  return clampToUsdc(Math.min(requested, available))
}
