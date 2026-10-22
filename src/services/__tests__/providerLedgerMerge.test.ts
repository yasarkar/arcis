import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCanonicalProviderLedger,
  getStoredProviderEarnings,
  saveStoredProviderEarnings,
} from '../x402PaymentEngine'

const PROVIDER = `0x${'1'.repeat(40)}`

function createStorageMock() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
  }
}

function stubLedger(ledger: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, ledger }), { status: 200 }))
  )
}

describe('canonical provider ledger cache', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorageMock())
    vi.stubGlobal('sessionStorage', createStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("keeps the server's wallet-wide totals instead of summing the empty service rows", async () => {
    stubLedger({
      providerAddress: PROVIDER,
      services: [{ serviceId: 'arc-mev-shield', callsServed: 42, grossUsdc: 0.21, pendingUsdc: 0 }],
      totalCallsServed: 42,
      totalUsdcEarned: 0.21,
      pendingUsdc: 0,
      availableUsdc: 0.05,
      withdrawnUsdc: 0,
    })

    const ledger = await fetchCanonicalProviderLedger(PROVIDER)
    expect(ledger.totalCallsServed).toBe(42)
    // The Provider Hub renders these rows directly; they must survive the cache sync untouched.
    expect(ledger.services).toEqual([
      { serviceId: 'arc-mev-shield', callsServed: 42, grossUsdc: 0.21, pendingUsdc: 0 },
    ])
    expect(getStoredProviderEarnings()[PROVIDER]).toEqual({
      totalCallsServed: 42,
      totalUsdcEarned: 0.21,
      unclaimedEarningsUsdc: 0.05,
    })
  })

  it('does not erase a cached figure when an older response omits the totals', async () => {
    saveStoredProviderEarnings({
      [PROVIDER]: { totalCallsServed: 7, totalUsdcEarned: 0.07, unclaimedEarningsUsdc: 0.02 },
    })
    stubLedger({
      providerAddress: PROVIDER,
      services: [],
      pendingUsdc: 0,
      availableUsdc: 0.02,
      withdrawnUsdc: 0,
    })

    await fetchCanonicalProviderLedger(PROVIDER)
    expect(getStoredProviderEarnings()[PROVIDER]).toMatchObject({
      totalCallsServed: 7,
      totalUsdcEarned: 0.07,
    })
  })

  it('accepts a genuine zero from the server', async () => {
    saveStoredProviderEarnings({
      [PROVIDER]: { totalCallsServed: 9, totalUsdcEarned: 0.09, unclaimedEarningsUsdc: 0 },
    })
    stubLedger({
      providerAddress: PROVIDER,
      services: [],
      totalCallsServed: 0,
      totalUsdcEarned: 0,
      pendingUsdc: 0,
      availableUsdc: 0,
      withdrawnUsdc: 0,
    })

    await fetchCanonicalProviderLedger(PROVIDER)
    expect(getStoredProviderEarnings()[PROVIDER]).toMatchObject({
      totalCallsServed: 0,
      totalUsdcEarned: 0,
    })
  })
})
