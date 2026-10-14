// api/_utils/ucwSession.ts
//
// Server-held Circle UCW session.
//
// The Circle `userToken` (and its `encryptionKey`) authorize signing challenges
// on a user's wallet. Keeping them in `localStorage` means any XSS on the origin
// can walk away with the wallet's signing authority. Instead the API issues an
// httpOnly, SameSite=Strict, HMAC-signed session cookie scoped to `/api/ucw`, and
// reads the token from that cookie. The client never has to store it.
//
// Design notes:
//
//   * Fail closed. Without a signing secret there is no way to tell a cookie we
//     minted from one an attacker crafted, so no session is issued or accepted.
//   * Signed *and* expiring. The MAC stops tampering; the `exp` claim inside the
//     signed payload stops a replayed cookie from outliving the session.
//   * Standard crypto only. The MAC is HMAC-SHA256 from `crypto.subtle` (Node 18+,
//     workers, browsers) — never a local implementation of SHA-256.
//   * Opaque to the browser. HttpOnly plus `Path=/api/ucw` means neither scripts
//     nor the app's other routes ever see the value.

export const UCW_SESSION_COOKIE = 'arcis_ucw_session'

const SESSION_PATH = '/api/ucw'
const DEFAULT_MAX_AGE_SECONDS = 60 * 60

export interface UcwSessionPayload {
  userToken: string
  encryptionKey?: string
  walletId?: string
  address?: string
  deviceToken?: string
  deviceEncryptionKey?: string
}

export interface UcwSessionOptions {
  secure: boolean
  maxAgeSeconds?: number
}

interface SignedSession extends UcwSessionPayload {
  /** Unix seconds. */
  exp: number
}

// ─────────────────────────────────────────────────────────────
// 1. SIGNING SECRET
// ─────────────────────────────────────────────────────────────
function readEnv(name: string): string {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const value = globalEnv[name] ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined)
  return typeof value === 'string' ? value.trim() : ''
}

/** Dedicated secret when configured, otherwise the API key the server already holds. */
function getSigningSecret(): string {
  return readEnv('UCW_SESSION_SECRET') || readEnv('CIRCLE_API_KEY')
}

// ─────────────────────────────────────────────────────────────
// 2. HMAC-SHA256 (Web Crypto)
// ─────────────────────────────────────────────────────────────
/**
 * SubtleCrypto is a global on every runtime this API runs on (Node 18+, Vercel
 * functions, workers). The `node:crypto` fallback exists only for an older Node
 * whose global is missing it, and is imported lazily so the module stays
 * bundler-friendly for edge runtimes.
 */
async function getSubtle(): Promise<SubtleCrypto> {
  const globalSubtle = (globalThis as any)?.crypto?.subtle
  if (globalSubtle) return globalSubtle as SubtleCrypto
  const nodeCrypto = await import('node:crypto')
  return (nodeCrypto.webcrypto as Crypto).subtle
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const subtle = await getSubtle()
  const key = await subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return new Uint8Array(signature)
}

// ─────────────────────────────────────────────────────────────
// 3. ENCODING HELPERS
// ─────────────────────────────────────────────────────────────
/** base64url without padding, from bytes. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url back to bytes; null for anything that is not valid base64url. */
function base64UrlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    '='
  )
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function encodeBase64UrlText(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value))
}

function decodeBase64UrlText(value: string): string | null {
  const bytes = base64UrlDecode(value)
  return bytes ? new TextDecoder().decode(bytes) : null
}

/** Length-independent comparison: never short-circuits on the first mismatch. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Only the volatile string fields this session is allowed to carry. */
function sanitizeToken(value: any, maxLen = 1024): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLen)
}

