// src/config/queryKeys.ts
// Canonical TanStack Query keys shared across hooks, prefetches, and invalidations.
//
// Every wallet-scoped key normalizes its address (trim + lowercase) so a connect-time
// prefetch and a component rendering a checksummed address always hit the same cache entry.

import { normalizeWalletAddress } from '../utils/address'

export const ONCHAIN_POOL_STATE_QUERY_KEY = ['onchainPoolState'] as const
export const TOTAL_POOL_TX_COUNT_QUERY_KEY = ['totalPoolTxCount'] as const
export const LIVE_TOKEN_PRICES_QUERY_KEY = ['liveTokenPrices'] as const

export const X402_PLATFORM_STATS_QUERY_KEY = ['x402', 'platformStats'] as const
export const X402_SHARED_LATENCY_QUERY_KEY = ['x402', 'sharedLatency'] as const
export const X402_RUNTIME_CONFIG_QUERY_KEY = ['x402', 'runtimeConfig'] as const

export function onchainPoolBalancesQueryKey(
  walletAddress: string | null | undefined
): readonly ['onchainPoolBalances', string] {
  return ['onchainPoolBalances', normalizeWalletAddress(walletAddress)] as const
}

export function userPoolPositionsQueryKey(
  walletAddress: string | null | undefined
): readonly ['userPoolPositions', string] {
  return ['userPoolPositions', normalizeWalletAddress(walletAddress)] as const
}

export function reportDigestsQueryKey(
  walletAddress: string | null | undefined
): readonly ['x402', 'reportDigests', string] {
  return ['x402', 'reportDigests', normalizeWalletAddress(walletAddress)] as const
}

export function providerLedgerQueryKey(
  walletAddress: string | null | undefined
): readonly ['x402', 'providerLedger', string] {
  return ['x402', 'providerLedger', normalizeWalletAddress(walletAddress)] as const
}

export function walletHistoryQueryKey(
  walletAddress: string | null | undefined
): readonly ['walletHistory', string] {
  return ['walletHistory', normalizeWalletAddress(walletAddress)] as const
}

export function portfolioSnapshotQueryKey(
  walletAddress: string | null | undefined
): readonly ['portfolioSnapshot', string] {
  return ['portfolioSnapshot', normalizeWalletAddress(walletAddress)] as const
}

export const queryKeys = {
  pools: {
    state: () => ONCHAIN_POOL_STATE_QUERY_KEY,
    txCount: () => TOTAL_POOL_TX_COUNT_QUERY_KEY,
    balancesRoot: () => ['onchainPoolBalances'] as const,
    balances: onchainPoolBalancesQueryKey,
    positionsRoot: () => ['userPoolPositions'] as const,
    positions: userPoolPositionsQueryKey,
  },
  prices: {
    live: () => LIVE_TOKEN_PRICES_QUERY_KEY,
  },
  x402: {
    platformStats: () => X402_PLATFORM_STATS_QUERY_KEY,
    sharedLatency: () => X402_SHARED_LATENCY_QUERY_KEY,
    runtimeConfig: () => X402_RUNTIME_CONFIG_QUERY_KEY,
    reportDigestsRoot: () => ['x402', 'reportDigests'] as const,
    reportDigests: reportDigestsQueryKey,
    providerLedgerRoot: () => ['x402', 'providerLedger'] as const,
    providerLedger: providerLedgerQueryKey,
  },
  wallet: {
    historyRoot: () => ['walletHistory'] as const,
    history: walletHistoryQueryKey,
    portfolioSnapshotRoot: () => ['portfolioSnapshot'] as const,
    portfolioSnapshot: portfolioSnapshotQueryKey,
  },
} as const
