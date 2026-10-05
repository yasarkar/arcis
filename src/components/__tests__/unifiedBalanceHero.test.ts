// src/components/__tests__/unifiedBalanceHero.test.ts
// The Unified Balance hero must render the loading skeleton on first load, grouped
// amounts, and the pending (indexer lag) badge after a deposit.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  gateway: {
    balances: [] as Array<{ chainKey: string; name: string; balance: string; domain: number; status: 'success' }>,
    totalBalance: '0.00',
    loading: false,
    hasData: true,
    error: null as string | null,
    refresh: vi.fn(),
    dataUpdatedAt: 0,
    pendingDelta: 0,
    pendingByChain: {} as Record<string, number>,
  },
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined }),
}))
vi.mock('../../hooks/useGatewayBalance', () => ({
  useGatewayBalance: () => mocks.gateway,
}))
vi.mock('../../hooks/useWalletTestnetBalances', () => ({
  useWalletTestnetBalances: () => ({
    walletBalances: {},
    loading: false,
    isFetching: false,
    hasData: false,
    refetch: vi.fn(),
    invalidate: vi.fn(),
  }),
}))
vi.mock('../../utils/history', () => ({ addTransaction: vi.fn() }))
vi.mock('../../services/optimisticGatewayTracker', () => ({
  getOptimisticDelta: vi.fn(() => 0),
  recordOptimisticDelta: vi.fn(),
}))
vi.mock('../unified/DepositPanel', () => ({ default: () => null }))
vi.mock('../unified/AssetDistributionList', () => ({ default: () => null }))
vi.mock('../fintech/UnifiedSuccessReceipt', () => ({ UnifiedSuccessReceipt: () => null }))
vi.mock('../../assets/Token-Icon/USDC Token.svg', () => ({ default: 'usdc-token.svg' }))

import UnifiedBalance from '../UnifiedBalance'

const WALLET = '0x0000000000000000000000000000000000000001'

function renderHero() {
  return renderToStaticMarkup(React.createElement(UnifiedBalance, { connectedAddress: WALLET }))
}

describe('Unified Balance hero states', () => {
  it('shows a skeleton (instead of "...") while the first Gateway fetch is in flight', () => {
    mocks.gateway = { ...mocks.gateway, loading: true, hasData: false, dataUpdatedAt: 0 }

    const markup = renderHero()

    expect(markup).toContain('ub-skeleton')
    expect(markup).toContain('Loading unified balance')
    expect(markup).not.toContain('>...<')
  })

  it('renders a grouped total without a freshness label', () => {
    mocks.gateway = {
      ...mocks.gateway,
      loading: false,
      hasData: true,
      totalBalance: '1234.50',
      dataUpdatedAt: Date.now() - 12_500,
      pendingDelta: 0,
      pendingByChain: {},
    }

    const markup = renderHero()

    expect(markup).toContain('1,234.50')
    expect(markup).not.toContain('ub-freshness')
    expect(markup).not.toContain('Updated')
    expect(markup).not.toContain('Stale')
    expect(markup).not.toContain('PENDING')
  })

  it('shows the pending deposit badge even when data is old', () => {
    mocks.gateway = {
      ...mocks.gateway,
      loading: false,
      hasData: true,
      totalBalance: '1234.50',
      dataUpdatedAt: Date.now() - 45_000,
      pendingDelta: 25,
      pendingByChain: { Base_Sepolia: 25 },
    }

    const markup = renderHero()

    expect(markup).not.toContain('ub-freshness')
    expect(markup).not.toContain('Stale')
    expect(markup).toContain('25.00 PENDING')
    expect(markup).toContain('still indexing 25.00 USDC')
  })

  it('falls back to an em dash without a connected wallet', () => {
    mocks.gateway = {
      ...mocks.gateway,
      loading: false,
      hasData: true,
      totalBalance: '10.00',
      dataUpdatedAt: Date.now(),
      pendingDelta: 25,
      pendingByChain: { Base_Sepolia: 25 },
    }

    const markup = renderToStaticMarkup(React.createElement(UnifiedBalance, {}))

    expect(markup).toContain('—')
    expect(markup).not.toContain('Updated')
    expect(markup).not.toContain('PENDING')
  })
})
