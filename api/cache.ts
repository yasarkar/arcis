// api/cache.ts
//
// Redis cache layer with TTL support for Arcis Pool & Position states.
// Connects to Vercel KV / Upstash Redis with a graceful in-memory TTL fallback.

import { apiSuccess, apiError } from './_utils/apiResponse'
import {
  kvGet,
  kvTtl,
  getStorageDriver,
} from './_utils/redisStorage'

// Security (SEC-01): Allowlist of read-only public cache keys.
// Sensitive financial state, provider ledgers, locks, and history cannot be read through public cache.
const ALLOWED_PUBLIC_CACHE_KEYS = new Set([
  'arcis:token_prices:v1',
  'arcis:pools:state',
])

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return apiError('Query parameter "key" is required.', 'MISSING_QUERY_PARAM', 400)
  }

  // Security (SEC-01): Enforce public key allowlist
  if (!ALLOWED_PUBLIC_CACHE_KEYS.has(key)) {
    return apiError('Cache key is not public.', 'FORBIDDEN', 403)
  }

  try {
    const raw = await kvGet(key)
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw)
        const ttlRemainingSeconds = await kvTtl(key)
        return apiSuccess({
          hit: true,
          source: getStorageDriver(),
          key,
          data: parsed,
          ttlRemainingSeconds: ttlRemainingSeconds > 0 ? ttlRemainingSeconds : 0,
        })
      } catch {
        // Plain string value
        const ttlRemainingSeconds = await kvTtl(key)
        return apiSuccess({
          hit: true,
          source: getStorageDriver(),
          key,
          data: raw,
          ttlRemainingSeconds: ttlRemainingSeconds > 0 ? ttlRemainingSeconds : 0,
        })
      }
    }

    return apiSuccess({
      hit: false,
      key,
      data: null,
      ttlRemainingSeconds: 0,
    })
  } catch (error: any) {
    return apiError(error.message || 'Internal server error in Cache query', 'CACHE_GET_ERROR', 500)
  }
}

export async function POST(_req: Request) {
  // Security (SEC-01): Disable public cache writes to prevent arbitrary key overwrite/poisoning
  return apiError('Public cache writes are disabled.', 'FORBIDDEN', 403)
}

export async function DELETE(_req: Request) {
  // Security (SEC-01): Disable public cache deletion to prevent arbitrary key erasure
  return apiError('Public cache deletion is disabled.', 'FORBIDDEN', 403)
}
