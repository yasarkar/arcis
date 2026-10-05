// src/hooks/useGatewayBalance.ts
//
// React hook for querying the Circle Gateway unified balance.

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getGatewayBalances,
  type GatewayBalanceItem,
  type GatewayBalanceResponse,
} from '../services/gatewayService'
import { GATEWAY_DOMAINS, GATEWAY_CHAIN_NAMES, DOMAIN_TO_CHAIN } from '../config/gatewayConfig'
import { getActiveOptimisticDeltas } from '../services/optimisticGatewayTracker'
import { normalizeWalletAddress } from '../utils/address'

const EMPTY_PENDING_BY_CHAIN: Record<string, number> = {}
/** Live poll cadence for the unified balance. */
export const GATEWAY_POLL_INTERVAL_MS = 10_000

/**
 * Cache key for the Gateway balance query.
 * Addresses are normalized (trimmed + lowercased) so the connect-time prefetch and every
 * consumer resolve to the same cache entry instead of fetching the same balances twice.
 */
export function gatewayBalancesQueryKey(walletAddress: string): readonly ['gatewayBalances', string] {
  return ['gatewayBalances', normalizeWalletAddress(walletAddress)] as const
}

export interface GatewayBalance {
  domain: number
  chainKey: string
  name: string
  chainName?: string
  balance: string
  status: 'success' | 'error' | 'loading'
  error?: string
}

export interface GatewayBalancesData {
  balances: GatewayBalance[]
  totalBalance: string
  /** Net amount pending Circle's indexer (positive for deposits on their way in). */
  pendingDelta: number
  /** Pending amounts keyed by originating chain so rows can label them honestly. */
  pendingByChain: Record<string, number>
}

export async function fetchGatewayBalancesData(
  walletAddress: string
): Promise<GatewayBalancesData> {
  if (!walletAddress) {
    return {
      balances: [] as GatewayBalance[],
      totalBalance: '0.00',
      pendingDelta: 0,
      pendingByChain: EMPTY_PENDING_BY_CHAIN,
    }
  }
  console.log(`[useGatewayBalance] Live fetching balance for wallet: ${walletAddress}`)
  const rawData: GatewayBalanceResponse = await getGatewayBalances(walletAddress)

  const mapped: GatewayBalance[] = (rawData.balances || []).map((item: GatewayBalanceItem) => {
    const chainKey = DOMAIN_TO_CHAIN[item.domain] || `domain_${item.domain}`
    const displayName = GATEWAY_CHAIN_NAMES[chainKey] || `Domain ${item.domain}`
    return {
      domain: item.domain,
      chainKey,
      name: displayName,
      chainName: displayName,
      balance: parseFloat(item.balance || '0').toFixed(2),
      status: 'success' as const,
    }
  })

  const sum = (rawData.balances || []).reduce(
    (acc, item) => acc + (parseFloat(item.balance) || 0),
    0
  )

  // Pending deposits/withdrawals that Circle's off-chain indexer has not surfaced yet.
  const activeDeltas = getActiveOptimisticDeltas(walletAddress, sum, 'gateway-settlement-pool')
  const pendingDelta = activeDeltas.reduce((acc, item) => acc + item.delta, 0)
  const effectiveTotal = Math.max(0, parseFloat((sum + pendingDelta).toFixed(4)))

  // Attribute each pending delta to the chain it happened on so the breakdown stays honest.
  const pendingByChain: Record<string, number> = {}
  for (const item of activeDeltas) {
    if (!item.chainKey || item.delta === 0) continue
    pendingByChain[item.chainKey] = (pendingByChain[item.chainKey] ?? 0) + item.delta
  }
  for (const row of mapped) {
    const pending = pendingByChain[row.chainKey]
    if (!pending) continue
    row.balance = Math.max(0, parseFloat(row.balance) + pending).toFixed(2)
  }

  return {
    balances: mapped,
    totalBalance: effectiveTotal.toFixed(2),
    pendingDelta,
    pendingByChain,
  }
}

export function useGatewayBalance(walletAddress: string) {
  const queryClient = useQueryClient()
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const queryKey = useMemo(() => gatewayBalancesQueryKey(normalizedAddress), [normalizedAddress])

  const {
    data,
    isLoading,
    isFetching,
    error: queryError,
    refetch,
    dataUpdatedAt,
  } = useQuery({
    queryKey,
    queryFn: () => fetchGatewayBalancesData(normalizedAddress),
    enabled: Boolean(normalizedAddress),
    staleTime: 5_000, // 5 seconds fresh cache for live updates
    refetchInterval: GATEWAY_POLL_INTERVAL_MS, // Live poll every 10 seconds
    // Hidden tabs must not poll: React Query skips interval ticks while the document is
    // hidden and resumes automatically once it is visible again (focusManager reads
    // document.visibilityState). Keep this explicit — switching to a
    // `document.hidden ? false : interval` callback would clear the timer for good, because
    // the app disables refetchOnWindowFocus globally.
    refetchIntervalInBackground: false,
    gcTime: 1000 * 60 * 5, // 5 minutes garbage collection
  })

  return {
    balances: data?.balances || [],
    totalBalance: data?.totalBalance || '0.00',
    loading: isLoading,
    isFetching,
    /** True once a successful Gateway response has been received (stale data is kept on refresh errors). */
    hasData: data !== undefined,
    error: queryError ? (queryError as Error).message : null,
    /** Epoch ms of the last successful Gateway fetch; lets callers couple their own refreshes to the poll. */
    dataUpdatedAt,
    /** Net optimistic amount still waiting for Circle's indexer (positive for pending deposits). */
    pendingDelta: data?.pendingDelta ?? 0,
    /** Per-chain pending amounts so rows can be labeled honestly instead of crediting another chain. */
    pendingByChain: data?.pendingByChain ?? EMPTY_PENDING_BY_CHAIN,
    refresh: () => {
      queryClient.invalidateQueries({ queryKey })
      return refetch()
    },
  }
}