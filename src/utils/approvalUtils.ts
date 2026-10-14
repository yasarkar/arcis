// src/utils/approvalUtils.ts
//
// Bounded ERC-20 approval ceilings (audit #11).
//
// Never grant an unlimited (maxUint256) allowance: a compromised or buggy
// spender could then move the entire wallet balance instead of one capped
// amount. Every fund-moving path in this app (swap, send, bridge) therefore
// approves a large but FINITE ceiling — or the requested amount when that is
// already larger.

/** 10M whole tokens. Finite by construction; far below uint256 max. */
export const SAFE_APPROVAL_CAP_TOKENS = 10_000_000n

/**
 * The approval amount for `amountInUnits`: a 10,000,000-token ceiling, or the
 * requested amount when that exceeds the ceiling.
 */
export function boundedApprovalAmount(amountInUnits: bigint, decimals: number): bigint {
  const cap = SAFE_APPROVAL_CAP_TOKENS * 10n ** BigInt(decimals)
  return cap > amountInUnits ? cap : amountInUnits
}
