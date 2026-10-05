// src/hooks/__tests__/queryKeyAlignment.test.ts
// Prefetch and consumers must resolve to the same cache entry: keys are built from a
// normalized (trimmed + lowercased) address, and token subsets are order-independent.

import { describe, expect, it, vi } from 'vitest'

// Keep the prefetch coordinator offline: only the query keys are under test here.
vi.mock('../../hooks/usePoolsData', () => ({
  prefetchPoolsData: vi.fn(async () => {}),
  prefetchUserWalletPoolsData: vi.fn(async () => {}),
}))
vi.mock('../../utils/history', () => ({
  prefetchHistory: vi.fn(async () => {}),
}))
vi.mock('../../services/portfolioContextService', () => ({
  getLivePortfolioSnapshot: vi.fn(async () => ({})),
}))

import { gatewayBalancesQueryKey } from '../useGatewayBalance'
import { walletTestnetBalancesQueryKey } from '../useWalletTestnetBalances'
import { prefetchAllWalletData } from '../../services/prefetchCoordinator'

const MIXED_CASE = '0xAbC0000000000000000000000000000000000001'
const LOWER = '0xabc0000000000000000000000000000000000001'

describe('query key alignment', () => {
  it('normalizes address casing and whitespace for the Gateway balance key', () => {
    expect(gatewayBalancesQueryKey(MIXED_CASE)).toEqual(['gatewayBalances', LOWER])
    expect(gatewayBalancesQueryKey(`  ${MIXED_CASE}  `)).toEqual(gatewayBalancesQueryKey(LOWER))
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

  it('prefetches with the exact keys the hooks consume', async () => {
    const prefetchQuery = vi.fn(async (_options: { queryKey: unknown }) => {})
    await prefetchAllWalletData({ prefetchQuery } as never, `  ${MIXED_CASE}  `)

    const keys = prefetchQuery.mock.calls.map(([options]) => options.queryKey)
    expect(keys).toContainEqual(gatewayBalancesQueryKey(LOWER))
    expect(keys).toContainEqual(walletTestnetBalancesQueryKey(LOWER))
  })
})
