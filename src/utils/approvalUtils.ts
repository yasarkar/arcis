// src/utils/approvalUtils.ts
//
// Exact-amount ERC-20 approvals (audit #6, #11).
//
// Every fund-moving path in this app (swap, send, bridge, Gateway, pools) grants
// an allowance for EXACTLY the amount the transaction moves. A standing ceiling —
// even a "finite" 10M-token one — is indistinguishable from an unlimited approval
// for a retail wallet: a compromised or buggy spender could pull the whole balance
// with it, so the worst case would be bounded by the wallet, not by the amount the
// user reviewed. An exact approval leaves nothing behind once the spender has
// pulled the amount, and it costs only one extra (cheap, USDC-priced on Arc)
// transaction per operation.

/**
 * Refuse to encode an approval above this many base units.
 *
 * Every real token amount is astronomically far below it (2^200 ≈ 1.6e60 base
 * units is 1.6e42 whole tokens at 18 decimals), while an "infinite approval"
 * value such as `maxUint256` is far above it. Failing closed here means a caller
 * that hands us a placeholder instead of a real amount can never turn into a
 * standing allowance.
 */
export const IMPLAUSIBLE_APPROVAL_UNITS = 2n ** 200n

/**
 * The allowance a single transaction needs: exactly `amountInUnits`.
 *
 * Fails closed on a non-positive or implausible amount instead of falling back
 * to a ceiling — a wrong amount must never become a durable grant.
 */
export function exactApprovalAmount(amountInUnits: bigint): bigint {
  if (amountInUnits <= 0n) {
    throw new Error('An ERC-20 approval requires a positive amount; no allowance was granted.')
  }
  if (amountInUnits >= IMPLAUSIBLE_APPROVAL_UNITS) {
    throw new Error(
      'The requested approval amount is not a plausible token amount (an unlimited approval was refused).'
    )
  }
  return amountInUnits
}

/**
 * Top-up for `increaseAllowance` so the resulting allowance is exactly
 * `requiredInUnits`: `required - current` when the existing allowance only covers
 * part of it. `increaseAllowance` ADDS, so granting the full amount would leave
 * the wallet with more allowance than this transaction needs.
 *
 * When the existing allowance already covers the amount (which the SDK normally
 * filters out before asking for an approval) the transaction's own amount is
 * used: it is still bounded by the transaction the user is confirming, never a
 * reusable ceiling.
 */
export function increaseAllowanceShortfall(
  requiredInUnits: bigint,
  currentAllowanceInUnits: bigint
): bigint {
  if (requiredInUnits <= 0n || requiredInUnits >= IMPLAUSIBLE_APPROVAL_UNITS) {
    throw new Error('An ERC-20 approval requires a plausible positive amount; no allowance was granted.')
  }
  return currentAllowanceInUnits < requiredInUnits
    ? requiredInUnits - currentAllowanceInUnits
    : requiredInUnits
}
