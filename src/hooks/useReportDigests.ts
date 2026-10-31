// src/hooks/useReportDigests.ts
// Loads this wallet's report digests from the server and runs them through the shared engine.
//
// The shelf never keeps its own tally: the paid calls are remembered by the tollgate, and this
// hook only reads them back. `refreshKey` is the settlement reference of the last paid call, so a
// successful run re-reads the store instead of asking the browser to trust its own receipt.

import { useEffect, useMemo, useState } from 'react'
import type { Recommendation } from '../services/x402/nextActions'
import {
  recommendationsFromDigests,
  type ReportDigest,
  type ReportDigestStore,
} from '../services/x402/reportDigest'
import { fetchReportDigests } from '../services/reportDigestClient'

export interface ReportDigestState {
  store: ReportDigestStore | null
  digests: ReportDigest[]
  /** Latest digest per service id, for the "last measured" line on a service card. */
  byService: Map<string, ReportDigest>
  recommendations: Recommendation[]
  isLoading: boolean
}

export function useReportDigests(
  address?: string,
  refreshKey?: string | number | null
): ReportDigestState {
  const [store, setStore] = useState<ReportDigestStore | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!address) {
      setStore(null)
      return
    }

    const controller = new AbortController()
    let active = true
    setIsLoading(true)

    fetchReportDigests(address, { signal: controller.signal })
      .then((next) => {
        if (active) setStore(next)
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [address, refreshKey])

  const digests = store?.digests ?? []

  const byService = useMemo(
    () => new Map(digests.map((digest) => [digest.serviceId, digest])),
    // The digest array identity changes only when the store is replaced.
    [store]
  )

  // Two cards on the shelf: the most consequential step, and the one after it. Everything the
  // engine decides (ordering, guards, expiry) is shared with the playground surface.
  const recommendations = useMemo(
    () => recommendationsFromDigests(digests, { limit: 2 }),
    [store]
  )

  return { store, digests, byService, recommendations, isLoading }
}
