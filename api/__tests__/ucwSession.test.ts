// api/__tests__/ucwSession.test.ts
//
// The UCW session cookie is the thing that keeps a wallet's signing authority out
// of browser storage, so it has to be unforgeable and short-lived. These tests
// pin what a silent regression would give away: the tamper and expiry rejection,
// the cookie attributes, and the fail-closed behaviour when no signing secret
// exists. The MAC itself is HMAC-SHA256 from `crypto.subtle` — a standard
// primitive, so it is pinned by the round-trip rather than re-implemented here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UCW_SESSION_COOKIE,
  buildClearUcwSessionCookie,
  buildUcwSessionCookie,
  isSecureRequest,
  readUcwSession,
  resolveUcwUserToken,
} from '../_utils/ucwSession'

const SECRET = 'test-ucw-session-secret'

function requestWith(cookieHeader?: string, url = 'https://arcis.example/api/ucw'): Request {
  return new Request(url, {
    method: 'POST',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  })
}

/** Extracts just the `name=value` pair from a Set-Cookie header value. */
function cookiePair(setCookie: string): string {
  return setCookie.split(';')[0]
}

beforeEach(() => {
  vi.stubEnv('UCW_SESSION_SECRET', SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ucwSession cookie round-trip', () => {
  it('reads back what it signed', async () => {
    const setCookie = await buildUcwSessionCookie(
      { userToken: 'u-token-1', encryptionKey: 'e-key-1', walletId: 'w-1', address: '0xabc' },
      { secure: true }
    )

    const session = await readUcwSession(requestWith(cookiePair(setCookie)))
    expect(session).toEqual({
      userToken: 'u-token-1',
      encryptionKey: 'e-key-1',
      walletId: 'w-1',
      address: '0xabc',
    })
  })

  it('omits empty optional fields instead of persisting blanks', async () => {
    const setCookie = await buildUcwSessionCookie(
      { userToken: 'u-token-2', encryptionKey: '', walletId: undefined, address: '' },
      { secure: false }
    )

    const session = await readUcwSession(requestWith(cookiePair(setCookie)))
    expect(session).toEqual({ userToken: 'u-token-2' })
  })

  it('never leaks the token in the cookie attributes', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'u-token-3' }, { secure: true })
    expect(setCookie).toContain(`${UCW_SESSION_COOKIE}=`)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/api/ucw')
    expect(setCookie).toContain('Max-Age=3600')
  })

  it('adds Secure only when the request is HTTPS', async () => {
    const secure = await buildUcwSessionCookie({ userToken: 'u' }, { secure: true })
    const insecure = await buildUcwSessionCookie({ userToken: 'u' }, { secure: false })

    expect(secure).toContain('; Secure')
    expect(insecure).not.toContain('Secure')
  })

  it('honours a custom max age', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'u' }, { secure: true, maxAgeSeconds: 120 })
    expect(setCookie).toContain('Max-Age=120')
  })
})

describe('ucwSession tamper resistance', () => {
  it('rejects a cookie whose MAC was rewritten', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'u-token' }, { secure: true })
    const [pair] = cookiePair(setCookie).split('=')
    const value = cookiePair(setCookie).slice(pair.length + 1)
    const [payload, mac] = value.split('.')
    const tamperedMac = (mac[0] === 'A' ? 'B' : 'A') + mac.slice(1)

    expect(await readUcwSession(requestWith(`${UCW_SESSION_COOKIE}=${payload}.${tamperedMac}`))).toBeNull()
  })

  it('rejects a cookie whose payload was swapped for another', async () => {
    const real = await buildUcwSessionCookie({ userToken: 'theirs' }, { secure: true })
    const forged = await buildUcwSessionCookie({ userToken: 'mine' }, { secure: true })
    const realValue = cookiePair(real).split('=').slice(1).join('=')
    const forgedValue = cookiePair(forged).split('=').slice(1).join('=')

    const forgedPayload = forgedValue.split('.')[0]
    const realMac = realValue.split('.')[1]

    expect(
      await readUcwSession(requestWith(`${UCW_SESSION_COOKIE}=${forgedPayload}.${realMac}`))
    ).toBeNull()
  })

  it('rejects an expired session even when the MAC is valid', async () => {
    // Mint a session that expired an hour ago; the signature stays valid, so only
    // the `exp` claim can reject it.
    const realNow = Date.now()
    vi.useFakeTimers()
    vi.setSystemTime(realNow - 2 * 60 * 60 * 1000)
    const setCookie = await buildUcwSessionCookie({ userToken: 'u' }, { secure: true, maxAgeSeconds: 60 })
    vi.setSystemTime(realNow)
    vi.useRealTimers()

    expect(await readUcwSession(requestWith(cookiePair(setCookie)))).toBeNull()
  })

  it('returns null for missing, empty or malformed cookies instead of throwing', async () => {
    expect(await readUcwSession(requestWith())).toBeNull()
    expect(await readUcwSession(requestWith('other=1'))).toBeNull()
    expect(await readUcwSession(requestWith(`${UCW_SESSION_COOKIE}=`))).toBeNull()
    expect(await readUcwSession(requestWith(`${UCW_SESSION_COOKIE}=no-separator`))).toBeNull()
    expect(await readUcwSession(requestWith(`${UCW_SESSION_COOKIE}=%zz.bad`))).toBeNull()
    expect(await readUcwSession(requestWith(`${UCW_SESSION_COOKIE}=not-json.not-a-mac`))).toBeNull()
  })

  it('finds its cookie among several', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'u-among-many' }, { secure: true })
    const header = `theme=dark; ${cookiePair(setCookie)}; locale=tr`

    expect((await readUcwSession(requestWith(header)))?.userToken).toBe('u-among-many')
  })

  it('round-trips a token that contains an equals sign', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'u=with=equals' }, { secure: true })
    const session = await readUcwSession(requestWith(cookiePair(setCookie)))
    expect(session?.userToken).toBe('u=with=equals')
  })
})

