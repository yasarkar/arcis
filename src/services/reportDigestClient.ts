// src/services/reportDigestClient.ts
// Client access to `GET /api/x402/digests?address=…`.
//
// The shelf needs the reports this wallet actually bought — which service, with which parameters,
// and what the envelope said — to offer a next step that is about this reader. The response is
// per-wallet and never cached; an unreadable store yields an empty list, not a placeholder report.

import type { ReportDigestStore } from './x402/reportDigest'
import { emptyReportDigestStore, parseReportDigestStore } from './x402/reportDigest'

export const REPORT_DIGESTS_ENDPOINT = '/api/x402/digests'

/** Fetch this wallet's latest report per service. Never throws: an error is an empty store. */
export async function fetchReportDigests(
  address: string,
  options: { signal?: AbortSignal } = {}
): Promise<ReportDigestStore> {
  const empty = emptyReportDigestStore(address)
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return empty

  try {
    const response = await fetch(
      `${REPORT_DIGESTS_ENDPOINT}?address=${encodeURIComponent(address)}`,
      { method: 'GET', headers: { Accept: 'application/json' }, signal: options.signal }
    )
    if (!response.ok) return empty

    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return empty
    if ((body as { success?: unknown }).success !== true) return empty

    return parseReportDigestStore(JSON.stringify(body), address)
  } catch {
    return empty
  }
}
