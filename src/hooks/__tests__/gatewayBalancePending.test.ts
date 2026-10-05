// src/hooks/__tests__/gatewayBalancePending.test.ts
// Pending (optimistic) Gateway deposits must be attributed to the chain they came from —
// never silently credited to Arc — and must disappear once Circle's indexer catches up.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/gatewayService', () => ({
  getGatewayBalances: vi.fn(),
}))

import { getGatewayBalances } from '../../services/gatewayService'
import { GATEWAY_DOMAINS } from '../../config/gatewayConfig'
import { fetchGatewayBalancesData } from '../useGatewayBalance'
import { getOptimisticDelta, recordOptimisticDelta } from '../../services/optimisticGatewayTracker'

const WALLET = '0x0000000000000000000000000000000000000001'
const CHAIN_KEYS = Object.keys(GATEWAY_DOMAINS)
const SOURCE_KEY = CHAIN_KEYS.find((key) => key !== 'Arc' && key !== 'Arc_Testnet') ?? CHAIN_KEYS[0]
const OTHER_KEY = CHAIN_KEYS.find((key) => key !== SOURCE_KEY) as string

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}

function mockGatewayResponse(sourceBalance: string, otherBalance: string) {
  vi.mocked(getGatewayBalances).mockResolvedValue({
    token: 'USDC',
    balances: [
      { domain: GATEWAY_DOMAINS[SOURCE_KEY], depositor: WALLET, balance: sourceBalance },
      { domain: GATEWAY_DOMAINS[OTHER_KEY], depositor: WALLET, balance: otherBalance },
    ],
  })
}

function rowBalance(rows: Array<{ chainKey: string; balance: string }>, chainKey: string): string {
  return rows.find((row) => row.chainKey === chainKey)?.balance ?? 'missing'
}

beforeEach(() => {
  vi.stubGlobal('window', {})
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  vi.mocked(getGatewayBalances).mockReset()
})

describe('fetchGatewayBalancesData optimistic attribution', () => {
  it('credits a pending deposit to its source chain instead of Arc', async () => {
    mockGatewayResponse('100.00', '5.00')
    // Raw sum is 105 while the pre-deposit display was 98 → Circle has indexed 7 of 25 USDC.
    recordOptimisticDelta(WALLET, 25, 98, { chainKey: SOURCE_KEY })

    const data = await fetchGatewayBalancesData(WALLET)

    expect(data.pendingDelta).toBe(25)
    expect(data.pendingByChain).toEqual({ [SOURCE_KEY]: 25 })
    expect(rowBalance(data.balances, SOURCE_KEY)).toBe('125.00')
    expect(rowBalance(data.balances, OTHER_KEY)).toBe('5.00')
    expect(data.totalBalance).toBe('130.00')
  })

  it('clears the pending amount once Circle’s indexer catches up', async () => {
    mockGatewayResponse('125.00', '5.00')
    // The raw total moved by 27 of the 25 USDC delta (>= 90%) → already indexed, drop it.
    recordOptimisticDelta(WALLET, 25, 98, { chainKey: SOURCE_KEY })

    const data = await fetchGatewayBalancesData(WALLET)

    expect(data.pendingDelta).toBe(0)
    expect(data.pendingByChain).toEqual({})
    expect(rowBalance(data.balances, SOURCE_KEY)).toBe('125.00')
    expect(data.totalBalance).toBe('130.00')
  })

  it('keeps each chain’s pending amount separate when several deposits are in flight', async () => {
    mockGatewayResponse('100.00', '5.00')
    recordOptimisticDelta(WALLET, 10, 108, { chainKey: SOURCE_KEY })
    recordOptimisticDelta(WALLET, 4, 102, { chainKey: OTHER_KEY })

    const data = await fetchGatewayBalancesData(WALLET)

    expect(data.pendingDelta).toBe(14)
    expect(data.pendingByChain).toEqual({ [SOURCE_KEY]: 10, [OTHER_KEY]: 4 })
    expect(rowBalance(data.balances, SOURCE_KEY)).toBe('110.00')
    expect(rowBalance(data.balances, OTHER_KEY)).toBe('9.00')
    expect(data.totalBalance).toBe('119.00')
  })

  it('treats a delta without a chainKey as total-only instead of guessing a chain', async () => {
    mockGatewayResponse('100.00', '5.00')
    recordOptimisticDelta(WALLET, 25, 98)

    const data = await fetchGatewayBalancesData(WALLET)

    expect(data.pendingDelta).toBe(25)
    expect(data.pendingByChain).toEqual({})
    expect(rowBalance(data.balances, SOURCE_KEY)).toBe('100.00')
    expect(data.totalBalance).toBe('130.00')
  })

  it('exposes the net pending delta through getOptimisticDelta for baseline math', async () => {
    mockGatewayResponse('100.00', '5.00')
    recordOptimisticDelta(WALLET, 7, 99, { chainKey: SOURCE_KEY })

    expect(getOptimisticDelta(WALLET)).toBe(7)
  })
})