describe('ucwSession clearing', () => {
  it('expires the cookie immediately', () => {
    const cleared = buildClearUcwSessionCookie({ secure: true })
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('HttpOnly')
    expect(cleared).toContain('Secure')

    expect(buildClearUcwSessionCookie({ secure: false })).not.toContain('Secure')
  })
})

describe('ucwSession resolveUcwUserToken', () => {
  it('prefers the session cookie over a body token', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'cookie-token' }, { secure: true })

    const token = await resolveUcwUserToken(
      requestWith(cookiePair(setCookie)),
      { userToken: 'body-token' }
    )
    expect(token).toBe('cookie-token')
  })

  it('falls back to the sanitized body token while clients migrate', async () => {
    expect(await resolveUcwUserToken(requestWith(), { userToken: '  body-token  ' })).toBe('body-token')
    expect(await resolveUcwUserToken(requestWith(), {})).toBe('')
    expect(await resolveUcwUserToken(requestWith(), { userToken: 42 })).toBe('')
  })

  it('truncates an oversized body token', async () => {
    const resolved = await resolveUcwUserToken(requestWith(), { userToken: 'x'.repeat(5000) })
    expect(resolved).toHaveLength(1024)
  })
})

describe('ucwSession fail-closed without a signing secret', () => {
  it('refuses to mint a cookie when neither secret is configured', async () => {
    vi.stubEnv('UCW_SESSION_SECRET', '')
    vi.stubEnv('CIRCLE_API_KEY', '')

    await expect(buildUcwSessionCookie({ userToken: 'u' }, { secure: true })).rejects.toThrow(/secret/i)
  })

  it('falls back to CIRCLE_API_KEY as the signing secret', async () => {
    vi.stubEnv('UCW_SESSION_SECRET', '')
    vi.stubEnv('CIRCLE_API_KEY', 'circle-api-key-secret')

    const setCookie = await buildUcwSessionCookie({ userToken: 'u-key' }, { secure: true })
    expect((await readUcwSession(requestWith(cookiePair(setCookie))))?.userToken).toBe('u-key')
  })

  it('rejects any cookie when no secret is configured', async () => {
    const setCookie = await buildUcwSessionCookie({ userToken: 'u' }, { secure: true })
    vi.stubEnv('UCW_SESSION_SECRET', '')
    vi.stubEnv('CIRCLE_API_KEY', '')

    expect(await readUcwSession(requestWith(cookiePair(setCookie)))).toBeNull()
  })
})

describe('isSecureRequest', () => {
  // ARC-020: the scheme decides whether the session cookie carries `Secure`. A caller-supplied
  // `x-forwarded-proto` must not be able to withhold it, so only a signed adapter header or a
  // sanitizing edge may name the protocol.
  it('believes the request URL', () => {
    expect(isSecureRequest(new Request('https://arcis.example/api/ucw'))).toBe(true)
    expect(isSecureRequest(new Request('http://127.0.0.1:3000/api/ucw'))).toBe(false)
  })

  it('ignores a caller-supplied x-forwarded-proto when no trusted source signed it', () => {
    const spoofed = new Request('http://127.0.0.1:3000/api/ucw', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(isSecureRequest(spoofed)).toBe(false)
  })

  it('honours the protocol the Express/Vite adapter observed and signed', async () => {
    const { signInternalClientIpHeaders } = await import('../_utils/trustedIp')
    const headers: Record<string, string> = { 'x-forwarded-proto': 'https' }
    signInternalClientIpHeaders(headers, '127.0.0.1', 'http')

    expect(isSecureRequest(new Request('http://127.0.0.1:3000/api/ucw', { headers }))).toBe(false)

    const secureHeaders: Record<string, string> = {}
    signInternalClientIpHeaders(secureHeaders, '127.0.0.1', 'https')
    expect(isSecureRequest(new Request('http://127.0.0.1:3000/api/ucw', { headers: secureHeaders }))).toBe(true)
  })

  it('honours a sanitizing edge that overwrites x-forwarded-proto', () => {
    vi.stubEnv('VERCEL', '1')

    const edge = new Request('http://arcis.example/api/ucw', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    expect(isSecureRequest(edge)).toBe(true)

    // A caller-prepended entry would sit beside the edge's value: ambiguous, so not trusted.
    const ambiguous = new Request('http://arcis.example/api/ucw', {
      headers: { 'x-forwarded-proto': 'https, http' },
    })
    expect(isSecureRequest(ambiguous)).toBe(false)
  })
})
