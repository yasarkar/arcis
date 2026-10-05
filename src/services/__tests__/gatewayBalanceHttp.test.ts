// src/services/__tests__/gatewayBalanceHttp.test.ts
// The Circle Gateway balance read must never hang the 10s poll: every attempt is bounded by a
// timeout, transient failures are retried with backoff, and non-retryable 4xx fail immediately.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGatewayWithRetry } from '../gatewayService'

const URL_UNDER_TEST = 'https://gateway-api-testnet.circle.com/v1/balances'

function okResponse(body: unknown = { balances: [] }): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchGatewayWithRetry', () => {
  it('returns the first ok response without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchGatewayWithRetry(URL_UNDER_TEST, { method: 'POST' })

    expect(response.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a transient 503 and returns the later ok response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('service unavailable', { status: 503 }))
      .mockResolvedValueOnce(okResponse({ balances: [{ domain: 0, depositor: '0x', balance: '1' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await fetchGatewayWithRetry(URL_UNDER_TEST, { method: 'POST' }, { baseDelayMs: 1 })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-retryable 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad request', { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchGatewayWithRetry(URL_UNDER_TEST, { method: 'POST' }, { baseDelayMs: 1 })
    ).rejects.toThrow(/400/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts a hung attempt with the configured timeout instead of waiting forever', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason ?? new Error('aborted'))
          )
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchGatewayWithRetry(URL_UNDER_TEST, { method: 'POST' }, { attempts: 1, timeoutMs: 20 })
    ).rejects.toThrow(/abort|timeout/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after the configured attempts and throws the last error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('socket hang up'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchGatewayWithRetry(URL_UNDER_TEST, { method: 'POST' }, { attempts: 2, baseDelayMs: 1 })
    ).rejects.toThrow('socket hang up')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
