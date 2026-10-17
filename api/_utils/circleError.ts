// api/_utils/circleError.ts
// ARC-022: Circle's error bodies are provider responses, not ours to log.
//
// A failed UCW/OAuth call can carry the account e-mail, the `userToken` (a bearer credential that
// authorizes signing challenges) and device tokens. Writing that body to the server log — and
// then to whatever log sink the deployment forwards to — turns an operational log into a PII and
// credential store. Callers log `circleErrorForLog(error)` instead: it keeps the diagnostic fields
// (`code`, HTTP status, scrubbed message) and drops or masks everything else.
//
// This module is deliberately dependency-free so API routes can import it without pulling in the
// browser services.

/** Field names that must never reach a log line. Compared lower-cased. */
const SENSITIVE_KEYS = new Set([
  'usertoken',
  'encryptionkey',
  'deviceencryptionkey',
  'devicetoken',
  'devicetokenid',
  'otptoken',
  'email',
  'emailaddress',
  'e-mail',
  'authorization',
  'apikey',
  'api_key',
  'pin',
  'pinhash',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'privatekey',
  'private_key',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'idempotencykey',
  'sessiontoken',
])

/** E-mail addresses are PII wherever they appear, including inside a provider message. */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

const REDACTED = '[REDACTED]'
const MAX_STRING_LENGTH = 300
const MAX_DEPTH = 4
const MAX_ARRAY_ITEMS = 10

function redactString(value: string): string {
  const scrubbed = value.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
  return scrubbed.length > MAX_STRING_LENGTH ? `${scrubbed.slice(0, MAX_STRING_LENGTH)}…[truncated]` : scrubbed
}

/**
 * Deep copy of a provider payload with credentials/PII masked, bounded in depth and breadth so a
 * pathological response cannot flood the log either.
 */
export function redactCircleErrorPayload(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object') return String(value)
  if (depth >= MAX_DEPTH) return '[DEPTH_LIMIT]'

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactCircleErrorPayload(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`)
    return items
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // Field *names* stay visible (they are what makes the log useful); their values do not.
    redacted[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? REDACTED
      : redactCircleErrorPayload(entry, depth + 1)
  }
  return redacted
}

export interface CircleErrorLogEntry {
  /** Provider/transport error code, e.g. Circle's 155106. */
  code?: string | number
  /** HTTP status of the provider response, when there was one. */
  status?: number
  /** Scrubbed provider message, or the thrown message. */
  message: string
  /** Redacted provider body, when the SDK attached one. */
  responseData?: unknown
}

/**
 * The log-safe shape of a failed Circle call. Never returns the raw error object: Node's console
 * inspects own enumerable properties, so passing `err` straight in would print `response.data`.
 */
export function circleErrorForLog(error: any): CircleErrorLogEntry {
  const response = error?.response
  const data = response?.data
  const entry: CircleErrorLogEntry = {
    message: redactString(String(data?.message || error?.message || error || 'Unknown Circle error')),
  }

  const code = data?.code ?? error?.code
  if (typeof code === 'string' || typeof code === 'number') entry.code = code

  const status = response?.status ?? response?.statusCode
  if (typeof status === 'number') entry.status = status

  if (data !== undefined) entry.responseData = redactCircleErrorPayload(data)

  return entry
}
