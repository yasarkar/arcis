import type { QueryClient } from '@tanstack/react-query'
import { prefetchPoolsData, prefetchUserWalletPoolsData } from '../hooks/usePoolsData'
import { fetchGatewayBalancesData } from '../hooks/useGatewayBalance'
import { fetchWalletTestnetBalancesData } from '../hooks/useWalletTestnetBalances'
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
 * - Circle Gateway unified balances (13+ supported domains)
 * - Native & token testnet balances across 13+ chains
 * - User Arc liquidity pool & vault positions
 * - Transaction history from explorer/indexer
 * - Live portfolio snapshot (Ask Arcis Copilot AI context)
 */
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

    // 2. Gateway unified cross-chain balances
    queryClient.prefetchQuery({
      queryKey: ['gatewayBalances', normalizedAddress],
      queryFn: () => fetchGatewayBalancesData(normalizedAddress),
      staleTime: 10_000,
    }),

    // 3. Multi-chain testnet balances
    queryClient.prefetchQuery({
      queryKey: ['walletTestnetBalances', normalizedAddress],
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
