import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetLatencyForTests,
  isLatencyFresh,
  LATENCY_TTL_SECONDS,
  latencyKey,
  measureLatency,
  parseLatencySnapshot,
  readLatencySnapshot,
} from '../x402Latency'

function okResponse(): Response {
  return {
    ok: true,
    json: async () => ({ jsonrpc: '2.0', result: '0x1' }),
  } as unknown as Response
}

describe('shared x402 latency', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('KV_URL', '')
    vi.stubEnv('VERCEL_ENV', '')
    await __resetLatencyForTests()
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    await __resetLatencyForTests()
  })

  it('namespaces the reading so preview traffic cannot borrow production latency', () => {
    expect(latencyKey()).toContain(':test')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(latencyKey()).toBe(`arcis:x402:latency:v1:preview`)
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(latencyKey()).toContain(':production')
  })

  it('averages the successful server samples and drops failed ones', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 2) throw new Error('rpc unreachable')
      return okResponse()
    }) as unknown as typeof fetch

    const snapshot = await measureLatency({
      rpcUrls: ['https://rpc.example'],
      fetchImpl,
      samples: 3,
      now: () => 1_792_608_233_492,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(snapshot.source).toBe('ledger')
    expect(snapshot.sampleCount).toBe(2)
    expect(snapshot.avgLatencyMs).toBeGreaterThanOrEqual(0)
    expect(snapshot.measuredAt).toBe(1_792_608_233_492)
  })

  it('reports unavailable, not zero, when every sample fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('rpc unreachable')
    }) as unknown as typeof fetch

    const snapshot = await measureLatency({ rpcUrls: ['https://rpc.example'], fetchImpl, samples: 2 })

    expect(snapshot).toEqual({
      source: 'unavailable',
      avgLatencyMs: null,
      sampleCount: 0,
      measuredAt: null,
    })
  })

  it('reports unavailable when no RPC URL is configured', async () => {
    const fetchImpl = vi.fn(async () => okResponse()) as unknown as typeof fetch
    const snapshot = await measureLatency({ rpcUrls: [], fetchImpl })

    expect(snapshot.source).toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('treats a reading as fresh only inside the TTL', () => {
    const base = 1_792_608_233_492
    const snapshot = { source: 'ledger' as const, avgLatencyMs: 51, sampleCount: 3, measuredAt: base }

    expect(isLatencyFresh(snapshot, base + (LATENCY_TTL_SECONDS - 1) * 1000)).toBe(true)
    expect(isLatencyFresh(snapshot, base + (LATENCY_TTL_SECONDS + 1) * 1000)).toBe(false)
  })

  it('refuses malformed stored readings', () => {
    expect(parseLatencySnapshot(null, 'ledger')).toBeNull()
    expect(parseLatencySnapshot('{not json', 'ledger')).toBeNull()
    expect(parseLatencySnapshot(JSON.stringify({ avgLatencyMs: 10 }), 'ledger')).toBeNull()
    expect(
      parseLatencySnapshot(JSON.stringify({ avgLatencyMs: -1, sampleCount: 1, measuredAt: 1 }), 'ledger')
    ).toBeNull()
    expect(
      parseLatencySnapshot(JSON.stringify({ avgLatencyMs: 10, sampleCount: 0, measuredAt: 1 }), 'ledger')
    ).toBeNull()
    expect(
      parseLatencySnapshot(JSON.stringify({ avgLatencyMs: 10, sampleCount: 2, measuredAt: 1 }), 'memory')
    ).toEqual({ source: 'memory', avgLatencyMs: 10, sampleCount: 2, measuredAt: 1 })
  })

  it('measures once per TTL instead of once per visitor', async () => {
    const fetchImpl = vi.fn(async () => okResponse())
    vi.stubGlobal('fetch', fetchImpl)

    const first = await readLatencySnapshot()
    expect(first.source).toBe('memory')
    expect(first.sampleCount).toBeGreaterThan(0)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    const second = await readLatencySnapshot()
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
