// api/__tests__/trustedIp.test.ts
// ARC-007: forwarding headers are caller-controlled text unless a sanitizing edge replaced them.
// These pin the three postures — internal signature, sanitizing edge, and nothing — so a future
// refactor cannot quietly hand rate-limit buckets to a spoofed header.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNRESOLVED_CLIENT_IP,
  extractTrustedClientIp,
  readTrustedProtocol,
  signInternalClientIpHeaders,
  trustedProxyHops,
} from '../_utils/trustedIp'

function requestWith(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/faucet', { headers })
}

function signedRequest(clientIp: string, extra: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { ...extra }
  signInternalClientIpHeaders(headers, clientIp)
  return requestWith(headers)
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('internal signature', () => {
  it('returns the adapter-observed IP and ignores any caller-supplied chain', () => {
    const ip = extractTrustedClientIp(signedRequest('203.0.113.9', { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))
    expect(ip).toBe('203.0.113.9')
  })

  it('rejects a signed header whose value is not an IP literal', () => {
    const ip = extractTrustedClientIp(signedRequest('not-an-ip'))
    expect(ip).toBe(UNRESOLVED_CLIENT_IP)
  })
})

describe('signed protocol (ARC-020)', () => {
  it('strips a caller-supplied x-forwarded-proto and signs the observed scheme instead', () => {
    const headers: Record<string, string> = { 'x-forwarded-proto': 'https' }
    signInternalClientIpHeaders(headers, '203.0.113.9', 'http')

    expect(headers['x-forwarded-proto']).toBeUndefined()
    expect(readTrustedProtocol(requestWith(headers))).toBe('http')
  })

  it('reports https only when the adapter observed https', () => {
    const headers: Record<string, string> = {}
    signInternalClientIpHeaders(headers, '203.0.113.9', 'https')
    expect(readTrustedProtocol(requestWith(headers))).toBe('https')
  })

  it('never trusts an unsigned forwarding header', () => {
    expect(readTrustedProtocol(requestWith({ 'x-forwarded-proto': 'https' }))).toBeNull()
    expect(readTrustedProtocol(requestWith({ 'x-arcis-proto': 'https' }))).toBeNull()
  })

  it('accepts a single-value header from a sanitizing edge and rejects an ambiguous chain', () => {
    vi.stubEnv('VERCEL', '1')
    expect(readTrustedProtocol(requestWith({ 'x-forwarded-proto': 'https' }))).toBe('https')
    expect(readTrustedProtocol(requestWith({ 'x-forwarded-proto': 'https, http' }))).toBeNull()
    expect(readTrustedProtocol(requestWith({ 'x-forwarded-proto': 'gopher' }))).toBeNull()
  })
})

describe('no sanitizing edge', () => {
  it('never returns a caller-chosen address', () => {
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '1.2.3.4' }))).toBe(UNRESOLVED_CLIENT_IP)
    expect(extractTrustedClientIp(requestWith({ 'x-real-ip': '1.2.3.4' }))).toBe(UNRESOLVED_CLIENT_IP)
    expect(extractTrustedClientIp(requestWith({ 'cf-connecting-ip': '1.2.3.4' }))).toBe(UNRESOLVED_CLIENT_IP)
    expect(extractTrustedClientIp(requestWith({ 'true-client-ip': '1.2.3.4' }))).toBe(UNRESOLVED_CLIENT_IP)
  })

  it('collapses every spoofed chain into one bucket', () => {
    const first = extractTrustedClientIp(requestWith({ 'x-forwarded-for': '10.0.0.1' }))
    const second = extractTrustedClientIp(requestWith({ 'x-forwarded-for': '10.0.0.2, 10.0.0.3' }))
    expect(first).toBe(second)
    expect(first).toBe(UNRESOLVED_CLIENT_IP)
  })

  it('does not treat a look-alike env value as a trusted edge', () => {
    vi.stubEnv('VERCEL', '0')
    vi.stubEnv('TRUST_PROXY_HEADERS', 'yes')
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '1.2.3.4' }))).toBe(UNRESOLVED_CLIENT_IP)
  })
})

describe('sanitizing edge', () => {
  it('reads the hop its own edge appended, not caller-prepended entries (Vercel)', () => {
    vi.stubEnv('VERCEL', '1')
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7' }))).toBe('198.51.100.7')
    // The same client behind a different spoofed prefix keeps the same bucket.
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '7.7.7.7, 198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('honors an operator-declared hop count', () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'true')
    vi.stubEnv('TRUSTED_PROXY_HOPS', '2')
    expect(trustedProxyHops()).toBe(2)
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1, 10.0.0.2' }))).toBe('10.0.0.1')
  })

  it('falls back to edge-provided single-value headers when no chain is present', () => {
    vi.stubEnv('VERCEL', '1')
    expect(extractTrustedClientIp(requestWith({ 'x-real-ip': '198.51.100.8' }))).toBe('198.51.100.8')
    expect(extractTrustedClientIp(requestWith({ 'cf-connecting-ip': '198.51.100.9' }))).toBe('198.51.100.9')
    expect(extractTrustedClientIp(requestWith({ 'true-client-ip': '198.51.100.10' }))).toBe('198.51.100.10')
  })

  it('ignores a junk hop instead of turning it into a bucket key', () => {
    vi.stubEnv('VERCEL', '1')
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': 'evil-value' }))).toBe(UNRESOLVED_CLIENT_IP)
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': 'evil-value', 'x-real-ip': '198.51.100.11' }))).toBe('198.51.100.11')
  })

  it('normalizes ports and accepts IPv6 literals', () => {
    vi.stubEnv('VERCEL', '1')
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '198.51.100.12:4711' }))).toBe('198.51.100.12')
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '[2001:db8::1]:4711' }))).toBe('2001:db8::1')
    expect(extractTrustedClientIp(requestWith({ 'x-forwarded-for': '::1' }))).toBe('::1')
  })
})
