// src/hooks/useWalletHistory.ts
// TanStack Query hook for per-wallet transaction history (`/api/history`).
//
// Preserves the honesty invariant: a failed server read (`ok: false`) surfaces as `fetchError`
// rather than masquerading as an empty transaction list, while still keeping any already-loaded
// in-memory rows visible. Local `addTransaction` updates sync immediately via the history event.

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ARCIS_HISTORY_UPDATED_EVENT,
  LEGACY_ARC_HISTORY_UPDATED_EVENT,
  fetchHistoryResult,
  getHistory,
  isHistoryLoaded,
  type HistoryFetchResult,
  type HistoryItem,
} from '../utils/history'
import { normalizeWalletAddress } from '../utils/address'
import { walletHistoryQueryKey } from '../config/queryKeys'

export function useWalletHistory(walletAddress?: string | null) {
  const queryClient = useQueryClient()
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const isEnabled = Boolean(normalizedAddress)
  const queryKey = useMemo(() => walletHistoryQueryKey(normalizedAddress), [normalizedAddress])

  const hasInitialMemory = isEnabled && isHistoryLoaded(normalizedAddress)

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<HistoryFetchResult>({
    queryKey,
    queryFn: () => fetchHistoryResult(normalizedAddress),
    enabled: isEnabled,
    staleTime: 15_000,
    gcTime: 1000 * 60 * 5,
    retry: 1,
    ...(hasInitialMemory
      ? {
          initialData: () => ({
            items: getHistory(normalizedAddress),
            ok: true,
          }),
        }
      : {}),
  })

  // Keep TanStack Query cache synchronized immediately when local actions call `addTransaction`.
  useEffect(() => {
    if (!isEnabled || typeof window === 'undefined') return

    const handleUpdate = (event?: Event) => {
      const targetUser = (event as CustomEvent<{ userAddress?: string }>)?.detail?.userAddress
      if (targetUser && normalizeWalletAddress(targetUser) !== normalizedAddress) {
        return
      }
      const nextItems = getHistory(normalizedAddress)
      queryClient.setQueryData<HistoryFetchResult>(queryKey, (prev) => ({
        items: nextItems,
        ok: prev ? prev.ok : true,
        error: prev?.error,
      }))
    }

    window.addEventListener(ARCIS_HISTORY_UPDATED_EVENT, handleUpdate)
    window.addEventListener(LEGACY_ARC_HISTORY_UPDATED_EVENT, handleUpdate)
    return () => {
      window.removeEventListener(ARCIS_HISTORY_UPDATED_EVENT, handleUpdate)
      window.removeEventListener(LEGACY_ARC_HISTORY_UPDATED_EVENT, handleUpdate)
    }
  }, [isEnabled, normalizedAddress, queryClient, queryKey])

  // Coming back to the tab silently revalidates so an old list is not mistaken for current.
  useEffect(() => {
    if (!isEnabled || typeof window === 'undefined') return
    const revalidate = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void refetch()
    }
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', revalidate)
    return () => {
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', revalidate)
    }
  }, [isEnabled, refetch])

  const refresh = useCallback(() => {
    if (!isEnabled) return Promise.resolve()
    return refetch().then(() => undefined)
  }, [isEnabled, refetch])

  const history: HistoryItem[] = isEnabled ? (data?.items ?? getHistory(normalizedAddress)) : []
  const fetchError: string | null =
    isEnabled && data && !data.ok ? (data.error || 'History could not be loaded.') : null
  const lastSyncedAt: number | null =
    isEnabled && data?.ok && dataUpdatedAt > 0 ? dataUpdatedAt : null

  return {
    history,
    isLoading: isEnabled && isLoading && !isHistoryLoaded(normalizedAddress),
    isRefreshing: isEnabled && isFetching && !isLoading,
    fetchError,
    lastSyncedAt,
    refresh,
  }
}
