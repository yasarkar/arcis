import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PLATFORM_STATS_SESSION_MAX_AGE_MS,
  normalizePlatformStats,
  readCachedPlatformStats,
  cachePlatformStats,
} from '../platformStatsClient'

const SNAPSHOT = {
  source: 'ledger' as const,
  acceptedCalls: 1284,
  settledCalls: 1201,
  volumeUsdc: 3.421,
  byService: [{ serviceId: 'arc-mev-shield', acceptedCalls: 40, settledCalls: 38 }],
  updatedAt: 1760900000000,
}

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
  }
}

describe('platform stats client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a well-formed ledger snapshot', () => {
    expect(normalizePlatformStats({ success: true, ...SNAPSHOT })).toEqual(SNAPSHOT)
  })

  it('refuses payloads that do not declare a source', () => {
    expect(normalizePlatformStats({ acceptedCalls: 5 })).toBeNull()
    expect(normalizePlatformStats(null)).toBeNull()
    expect(normalizePlatformStats('nope')).toBeNull()
  })

  it('never surfaces a negative or non-numeric count', () => {
    const parsed = normalizePlatformStats({
      source: 'ledger',
      acceptedCalls: -4,
      settledCalls: 'oops',
      volumeUsdc: 'x',
      byService: [{ serviceId: 'svc-a', acceptedCalls: -1, settledCalls: 2 }, { acceptedCalls: 1 }],
      updatedAt: 0,
    })
    expect(parsed).toMatchObject({
      acceptedCalls: 0,
      settledCalls: 0,
      volumeUsdc: 0,
      updatedAt: null,
      byService: [{ serviceId: 'svc-a', acceptedCalls: 0, settledCalls: 2 }],
    })
  })

  it('round-trips the last known snapshot through the session cache', () => {
    vi.stubGlobal('sessionStorage', createStorageMock())
    expect(readCachedPlatformStats()).toBeNull()
    cachePlatformStats(SNAPSHOT)
    expect(readCachedPlatformStats()).toEqual(SNAPSHOT)
  })

  it('treats an unreadable cache entry as absent', () => {
    const storage = createStorageMock()
    storage.setItem('arcis_platform_stats_v1', '{not json')
    vi.stubGlobal('sessionStorage', storage)
    expect(readCachedPlatformStats()).toBeNull()
  })

  it('expires cached platform stats after 60 seconds', () => {
    vi.stubGlobal('sessionStorage', createStorageMock())
    const t0 = 1_760_900_000_000
    cachePlatformStats(SNAPSHOT, t0)
    expect(readCachedPlatformStats(t0 + PLATFORM_STATS_SESSION_MAX_AGE_MS)).toEqual(SNAPSHOT)
    expect(readCachedPlatformStats(t0 + PLATFORM_STATS_SESSION_MAX_AGE_MS + 1)).toBeNull()
  })

  it('clears the session cache when the server reports unavailable', () => {
    vi.stubGlobal('sessionStorage', createStorageMock())
    const t0 = 1_760_900_000_000
    cachePlatformStats(SNAPSHOT, t0)
    expect(readCachedPlatformStats(t0 + 1000)).toEqual(SNAPSHOT)

    cachePlatformStats(
      {
        source: 'unavailable',
        acceptedCalls: 0,
        settledCalls: 0,
        volumeUsdc: 0,
        byService: [],
        updatedAt: null,
      },
      t0 + 2000
    )
    expect(readCachedPlatformStats(t0 + 2000)).toBeNull()
  })
})
