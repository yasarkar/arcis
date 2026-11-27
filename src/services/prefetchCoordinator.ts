import type { QueryClient } from '@tanstack/react-query'
import { prefetchPoolsData, prefetchUserWalletPoolsData } from '../hooks/usePoolsData'
import { fetchGatewayBalancesData, gatewayBalancesQueryKey } from '../hooks/useGatewayBalance'
import {
  fetchWalletTestnetBalancesData,
  walletTestnetBalancesQueryKey,
} from '../hooks/useWalletTestnetBalances'
import { fetchX402RuntimeConfig } from '../hooks/useX402Config'
import { fetchPlatformStats } from './platformStatsClient'
import { fetchLatency } from './latencyClient'
import { fetchHistoryResult } from '../utils/history'
import { getLivePortfolioSnapshot } from './portfolioContextService'
import { normalizeWalletAddress } from '../utils/address'
import {
  X402_PLATFORM_STATS_QUERY_KEY,
  X402_RUNTIME_CONFIG_QUERY_KEY,
  X402_SHARED_LATENCY_QUERY_KEY,
  portfolioSnapshotQueryKey,
  walletHistoryQueryKey,
} from '../config/queryKeys'

/**
 * Background cache-warming coordinator for Arcis.
 * Ensures low-latency navigation by prefetching global protocol data on initial page visit
 * and wallet-dependent data through canonical TanStack Query keys upon wallet connection.
 */

/**
 * Prefetches all global / wallet-independent state on app launch:
 * - Liquidity Pools state (TVL, APYs, reserve balances, live token prices)
 * - AI Services hero card metrics (shared paid-call ledger + shared Arc RPC latency)
 * - Public x402 runtime readiness config
 */
export async function prefetchGlobalData(queryClient: QueryClient): Promise<void> {
  if (!queryClient) return
  try {
    await Promise.allSettled([
      prefetchPoolsData(queryClient),
      queryClient.prefetchQuery({
        queryKey: X402_PLATFORM_STATS_QUERY_KEY,
        queryFn: () => fetchPlatformStats(),
        staleTime: 15_000,
      }),
      queryClient.prefetchQuery({
        queryKey: X402_SHARED_LATENCY_QUERY_KEY,
        queryFn: () => fetchLatency(),
        staleTime: 25_000,
      }),
      queryClient.prefetchQuery({
        queryKey: X402_RUNTIME_CONFIG_QUERY_KEY,
        queryFn: () => fetchX402RuntimeConfig(),
        staleTime: 60_000,
      }),
    ])
  } catch (err) {
    console.warn('[prefetchCoordinator] Error during global data prefetch:', err)
  }
}

/** Token subset for the connect-time essential prefetch (USDC drives deposit validation). */
export const ESSENTIAL_BALANCE_TOKENS = ['USDC'] as const

/**
 * P06: essential wallet data for time-to-interactive balances. Warms only what
 * the first paint needs — Gateway unified balances plus the USDC-subset
 * multi-chain record (the exact key `UnifiedBalance` consumes). Everything
 * else moves to `prefetchDeferredWalletData` so connecting never blocks on
 * pool positions, history, or the portfolio snapshot.
 */
export async function prefetchEssentialWalletData(
  queryClient: QueryClient,
  walletAddress: string
): Promise<void> {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  if (!normalizedAddress) return

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: gatewayBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchGatewayBalancesData(normalizedAddress),
      staleTime: 10_000,
    }),
    queryClient.prefetchQuery({
      queryKey: walletTestnetBalancesQueryKey(normalizedAddress, [...ESSENTIAL_BALANCE_TOKENS]),
      queryFn: () => fetchWalletTestnetBalancesData(normalizedAddress, [...ESSENTIAL_BALANCE_TOKENS]),
      staleTime: 15_000,
    }),
  ])
}

/**
 * P06: deferred wallet data — full multi-chain record, pool positions (single Multicall3),
 * transaction history, x402 report digests, and portfolio snapshot.
 * Every query shares the exact canonical key consumed by its panel hook.
 */
export async function prefetchDeferredWalletData(
  queryClient: QueryClient,
  walletAddress: string
): Promise<void> {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  if (!normalizedAddress) return

  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: walletHistoryQueryKey(normalizedAddress),
      queryFn: () => fetchHistoryResult(normalizedAddress),
      staleTime: 15_000,
    }),
    queryClient.prefetchQuery({
      queryKey: walletTestnetBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchWalletTestnetBalancesData(normalizedAddress),
      staleTime: 15_000,
    }),
    prefetchUserWalletPoolsData(queryClient, normalizedAddress),
    queryClient.prefetchQuery({
      queryKey: portfolioSnapshotQueryKey(normalizedAddress),
      queryFn: () => getLivePortfolioSnapshot(normalizedAddress),
      staleTime: 15_000,
    }),
  ])
}

export async function prefetchAllWalletData(
  queryClient: QueryClient,
  walletAddress: string
): Promise<void> {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  if (!normalizedAddress) return

  await Promise.allSettled([
    // 1. Transaction history
    queryClient.prefetchQuery({
      queryKey: walletHistoryQueryKey(normalizedAddress),
      queryFn: () => fetchHistoryResult(normalizedAddress),
      staleTime: 15_000,
    }),

    // 2. Gateway unified cross-chain balances
    queryClient.prefetchQuery({
      queryKey: gatewayBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchGatewayBalancesData(normalizedAddress),
      staleTime: 10_000,
    }),

    // 3. Multi-chain testnet balances
    queryClient.prefetchQuery({
      queryKey: walletTestnetBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchWalletTestnetBalancesData(normalizedAddress),
      staleTime: 15_000,
    }),

    // 4. On-chain Arc pool positions & token balances (single Multicall3)
    prefetchUserWalletPoolsData(queryClient, normalizedAddress),

    // 5. Portfolio snapshot for Copilot & DeFi advisory
    queryClient.prefetchQuery({
      queryKey: portfolioSnapshotQueryKey(normalizedAddress),
      queryFn: () => getLivePortfolioSnapshot(normalizedAddress),
      staleTime: 15_000,
    }),
  ])
}
