import type { QueryClient } from '@tanstack/react-query'
import { prefetchPoolsData, prefetchUserWalletPoolsData } from '../hooks/usePoolsData'
import { fetchGatewayBalancesData, gatewayBalancesQueryKey } from '../hooks/useGatewayBalance'
import {
  fetchWalletTestnetBalancesData,
  walletTestnetBalancesQueryKey,
} from '../hooks/useWalletTestnetBalances'
import { prefetchHistory } from '../utils/history'
import { getLivePortfolioSnapshot } from './portfolioContextService'

/**
 * Background cache-warming coordinator for Arcis.
 * Ensures zero-latency navigation by prefetching wallet-independent data
 * on initial page visit, and wallet-dependent data immediately upon wallet connection.
 */

/**
 * Prefetches all global / wallet-independent on-chain state:
 * - Liquidity Pools state (TVL, APYs, reserve balances, live token prices)
 */
export async function prefetchGlobalData(queryClient: QueryClient): Promise<void> {
  try {
    await prefetchPoolsData(queryClient)
  } catch (err) {
    console.warn('[prefetchCoordinator] Error during global data prefetch:', err)
  }
}

/**
 * Prefetches all wallet-dependent data across multi-chain & DeFi systems:
 * - Circle Gateway unified balances (13 supported domains)
 * - Native & token testnet balances across 13 chains
 * - User Arc liquidity pool & vault positions
 * - Transaction history from explorer/indexer
 * - Live portfolio snapshot (Ask Arcis Copilot AI context)
 */
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
  if (!walletAddress || !walletAddress.trim()) return

  const normalizedAddress = walletAddress.trim().toLowerCase()

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
 * P06: deferred wallet data — full multi-chain record, pool positions,
 * history, and portfolio snapshot. Safe to run idle/deferred because every
 * panel self-fetches on mount; the worst case without this warm-up is the
 * same latency as no prefetch at all.
 */
export async function prefetchDeferredWalletData(
  queryClient: QueryClient,
  walletAddress: string
): Promise<void> {
  if (!walletAddress || !walletAddress.trim()) return

  const normalizedAddress = walletAddress.trim().toLowerCase()

  await Promise.allSettled([
    prefetchHistory(normalizedAddress).catch((err) => {
      console.warn('[prefetchCoordinator] History prefetch failed:', err)
    }),
    queryClient.prefetchQuery({
      queryKey: walletTestnetBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchWalletTestnetBalancesData(normalizedAddress),
      staleTime: 15_000,
    }),
    prefetchUserWalletPoolsData(queryClient, normalizedAddress),
    getLivePortfolioSnapshot(normalizedAddress).catch((err) => {
      console.warn('[prefetchCoordinator] Portfolio snapshot prefetch failed:', err)
    }),
  ])
}

export async function prefetchAllWalletData(
  queryClient: QueryClient,
  walletAddress: string
): Promise<void> {
  if (!walletAddress || !walletAddress.trim()) return

  const normalizedAddress = walletAddress.trim().toLowerCase()

  await Promise.allSettled([
    // 1. Transaction history
    prefetchHistory(normalizedAddress).catch((err) => {
      console.warn('[prefetchCoordinator] History prefetch failed:', err)
    }),

    // 2. Gateway unified cross-chain balances (same key/normalization as `useGatewayBalance`)
    queryClient.prefetchQuery({
      queryKey: gatewayBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchGatewayBalancesData(normalizedAddress),
      staleTime: 10_000,
    }),

    // 3. Multi-chain testnet balances (same key/normalization as `useWalletTestnetBalances`, so
    // the deposit panel can reuse this record instead of re-reading every chain)
    queryClient.prefetchQuery({
      queryKey: walletTestnetBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchWalletTestnetBalancesData(normalizedAddress),
      staleTime: 15_000,
    }),

    // 4. On-chain Arc pool positions & token balances
    prefetchUserWalletPoolsData(queryClient, normalizedAddress),

    // 5. Portfolio snapshot for Copilot & DeFi advisory
    getLivePortfolioSnapshot(normalizedAddress).catch((err) => {
      console.warn('[prefetchCoordinator] Portfolio snapshot prefetch failed:', err)
    }),
  ])
}
