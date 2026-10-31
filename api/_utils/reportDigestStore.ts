// api/_utils/reportDigestStore.ts
// Server-side storage for per-wallet report digests.
//
// The shelf reads this; the tollgate writes it after a paid call settles. Keyed by payer address
// and namespaced like the other shared counters, so preview, production and local development do
// not read each other's entries.
//
// The value is a convenience memory, not money: the read-modify-write below is not atomic, so two
// simultaneous calls for one wallet can lose the older service entry. That is acceptable for a
// "last report per service" cache; no ledger, receipt or balance depends on it.

import {
  emptyReportDigestStore,
  mergeReportDigest,
  parseReportDigestStore,
  type ReportDigest,
  type ReportDigestStore,
} from '../../src/services/x402/reportDigest'
import { kvGet, kvSet } from './redisStorage'
import { getPlatformStatsNamespace } from './x402Stats'

/** A digest is a convenience memory; ninety days is longer than any recommendation stays useful. */
export const REPORT_DIGEST_TTL_SECONDS = 90 * 24 * 60 * 60

export function reportDigestKey(
  payer: string,
  namespace: string = getPlatformStatsNamespace()
): string {
  return `arcis:x402:digests:v1:${namespace}:${payer.toLowerCase()}`
}

/** Unreadable storage yields an empty store, never a fabricated entry. */
export async function readReportDigests(payer: string): Promise<ReportDigestStore> {
  try {
    return parseReportDigestStore(await kvGet(reportDigestKey(payer)), payer)
  } catch (err) {
    console.warn('[x402-digest] Report digests could not be read:', err)
    return emptyReportDigestStore(payer)
  }
}

/**
 * Best-effort write: a failed digest never changes the outcome of a paid call. The return value
 * reports durability (`kvSet` answers false when only the in-process mirror was written, which is
 * the normal case in local development), not whether the value is readable in this process.
 */
export async function recordReportDigest(digest: ReportDigest): Promise<boolean> {
  try {
    const current = await readReportDigests(digest.payer)
    const merged = mergeReportDigest(current, digest)
    return await kvSet(
      reportDigestKey(digest.payer),
      JSON.stringify(merged),
      REPORT_DIGEST_TTL_SECONDS
    )
  } catch (err) {
    console.warn('[x402-digest] Report digest could not be recorded:', err)
    return false
  }
}