// ─────────────────────────────────────────────────────────────
// 4. COOKIE BUILD / READ
// ─────────────────────────────────────────────────────────────
function cookieAttributes(options: UcwSessionOptions, maxAgeSeconds: number): string {
  const parts = [
    `Path=${SESSION_PATH}`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Builds the `Set-Cookie` value for a UCW session.
 *
 * Throws when no signing secret is configured: an unsigned credential cookie
 * would be forgeable, so the caller must fail the login instead of issuing one.
 */
export async function buildUcwSessionCookie(
  payload: UcwSessionPayload,
  options: UcwSessionOptions
): Promise<string> {
  const secret = getSigningSecret()
  if (!secret) {
    throw new Error('UCW session signing secret is not configured (UCW_SESSION_SECRET or CIRCLE_API_KEY).')
  }

  const maxAgeSeconds = Math.max(1, Math.floor(options.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS))
  const signed: SignedSession = {
    userToken: sanitizeToken(payload.userToken),
    ...(sanitizeToken(payload.encryptionKey) ? { encryptionKey: sanitizeToken(payload.encryptionKey) } : {}),
    ...(sanitizeToken(payload.walletId, 128) ? { walletId: sanitizeToken(payload.walletId, 128) } : {}),
    ...(sanitizeToken(payload.address, 128) ? { address: sanitizeToken(payload.address, 128) } : {}),
    ...(sanitizeToken(payload.deviceToken) ? { deviceToken: sanitizeToken(payload.deviceToken) } : {}),
    ...(sanitizeToken(payload.deviceEncryptionKey)
      ? { deviceEncryptionKey: sanitizeToken(payload.deviceEncryptionKey) }
      : {}),
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  }

  const encoded = encodeBase64UrlText(JSON.stringify(signed))
  const mac = base64UrlEncode(await hmacSha256(secret, encoded))
  return `${UCW_SESSION_COOKIE}=${encoded}.${mac}; ${cookieAttributes(options, maxAgeSeconds)}`
}

/** Builds the `Set-Cookie` value that removes the session. */
export function buildClearUcwSessionCookie(options: Pick<UcwSessionOptions, 'secure'>): string {
  return `${UCW_SESSION_COOKIE}=; ${cookieAttributes({ secure: options.secure }, 0)}`
}

function readCookieHeader(req: Request, name: string): string {
  const header = req.headers?.get?.('cookie') || ''
  if (!header) return ''
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    const rawValue = part.slice(separator + 1).trim()
    // Base64url needs no escaping, but tolerate a client that percent-encoded it.
    try {
      return rawValue.includes('%') ? decodeURIComponent(rawValue) : rawValue
    } catch {
      return rawValue
    }
  }
  return ''
}

/**
 * Reads and verifies the UCW session cookie.
 *
 * Returns null — never throws — for a missing, malformed, tampered, unsigned or
 * expired cookie, so callers can treat "no session" as the single failure mode.
 */
export async function readUcwSession(req: Request): Promise<UcwSessionPayload | null> {
  try {
    const secret = getSigningSecret()
    if (!secret) return null

    const cookieValue = readCookieHeader(req, UCW_SESSION_COOKIE)
    if (!cookieValue) return null

    const separator = cookieValue.lastIndexOf('.')
    if (separator <= 0) return null
    const encoded = cookieValue.slice(0, separator)
    const providedMac = cookieValue.slice(separator + 1)
    if (!encoded || !providedMac) return null

    const expectedMac = base64UrlEncode(await hmacSha256(secret, encoded))
    if (!constantTimeEqual(providedMac, expectedMac)) return null

    const json = decodeBase64UrlText(encoded)
    if (json === null) return null
    const parsed = JSON.parse(json) as SignedSession

    const userToken = sanitizeToken(parsed?.userToken)
    if (!userToken) return null
    if (typeof parsed?.exp !== 'number' || !Number.isFinite(parsed.exp)) return null
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null

    const session: UcwSessionPayload = { userToken }
    const encryptionKey = sanitizeToken(parsed.encryptionKey)
    const walletId = sanitizeToken(parsed.walletId, 128)
    const address = sanitizeToken(parsed.address, 128)
    const deviceToken = sanitizeToken(parsed.deviceToken)
    const deviceEncryptionKey = sanitizeToken(parsed.deviceEncryptionKey)
    if (encryptionKey) session.encryptionKey = encryptionKey
    if (walletId) session.walletId = walletId
    if (address) session.address = address
    if (deviceToken) session.deviceToken = deviceToken
    if (deviceEncryptionKey) session.deviceEncryptionKey = deviceEncryptionKey
    return session
  } catch {
    return null
  }
}

/**
 * The Circle user token for a request: the session cookie first, then a
 * body-supplied token while clients migrate off sending one. Empty string when
 * neither is present — callers keep their existing "userToken is required" error.
 */
export async function resolveUcwUserToken(req: Request, body: any): Promise<string> {
  const session = await readUcwSession(req)
  if (session?.userToken) return session.userToken
  return sanitizeToken(body?.userToken)
}

/** True when the request reached the server over HTTPS (so `Secure` applies). */
export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers?.get?.('x-forwarded-proto') || ''
  const proto = forwarded.split(',')[0].trim().toLowerCase()
  if (proto) return proto === 'https'
  try {
    return new URL(req.url).protocol === 'https:'
  } catch {
    return false
  }
}
