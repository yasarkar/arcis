// src/hooks/usePlatformStats.ts
// Reads the protocol-wide paid-call counter that the AI Services hero card shows via TanStack Query.
//
// The shared server value is authoritative: `sessionStorage` (max 60s) only provides initialData
// when fresh, and an `unavailable` server response immediately replaces it so the card shows `—`.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PlatformStatsSnapshot } from '../types/x402'
import { X402_PLATFORM_STATS_QUERY_KEY } from '../config/queryKeys'
import {
  fetchPlatformStats,
  platformStatsPollIntervalMs,
  readCachedPlatformStatsEntry,
  subscribeToPlatformCalls,
} from '../services/platformStatsClient'

export function usePlatformStats() {
  const queryClient = useQueryClient()
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialEntry = useMemo(() => readCachedPlatformStatsEntry(), [])

  const { data, isLoading, refetch } = useQuery<PlatformStatsSnapshot | null>({
    queryKey: X402_PLATFORM_STATS_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const next = await fetchPlatformStats(signal)
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      return next
    },
    ...(initialEntry
      ? {
          initialData: initialEntry.snapshot,
          initialDataUpdatedAt: initialEntry.cachedAt,
        }
      : {}),
    staleTime: 15_000,
    refetchInterval: platformStatsPollIntervalMs(),
    refetchIntervalInBackground: false,
    gcTime: 1000 * 60 * 5,
    retry: 1,
  })

  useEffect(() => {
    const unsubscribe = subscribeToPlatformCalls(() => {
      queryClient.setQueryData<PlatformStatsSnapshot | null>(
        X402_PLATFORM_STATS_QUERY_KEY,
        (current) =>
          current && current.source !== 'unavailable'
            ? { ...current, acceptedCalls: current.acceptedCalls + 1 }
            : current ?? null
      )
      // The server writes its own increment inside the same request; a short delayed read replaces
      // the optimistic value with the ledger value instead of stacking on top of it.
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        void queryClient.invalidateQueries({ queryKey: X402_PLATFORM_STATS_QUERY_KEY })
      }, 1500)
    })

    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      unsubscribe()
    }
  }, [queryClient])

  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    snapshot: data ?? null,
    isLoading,
    refresh,
  }
}
