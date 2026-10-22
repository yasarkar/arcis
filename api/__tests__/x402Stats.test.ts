import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPlatformStatsForTests,
  getPlatformStatsNamespace,
  parsePlatformStats,
  platformStatsKey,
  readPlatformStats,
  recordPlatformCall,
} from '../_utils/x402Stats'

const PROVIDER = `0x${'1'.repeat(40)}`
const OTHER_PROVIDER = `0x${'2'.repeat(40)}`
const NONCE = `0x${'a'.repeat(64)}`
const OTHER_NONCE = `0x${'b'.repeat(64)}`

describe('x402 platform stats counters', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv('KV_REST_API_URL', '')
    vi.stubEnv('KV_REST_API_TOKEN', '')
    vi.stubEnv('REDIS_URL', '')
    vi.stubEnv('KV_URL', '')
    vi.stubEnv('VERCEL_ENV', '')
    __resetPlatformStatsForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    __resetPlatformStatsForTests()
  })

  it('namespaces the counter by VERCEL_ENV so preview traffic cannot inflate production', () => {
    expect(getPlatformStatsNamespace()).toBe('test')
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect(getPlatformStatsNamespace()).toBe('preview')
    expect(platformStatsKey()).toContain(':preview')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(platformStatsKey()).not.toBe('arcis:x402:stats:v1:preview')
    expect(platformStatsKey()).toContain(':production')
  })

  it('counts one facilitated call once, with its exact volume and service attribution', async () => {
    const result = await recordPlatformCall('accepted', {
      providerAddress: PROVIDER,
      nonce: NONCE,
      serviceId: 'arc-cross-dex-arbitrage-sentinel',
      amountMicros: 5000,
    })
    expect(result).toBe('recorded')

    const snapshot = await readPlatformStats()
    expect(snapshot.source).toBe('memory')
    expect(snapshot.acceptedCalls).toBe(1)
    expect(snapshot.settledCalls).toBe(0)
    expect(snapshot.volumeUsdc).toBe(0.005)
    expect(snapshot.byService).toEqual([
      { serviceId: 'arc-cross-dex-arbitrage-sentinel', acceptedCalls: 1, settledCalls: 0 },
    ])
    expect(snapshot.updatedAt).toBeGreaterThan(0)
  })

  it('is exactly-once per authorization, even when the call is recorded twice', async () => {
    const call = {
      providerAddress: PROVIDER,
      nonce: NONCE,
      serviceId: 'arc-cross-dex-arbitrage-sentinel',
      amountMicros: 5000,
    }
    expect(await recordPlatformCall('accepted', call)).toBe('recorded')
    expect(await recordPlatformCall('accepted', call)).toBe('duplicate')

    const snapshot = await readPlatformStats()
    expect(snapshot.acceptedCalls).toBe(1)
    expect(snapshot.volumeUsdc).toBe(0.005)
  })

  it('tracks settlement separately without adding volume a second time', async () => {
    const call = {
      providerAddress: OTHER_PROVIDER,
      nonce: OTHER_NONCE,
      serviceId: 'arc-mev-shield',
      amountMicros: 2500,
    }
    await recordPlatformCall('accepted', call)
    expect(await recordPlatformCall('settled', { ...call, amountMicros: undefined })).toBe('recorded')
    expect(await recordPlatformCall('settled', { ...call, amountMicros: undefined })).toBe('duplicate')

    const snapshot = await readPlatformStats()
    expect(snapshot.acceptedCalls).toBe(1)
    expect(snapshot.settledCalls).toBe(1)
    expect(snapshot.volumeUsdc).toBe(0.0025)
    expect(snapshot.byService[0]).toMatchObject({ serviceId: 'arc-mev-shield', settledCalls: 1 })
  })

  it('sorts service rows by accepted calls and rejects malformed inputs', async () => {
    await recordPlatformCall('accepted', {
      providerAddress: PROVIDER,
      nonce: NONCE,
      serviceId: 'svc-b',
      amountMicros: 1000,
    })
    await recordPlatformCall('accepted', {
      providerAddress: PROVIDER,
      nonce: OTHER_NONCE,
      serviceId: 'svc-a',
      amountMicros: 1000,
    })
    const snapshot = await readPlatformStats()
    expect(snapshot.byService.map((row) => row.serviceId)).toEqual(['svc-a', 'svc-b'])

    expect(
      await recordPlatformCall('accepted', {
        providerAddress: 'not-an-address',
        nonce: NONCE,
        serviceId: 'svc-a',
      })
    ).toBe('unavailable')
    expect(
      await recordPlatformCall('accepted', {
        providerAddress: PROVIDER,
        nonce: NONCE,
        serviceId: 'svc-a',
        amountMicros: -1,
      })
    ).toBe('unavailable')
    expect((await readPlatformStats()).acceptedCalls).toBe(2)
  })

  it('refuses a process-local count as a protocol metric in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    __resetPlatformStatsForTests()

    const result = await recordPlatformCall('accepted', {
      providerAddress: PROVIDER,
      nonce: NONCE,
      serviceId: 'svc-a',
      amountMicros: 1000,
    })
    expect(result).toBe('unavailable')

    const snapshot = await readPlatformStats()
    expect(snapshot.source).toBe('unavailable')
    expect(snapshot.acceptedCalls).toBe(0)
    expect(snapshot.updatedAt).toBeNull()
  })

  it('parses a stored hash into a snapshot', () => {
    const snapshot = parsePlatformStats(
      {
        accepted: '7',
        settled: '5',
        volumeMicros: '12500',
        updatedAt: '1700000000000',
        'svc:svc-a': '4',
        'svcSettled:svc-a': '3',
        'svc:svc-b': '3',
      },
      'ledger'
    )
    expect(snapshot).toMatchObject({
      source: 'ledger',
      acceptedCalls: 7,
      settledCalls: 5,
      volumeUsdc: 0.0125,
      updatedAt: 1700000000000,
    })
    expect(snapshot.byService).toEqual([
      { serviceId: 'svc-a', acceptedCalls: 4, settledCalls: 3 },
      { serviceId: 'svc-b', acceptedCalls: 3, settledCalls: 0 },
    ])
  })
})
