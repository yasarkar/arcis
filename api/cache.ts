// api/cache.ts
//
// Redis cache layer with TTL support for Arcis Pool & Position states.
// Connects to Vercel KV / Upstash Redis with a graceful in-memory TTL fallback.

import { apiSuccess, apiError, safeJsonParse } from './_utils/apiResponse'
import {
  kvGet,
  kvSet,
  kvDel,
  kvTtl,
  getStorageDriver,
} from './_utils/redisStorage'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return apiError('Query parameter "key" is required.', 'MISSING_QUERY_PARAM', 400)
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

export async function POST(req: Request) {
  const jsonResult = await safeJsonParse(req)
  if (!jsonResult.success) {
    return apiError(
      jsonResult.error || 'Invalid or malformed JSON payload in request body.',
      'INVALID_JSON',
      400
    )
  }

  const body = jsonResult.data || {}
  const { key, value, ttlSeconds = 30 } = body

  if (!key || value === undefined) {
    return apiError('"key" and "value" are required.', 'MISSING_PARAMETERS', 400)
  }

  try {
    const ttl = Number(ttlSeconds) || 30
    const strVal = typeof value === 'string' ? value : JSON.stringify(value)
    await kvSet(key, strVal, ttl)

    return apiSuccess({
      key,
      ttlSeconds: ttl,
      source: getStorageDriver(),
    })
  } catch (error: any) {
    return apiError(error.message || 'Internal server error in Cache save', 'CACHE_POST_ERROR', 500)
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return apiError('Query parameter "key" is required.', 'MISSING_QUERY_PARAM', 400)
  }

  try {
    await kvDel(key)
    return apiSuccess({ key, message: 'Deleted' })
  } catch (error: any) {
    return apiError(error.message || 'Internal server error in Cache delete', 'CACHE_DELETE_ERROR', 500)
  }
}
