// src/hooks/useProviderLedger.ts
// TanStack Query hook for the canonical x402 provider settlement ledger
// (`GET /api/x402/provider/:address`).
//
// Deliberately does NOT use `placeholderData` across addresses so switching wallets never leaks
// the previous wallet's settlement figures while the new ledger is in flight.

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchCanonicalProviderLedger } from '../services/x402PaymentEngine'
import type { ProviderLedger } from '../types/x402'
import { normalizeWalletAddress } from '../utils/address'
import { providerLedgerQueryKey } from '../config/queryKeys'

export interface UseProviderLedgerOptions {
  enabled?: boolean
}

export function useProviderLedger(
  providerAddress?: string | null,
  options: UseProviderLedgerOptions = {}
) {
  const { enabled = true } = options
  const queryClient = useQueryClient()
  const normalizedAddress = normalizeWalletAddress(providerAddress)
  const isValidAddress = Boolean(normalizedAddress && normalizedAddress.startsWith('0x'))
  const queryKey = useMemo(() => providerLedgerQueryKey(normalizedAddress), [normalizedAddress])

  const { data, isLoading, isFetching, refetch } = useQuery<ProviderLedger | null>({
    queryKey,
    queryFn: () => fetchCanonicalProviderLedger(normalizedAddress),
    enabled: enabled && isValidAddress,
    staleTime: 15_000,
    gcTime: 1000 * 60 * 5,
    retry: 1,
  })

  const refresh = useCallback(async () => {
    if (!isValidAddress) return null
    await queryClient.invalidateQueries({ queryKey })
    const res = await refetch()
    return res.data ?? null
  }, [isValidAddress, queryClient, queryKey, refetch])

  return {
    ledger: isValidAddress ? (data ?? null) : null,
    isLoading: isValidAddress && (isLoading || (isFetching && data === undefined)),
    isFetching: isValidAddress && isFetching,
    refresh,
  }
}
