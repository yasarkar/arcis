// src/hooks/__tests__/queryKeyAlignment.test.ts
// Prefetch and consumers must resolve to the same cache entry: keys are built from a
// normalized (trimmed + lowercased) address, and token subsets are order-independent.

import { describe, expect, it, vi } from 'vitest'

const {
  prefetchPoolsDataMock,
  prefetchUserWalletPoolsDataMock,
} = vi.hoisted(() => ({
  prefetchPoolsDataMock: vi.fn(async () => {}),
  prefetchUserWalletPoolsDataMock: vi.fn(async () => {}),
}))

// Keep the prefetch coordinator offline: only the query keys and wiring are under test here.
vi.mock('../../hooks/usePoolsData', () => ({
  prefetchPoolsData: prefetchPoolsDataMock,
  prefetchUserWalletPoolsData: prefetchUserWalletPoolsDataMock,
}))
vi.mock('../../utils/history', () => ({
  fetchHistoryResult: vi.fn(async () => ({ items: [], ok: true })),
}))
vi.mock('../../services/portfolioContextService', () => ({
  getLivePortfolioSnapshot: vi.fn(async () => ({})),
}))
vi.mock('../../services/platformStatsClient', () => ({
  fetchPlatformStats: vi.fn(async () => null),
}))
vi.mock('../../services/latencyClient', () => ({
  fetchLatency: vi.fn(async () => null),
}))
vi.mock('../../hooks/useX402Config', () => ({
  fetchX402RuntimeConfig: vi.fn(async () => ({})),
}))

import { gatewayBalancesQueryKey } from '../useGatewayBalance'
import { walletTestnetBalancesQueryKey } from '../useWalletTestnetBalances'
import {
  X402_PLATFORM_STATS_QUERY_KEY,
  X402_RUNTIME_CONFIG_QUERY_KEY,
  X402_SHARED_LATENCY_QUERY_KEY,
  onchainPoolBalancesQueryKey,
  portfolioSnapshotQueryKey,
  providerLedgerQueryKey,
  userPoolPositionsQueryKey,
  walletHistoryQueryKey,
} from '../../config/queryKeys'
import {
  prefetchAllWalletData,
  prefetchDeferredWalletData,
  prefetchGlobalData,
} from '../../services/prefetchCoordinator'

const MIXED_CASE = '0xAbC0000000000000000000000000000000000001'
const LOWER = '0xabc0000000000000000000000000000000000001'

describe('query key alignment', () => {
  it('normalizes address casing and whitespace across every wallet-scoped key', () => {
    expect(gatewayBalancesQueryKey(MIXED_CASE)).toEqual(['gatewayBalances', LOWER])
    expect(gatewayBalancesQueryKey(`  ${MIXED_CASE}  `)).toEqual(gatewayBalancesQueryKey(LOWER))

    expect(onchainPoolBalancesQueryKey(`  ${MIXED_CASE}  `)).toEqual(['onchainPoolBalances', LOWER])
    expect(userPoolPositionsQueryKey(`  ${MIXED_CASE}  `)).toEqual(['userPoolPositions', LOWER])
    expect(providerLedgerQueryKey(`  ${MIXED_CASE}  `)).toEqual(['x402', 'providerLedger', LOWER])
    expect(walletHistoryQueryKey(`  ${MIXED_CASE}  `)).toEqual(['walletHistory', LOWER])
    expect(portfolioSnapshotQueryKey(`  ${MIXED_CASE}  `)).toEqual(['portfolioSnapshot', LOWER])
  })

  it('normalizes casing and token order for the wallet balance key', () => {
    expect(walletTestnetBalancesQueryKey(MIXED_CASE, ['USDC'])).toEqual([
      'walletTestnetBalances',
      LOWER,
      'USDC',
    ])
    expect(walletTestnetBalancesQueryKey(MIXED_CASE, ['EURC', 'USDC'])).toEqual(
      walletTestnetBalancesQueryKey(LOWER, ['USDC', 'EURC'])
    )
    // No / empty token subset keeps the original two-segment key.
    expect(walletTestnetBalancesQueryKey(MIXED_CASE, [])).toEqual(
      walletTestnetBalancesQueryKey(MIXED_CASE)
    )
  })

  it('prefetchGlobalData warms pools and AI Services hero queries on launch', async () => {
    prefetchPoolsDataMock.mockClear()
    const prefetchQuery = vi.fn(async (_options: { queryKey: unknown }) => {})
    await prefetchGlobalData({ prefetchQuery } as never)

    expect(prefetchPoolsDataMock).toHaveBeenCalledTimes(1)
    const keys = prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    expect(keys).toContainEqual(X402_PLATFORM_STATS_QUERY_KEY)
    expect(keys).toContainEqual(X402_SHARED_LATENCY_QUERY_KEY)
    expect(keys).toContainEqual(X402_RUNTIME_CONFIG_QUERY_KEY)
  })

  it('prefetchDeferredWalletData uses exact canonical keys consumed by hooks', async () => {
    prefetchUserWalletPoolsDataMock.mockClear()
    const prefetchQuery = vi.fn(async (_options: { queryKey: unknown }) => {})
    await prefetchDeferredWalletData({ prefetchQuery } as never, `  ${MIXED_CASE}  `)

    expect(prefetchUserWalletPoolsDataMock).toHaveBeenCalledWith(expect.anything(), LOWER)
    const keys = prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    expect(keys).toContainEqual(walletHistoryQueryKey(LOWER))
    expect(keys).toContainEqual(walletTestnetBalancesQueryKey(LOWER))
    expect(keys).toContainEqual(portfolioSnapshotQueryKey(LOWER))
  })

  it('prefetchAllWalletData prefetches with the exact keys the hooks consume', async () => {
    prefetchUserWalletPoolsDataMock.mockClear()
    const prefetchQuery = vi.fn(async (_options: { queryKey: unknown }) => {})
    await prefetchAllWalletData({ prefetchQuery } as never, `  ${MIXED_CASE}  `)

    expect(prefetchUserWalletPoolsDataMock).toHaveBeenCalledWith(expect.anything(), LOWER)
    const keys = prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    expect(keys).toContainEqual(walletHistoryQueryKey(LOWER))
    expect(keys).toContainEqual(gatewayBalancesQueryKey(LOWER))
    expect(keys).toContainEqual(walletTestnetBalancesQueryKey(LOWER))
    expect(keys).toContainEqual(portfolioSnapshotQueryKey(LOWER))
  })
})
