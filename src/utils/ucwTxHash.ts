// src/utils/ucwTxHash.ts
// Single source of truth for "is this really an on-chain transaction hash?" in the Circle UCW flow.
//
// A Circle challenge can finish (the user signed in the SDK iframe) while Circle has not yet published
// the broadcast transaction hash. The UCW hook used to paper over that window by returning
// `pending_<challengeId>` as `txHash`, which callers then treated as a confirmed transaction — the
// pools UI reported a successful harvest with an explorer link that could never exist. A placeholder is
// never a transaction, so it is rejected here and callers must surface the pending state instead.

/** 32-byte hex transaction hash. */
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** Narrow an unknown value to a real transaction hash. */
export function isRealTxHash(value: unknown): value is string {
  return typeof value === 'string' && TX_HASH_RE.test(value)
}

/** The shape of a finished Circle UCW contract-execution challenge (subset we depend on). */
export interface UcwChallengeResult {
  success: boolean
  txHash?: string
  /** The challenge executed, but Circle has not published the transaction hash yet. */
  hashPending?: boolean
  challengeId?: string
  error?: string
}

/**
 * The on-chain hash to wait on, or `null` while no real hash is available.
 * Placeholders such as `pending_<challengeId>` are never returned.
 */
export function resolveUcwTxHash(result: UcwChallengeResult | null | undefined): string | null {
  if (!result) return null
  return isRealTxHash(result.txHash) ? result.txHash : null
}

/** Honest message for callers that must report a submitted-but-unverified UCW action. */
export function ucwHashPendingMessage(action: string): string {
  return (
    `${action} was submitted through your Circle wallet, but Circle has not published the on-chain ` +
    `transaction hash yet. Check the transaction history before retrying — the action may still settle.`
  )
}
