import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheLatency,
  fetchLatency,
  normalizeLatencySnapshot,
  readCachedLatency,
} from '../latencyClient'

const SNAPSHOT = {
  source: 'ledger' as const,
  avgLatencyMs: 51,
  sampleCount: 3,
  measuredAt: 1_792_608_233_492,
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

describe('shared latency client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts a well-formed shared reading', () => {
    expect(normalizeLatencySnapshot({ success: true, ...SNAPSHOT })).toEqual(SNAPSHOT)
  })

  it('normalises an unavailable reading to a dash-ready snapshot', () => {
    expect(normalizeLatencySnapshot({ source: 'unavailable' })).toEqual({
      source: 'unavailable',
      avgLatencyMs: null,
      sampleCount: 0,
      measuredAt: null,
    })
  })

  it('refuses payloads that are not a measurement', () => {
    expect(normalizeLatencySnapshot(null)).toBeNull()
    expect(normalizeLatencySnapshot({ avgLatencyMs: 51 })).toBeNull()
    expect(normalizeLatencySnapshot({ source: 'ledger', avgLatencyMs: 51 })).toBeNull()
    expect(
      normalizeLatencySnapshot({ source: 'ledger', avgLatencyMs: -1, sampleCount: 1, measuredAt: 1 })
    ).toBeNull()
    expect(
      normalizeLatencySnapshot({ source: 'ledger', avgLatencyMs: 51, sampleCount: 0, measuredAt: 1 })
    ).toBeNull()
  })

  it('round-trips the last known reading through the session cache', () => {
    vi.stubGlobal('sessionStorage', createStorageMock())
    expect(readCachedLatency()).toBeNull()
    cacheLatency(SNAPSHOT)
    expect(readCachedLatency()).toEqual(SNAPSHOT)
  })

  it('treats an unreadable cache entry as absent', () => {
    const storage = createStorageMock()
    storage.setItem('arcis_shared_latency_v1', '{not json')
    vi.stubGlobal('sessionStorage', storage)
    expect(readCachedLatency()).toBeNull()
  })

  it('returns null when the endpoint answers with an error', async () => {
    vi.stubGlobal('sessionStorage', createStorageMock())
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))

    expect(await fetchLatency()).toBeNull()
  })

  it('caches a reading served by the endpoint', async () => {
    vi.stubGlobal('sessionStorage', createStorageMock())
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => SNAPSHOT })))

    expect(await fetchLatency()).toEqual(SNAPSHOT)
    expect(readCachedLatency()).toEqual(SNAPSHOT)
  })
})
