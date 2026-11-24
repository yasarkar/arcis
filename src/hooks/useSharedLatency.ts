// src/hooks/useSharedLatency.ts
// Reads the one shared latency figure the AI Services hero card shows via TanStack Query.
//
// The server's shared reading is authoritative: `sessionStorage` (max 60s) only provides
// initialData when fresh, and an `unavailable` server response immediately replaces it so the
// card renders a dash (`—`).

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LatencySnapshot } from '../types/x402'
import { X402_SHARED_LATENCY_QUERY_KEY } from '../config/queryKeys'
import {
  fetchLatency,
  latencyPollIntervalMs,
  readCachedLatencyEntry,
} from '../services/latencyClient'

export function useSharedLatency() {
  const initialEntry = useMemo(() => readCachedLatencyEntry(), [])

  const { data, isLoading } = useQuery<LatencySnapshot | null>({
    queryKey: X402_SHARED_LATENCY_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const next = await fetchLatency(signal)
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
    staleTime: 25_000,
    refetchInterval: latencyPollIntervalMs(),
    refetchIntervalInBackground: false,
    gcTime: 1000 * 60 * 5,
    retry: 1,
  })

  return {
    snapshot: data ?? null,
    isLoading,
  }
}
