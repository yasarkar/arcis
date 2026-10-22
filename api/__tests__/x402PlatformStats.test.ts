import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../x402'
import { __resetPlatformStatsForTests, recordPlatformCall } from '../_utils/x402Stats'

const STATS_URL = 'http://localhost:3000/api/x402/stats'

async function readStats() {
  const response = await GET(new Request(STATS_URL, { headers: { Accept: 'application/json' } }))
  return { response, body: await response.json() }
}

describe('GET /api/x402/stats', () => {
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

  it('is reachable on the existing /api/x402 rewrite instead of being treated as a service id', async () => {
    const { response, body } = await readStats()
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.error).toBeUndefined()
  })

  it('reports an unavailable counter as such instead of as zero calls', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    __resetPlatformStatsForTests()

    const { body, response } = await readStats()
    expect(body.source).toBe('unavailable')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('serves the shared snapshot with an edge cache window', async () => {
    await recordPlatformCall('accepted', {
      providerAddress: `0x${'1'.repeat(40)}`,
      nonce: `0x${'a'.repeat(64)}`,
      serviceId: 'arc-cross-dex-arbitrage-sentinel',
      amountMicros: 5000,
    })

    const { body, response } = await readStats()
    expect(body.acceptedCalls).toBe(1)
    expect(body.settledCalls).toBe(0)
    expect(body.volumeUsdc).toBe(0.005)
    expect(body.source).toBe('memory')
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=15')
    expect(response.headers.get('Cache-Control')).toContain('stale-while-revalidate=45')
  })
})
