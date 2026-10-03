// api/_utils/trustedIp.ts
// Internal in-process authentication for client IP resolution.
// Prevents untrusted callers from forging 'x-arcis-client-ip' or other forwarding headers.

const PROCESS_INTERNAL_AUTH_SECRET = (
  globalThis as any
).__arcis_internal_auth_secret || ((globalThis as any).__arcis_internal_auth_secret = Math.random().toString(36).slice(2) + Date.now().toString(36))

export function signInternalClientIpHeaders(headers: Record<string, string>, clientIp: string) {
  // Strip untrusted / spoofable incoming headers
  delete headers['x-forwarded-for']
  delete headers['cf-connecting-ip']
  delete headers['true-client-ip']
  delete headers['x-real-ip']
  delete headers['x-arcis-client-ip']
  delete headers['x-arcis-internal-auth']

  headers['x-arcis-client-ip'] = clientIp
  headers['x-arcis-internal-auth'] = PROCESS_INTERNAL_AUTH_SECRET
}

export function extractTrustedClientIp(req: Request): string {
  const headers = req.headers
  const auth = headers.get('x-arcis-internal-auth')
  if (auth && auth === PROCESS_INTERNAL_AUTH_SECRET) {
    const internalIp = headers.get('x-arcis-client-ip')
    if (internalIp && internalIp.trim()) {
      return internalIp.trim()
    }
  }

  // Caller is direct or running in serverless environment without adapter signing.
  // Never trust caller-supplied 'x-arcis-client-ip' without internal signature!
  // Fall back to standard reverse-proxy headers:
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('true-client-ip') ||
    '127.0.0.1'
  )
}
