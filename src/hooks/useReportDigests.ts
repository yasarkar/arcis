// src/hooks/useReportDigests.ts
// Loads this wallet's report digests from the server via TanStack Query and runs them through
// the shared recommendation engine.
//
// The shelf never keeps its own tally: the paid calls are remembered by the tollgate, and this
// hook only reads them back. `refreshKey` is the settlement reference of the last paid call, so a
// successful run invalidates the query instead of asking the browser to trust its own receipt.

import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Recommendation } from '../services/x402/nextActions'
import {
  recommendationsFromDigests,
  type ReportDigest,
  type ReportDigestStore,
} from '../services/x402/reportDigest'
import { fetchReportDigests } from '../services/reportDigestClient'
import { normalizeWalletAddress } from '../utils/address'
import { reportDigestsQueryKey } from '../config/queryKeys'

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
  const queryClient = useQueryClient()
  const normalizedAddress = normalizeWalletAddress(address)
  const isValidAddress = /^0x[0-9a-f]{40}$/.test(normalizedAddress)
  const queryKey = useMemo(() => reportDigestsQueryKey(normalizedAddress), [normalizedAddress])

  const { data, isLoading } = useQuery<ReportDigestStore>({
    queryKey,
    queryFn: ({ signal }) => fetchReportDigests(normalizedAddress, { signal }),
    enabled: isValidAddress,
    staleTime: 20_000,
    gcTime: 1000 * 60 * 5,
    retry: 1,
  })

  // When a newly settled paid call updates `refreshKey`, re-read the wallet's digests from the server.
  const prevRefreshKeyRef = useRef<string | number | null | undefined>(refreshKey)
  useEffect(() => {
    const prev = prevRefreshKeyRef.current
    prevRefreshKeyRef.current = refreshKey
    if (!isValidAddress || refreshKey == null || refreshKey === prev) return
    void queryClient.invalidateQueries({ queryKey })
  }, [isValidAddress, refreshKey, queryClient, queryKey])

  const store = isValidAddress ? (data ?? null) : null
  const digests = store?.digests ?? []

  const byService = useMemo(
    () => new Map(digests.map((digest) => [digest.serviceId, digest])),
    [store]
  )

  // Two cards on the shelf: the most consequential step, and the one after it. Everything the
  // engine decides (ordering, guards, expiry) is shared with the playground surface.
  const recommendations = useMemo(
    () => recommendationsFromDigests(digests, { limit: 2 }),
    [store]
  )

  return { store, digests, byService, recommendations, isLoading: isValidAddress && isLoading }
}
