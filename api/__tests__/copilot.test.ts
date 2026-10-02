// api/__tests__/copilot.test.ts
// Adversarial coverage for the /api/copilot proxy: credential handling and per-IP rate limiting.
// The exported Web-standard handler is invoked directly — exactly the entry point that both the
// Express adapter (server.ts) and the Vercel serverless runtime call.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { POST } from '../copilot'

function makeRequest(ip: string, auth?: string): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-forwarded-for': ip,
  }
  if (auth) headers.Authorization = auth
  return new Request('http://localhost/api/copilot', {
    method: 'POST',
    headers,
    body: JSON.stringify({ userPrompt: 'hi' }),
  })
}

beforeEach(() => {
  // Make the suite independent of any ambient provider key, so "no usable key" is deterministic
  // and no test can reach a real provider.
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('OPENROUTER_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/copilot — credential handling', () => {
  it('rejects a request with no usable key', async () => {
    const res = await POST(makeRequest('10.1.0.1'))
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.code).toBe('MISSING_AI_KEY')
  })

  it('ignores a malformed Authorization header instead of forwarding it upstream', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(makeRequest('10.1.0.2', 'Bearer not-a-real-key'))

    expect(res.status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('honors a well-formed BYOK key and forwards exactly that key upstream', async () => {
    const fetchSpy = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetchSpy)

    const res = await POST(makeRequest('10.1.0.3', 'Bearer sk-testsecret0123456789abcdef'))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, any]
    expect(String(url)).toContain('api.openai.com')
    expect(init.headers.Authorization).toBe('Bearer sk-testsecret0123456789abcdef')
    // The upstream rejection is surfaced to the caller as a provider failure.
    expect(res.status).toBe(502)
  })

  it('never writes the BYOK key to the console', async () => {
    const fetchSpy = vi.fn(async () => new Response('unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetchSpy)

    const logged: string[] = []
    const capture = (...args: any[]) => {
      logged.push(args.map((arg) => String(arg)).join(' '))
    }
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'error').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
    ]

    try {
      await POST(makeRequest('10.1.0.4', 'Bearer sk-testsecret0123456789abcdef'))
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }

    expect(logged.join('\n')).not.toContain('testsecret0123456789abcdef')
  })
})

describe('POST /api/copilot — per-IP rate limiting', () => {
  it('allows 20 requests and returns 429 on the 21st', async () => {
    const codes: number[] = []
    for (let i = 0; i < 21; i++) {
      codes.push((await POST(makeRequest('10.2.0.0'))).status)
    }

    expect(codes.slice(0, 20).every((code) => code === 401)).toBe(true)
    expect(codes[20]).toBe(429)
  })

  it('does not share the bucket across distinct client IPs', async () => {
    expect((await POST(makeRequest('10.3.0.9'))).status).toBe(401)
  })

  it('buckets by the first x-forwarded-for hop', async () => {
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest('10.9.0.1, 10.9.0.2'))
    }

    // A different proxy chain but the same client hop must share the exhausted bucket.
    expect((await POST(makeRequest('10.9.0.1, 10.9.0.3'))).status).toBe(429)
  })

  it('rate limits before parsing the body, so malformed payloads cannot bypass it', async () => {
    const ip = '10.4.0.0'
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(ip))
    }

    const malformed = new Request('http://localhost/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: '{not valid json',
    })

    expect((await POST(malformed)).status).toBe(429)
  })

  it('advertises a retry delay on the 429 response', async () => {
    const ip = '10.5.0.0'
    for (let i = 0; i < 20; i++) {
      await POST(makeRequest(ip))
    }

    const res = await POST(makeRequest(ip))
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED')
    expect(typeof body.retryAfter).toBe('number')
    expect(body.retryAfter).toBeGreaterThan(0)
  })
})
