import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
})
