// api/_utils/trustedIp.ts
// Client IP resolution for IP-scoped rate limits (faucet, copilot, UCW OTP) — audit ARC-007.
//
// Two trusted sources exist, in this order:
//
//   1. The internal signature. `server.ts` (Express) and `vite.config.ts` (dev server) strip every
//      caller-supplied forwarding header and sign the IP they observed on the socket, so the
//      signing secret is the only way to claim an IP on those paths.
//   2. A sanitizing edge. On Vercel the platform *overwrites* `x-forwarded-for` with the address of
//      the peer that opened the connection (https://vercel.com/docs/headers/request-headers), so a
//      caller cannot inject entries. The same is true for operators who terminate a reverse proxy
//      that rewrites the header; they opt in with `TRUST_PROXY_HEADERS=true`.
//
// Anywhere else the process is directly reachable, so a forwarding header is caller-controlled text
// and every request shares one conservative bucket instead of being handed an attacker-chosen IP.

import { isIP } from 'node:net'

const PROCESS_INTERNAL_AUTH_SECRET = (
  globalThis as any
).__arcis_internal_auth_secret || ((globalThis as any).__arcis_internal_auth_secret = Math.random().toString(36).slice(2) + Date.now().toString(36))

/**
 * Identity used when no trusted source can name the client. All such requests share a single
 * rate-limit bucket: an unknown deployment enforces the global budget instead of a spoofable
 * per-IP budget. Enable `TRUST_PROXY_HEADERS=true` only when a proxy in front of this process
 * rewrites `x-forwarded-for`.
 */
export const UNRESOLVED_CLIENT_IP = 'unresolved'

/** Headers a sanitizing edge sets with the peer address it observed. */
const EDGE_IP_HEADERS = ['x-real-ip', 'cf-connecting-ip', 'true-client-ip'] as const

/** Protocol the adapter observed on the socket, signed exactly like the client IP. */
const INTERNAL_PROTOCOL_HEADER = 'x-arcis-proto'

let warnedAboutUntrustedForwardingHeaders = false

export function signInternalClientIpHeaders(
  headers: Record<string, string>,
  clientIp: string,
  observedProtocol?: string
) {
  // Strip untrusted / spoofable incoming headers
  delete headers['x-forwarded-for']
  delete headers['cf-connecting-ip']
  delete headers['true-client-ip']
  delete headers['x-real-ip']
  delete headers['x-arcis-client-ip']
  delete headers['x-arcis-internal-auth']
  // ARC-020: the request scheme decides whether a session cookie carries `Secure`, so the caller's
  // `x-forwarded-proto` is as spoofable as `x-forwarded-for` and is stripped the same way.
  delete headers['x-forwarded-proto']
  delete headers[INTERNAL_PROTOCOL_HEADER]

  headers['x-arcis-client-ip'] = clientIp
  headers['x-arcis-internal-auth'] = PROCESS_INTERNAL_AUTH_SECRET
  if (observedProtocol) {
    const protocol = normalizeProtocol(observedProtocol)
    if (protocol) headers[INTERNAL_PROTOCOL_HEADER] = protocol
  }
}

function normalizeProtocol(value: string | null | undefined): 'http' | 'https' | null {
  const protocol = String(value ?? '').trim().toLowerCase()
  return protocol === 'https' || protocol === 'http' ? protocol : null
}

function readEnv(name: string): string {
  const local = typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  const globalValue = (globalThis as any)?.process?.env?.[name]
  return String(local ?? globalValue ?? '').trim()
}

/**
 * The scheme this process actually served the request over, or null when no trusted source can
 * say. Trusted sources mirror the client-IP ones: the signed internal header written by the
 * Express/Vite adapters, or a sanitizing edge that overwrites `x-forwarded-proto` (Vercel).
 * A caller-supplied `x-forwarded-proto` on a directly reachable process is ignored.
 */
export function readTrustedProtocol(req: Request): 'http' | 'https' | null {
  const headers = req.headers
  const auth = headers.get('x-arcis-internal-auth')
  if (auth && auth === PROCESS_INTERNAL_AUTH_SECRET) {
    return normalizeProtocol(headers.get(INTERNAL_PROTOCOL_HEADER))
  }

  if (hasSanitizingEdge()) {
    // The edge appends/overwrites its own value; a caller-prepended entry is not the first one it
    // wrote, so only a single-value header is accepted.
    const forwarded = (headers.get('x-forwarded-proto') || '').split(',').map((part) => part.trim()).filter(Boolean)
    if (forwarded.length === 1) return normalizeProtocol(forwarded[0])
  }

  return null
}

/** True when the deployment sits behind an edge that rewrites forwarding headers. */
export function hasSanitizingEdge(): boolean {
  const vercel = readEnv('VERCEL')
  if (vercel === '1' || vercel.toLowerCase() === 'true') return true

  const flag = readEnv('TRUST_PROXY_HEADERS').toLowerCase()
  return flag === '1' || flag === 'true'
}

/**
 * How many trailing `x-forwarded-for` entries the sanitizing edge itself appended. 1 means the
 * rightmost entry is the peer address the edge observed; caller-prepended entries to its left are
 * ignored.
 */
export function trustedProxyHops(): number {
  const parsed = Number.parseInt(readEnv('TRUSTED_PROXY_HOPS') || '1', 10)
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 10 ? parsed : 1
}

/** Accepts only well-formed IP literals; returns null for caller-supplied text that is not an IP. */
function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null
  let candidate = value.trim()
  if (!candidate) return null

  if (candidate.startsWith('[') && candidate.includes(']')) {
    candidate = candidate.slice(1, candidate.indexOf(']'))
  }
  // A trailing ":port" is not part of an IPv4 literal; IPv6 contains colons natively.
  if (isIP(candidate) === 0 && candidate.includes(':')) {
    const withoutPort = candidate.split(':')[0]
    if (isIP(withoutPort) === 4) candidate = withoutPort
  }
  if (isIP(candidate) === 0) return null
  return candidate
}

export function extractTrustedClientIp(req: Request): string {
  const headers = req.headers
  const auth = headers.get('x-arcis-internal-auth')
  if (auth && auth === PROCESS_INTERNAL_AUTH_SECRET) {
    return normalizeIp(headers.get('x-arcis-client-ip')) || UNRESOLVED_CLIENT_IP
  }

  if (hasSanitizingEdge()) {
    const forwarded = headers.get('x-forwarded-for')
    if (forwarded) {
      const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean)
      const candidate = normalizeIp(hops[hops.length - trustedProxyHops()])
      if (candidate) return candidate
    }

    for (const header of EDGE_IP_HEADERS) {
      const candidate = normalizeIp(headers.get(header))
      if (candidate) return candidate
    }
  } else if (!warnedAboutUntrustedForwardingHeaders) {
    warnedAboutUntrustedForwardingHeaders = true
    console.warn(
      '[trustedIp] No signed internal IP and no sanitizing edge detected, so forwarding headers are ignored ' +
        'and all clients share the "' + UNRESOLVED_CLIENT_IP + '" rate-limit bucket. ' +
        'Set TRUST_PROXY_HEADERS=true only if a proxy in front of this process overwrites x-forwarded-for.'
    )
  }

  return UNRESOLVED_CLIENT_IP
}
