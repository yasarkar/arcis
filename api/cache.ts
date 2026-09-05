// api/cache.ts
//
// Redis cache layer with 30s TTL support for Arcis Pool & Position states.
// Connects to Redis (via REDIS_URL or local redis://127.0.0.1:6379)
// with a graceful in-memory TTL fallback if Redis server is not currently running.

import { apiSuccess, apiError, safeJsonParse } from './utils/apiResponse'

let redisClient: any = null
let redisAvailable = false
let connectionAttempted = false

// In-memory fallback map: key -> { value: any, expiresAt: number }
const memoryCache = new Map<string, { value: any; expiresAt: number }>()

async function getRedisClient() {
  if (connectionAttempted) {
    return redisAvailable ? redisClient : null
  }
  connectionAttempted = true

  try {
    const { default: Redis } = await import('ioredis')
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
    
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      retryStrategy: () => null, // Don't hang indefinitely if Redis is down
    })

    redisClient.on('error', (err: any) => {
      // Gracefully handle connection error without crashing the server
      redisAvailable = false
    })

    await redisClient.connect().catch(() => {
      redisAvailable = false
    })

    redisAvailable = redisClient.status === 'ready' || redisClient.status === 'connect'
    if (redisAvailable) {
      console.log('[Redis API] Connected to Redis at', redisUrl)
    } else {
      console.log('[Redis API] Redis not reachable, using in-memory TTL fallback')
    }
  } catch (e) {
    redisAvailable = false
    console.log('[Redis API] ioredis load or connect error, using in-memory TTL fallback')
  }

  return redisAvailable ? redisClient : null
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key')

  if (!key) {
    return apiError('Query parameter "key" is required.', 'MISSING_QUERY_PARAM', 400)
  }

  try {
    const client = await getRedisClient()

    if (client && redisAvailable) {
      try {
        const raw = await client.get(key)
        const ttl = await client.ttl(key)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          return apiSuccess({
            hit: true,
            source: 'redis',
            key,
            data: parsed,
            ttlRemainingSeconds: ttl > 0 ? ttl : 0,
          })
        }
      } catch (err) {
        console.warn('[Redis API] Redis GET failed, checking in-memory cache:', err)
      }
    }

    // In-memory fallback check
    const memItem = memoryCache.get(key)
    const now = Date.now()
    if (memItem && memItem.expiresAt > now) {
      const ttlRemainingSeconds = Math.max(0, Math.round((memItem.expiresAt - now) / 1000))
      return apiSuccess({
        hit: true,
        source: 'memory-fallback',
        key,
        data: memItem.value,
        ttlRemainingSeconds,
      })
    } else if (memItem) {
      memoryCache.delete(key)
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
    const client = await getRedisClient()

    // 1. Store in Redis if available
    let savedToRedis = false
    if (client && redisAvailable) {
      try {
        await client.setex(key, ttl, JSON.stringify(value))
        savedToRedis = true
      } catch (err) {
        console.warn('[Redis API] Redis SETEX failed, saving to in-memory fallback:', err)
      }
    }

    // 2. Always store in in-memory fallback for resilience
    const expiresAt = Date.now() + ttl * 1000
    memoryCache.set(key, { value, expiresAt })

    return apiSuccess({
      key,
      ttlSeconds: ttl,
      source: savedToRedis ? 'redis' : 'memory-fallback',
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
    const client = await getRedisClient()
    if (client && redisAvailable) {
      try {
        await client.del(key)
      } catch {}
    }
    memoryCache.delete(key)
    return apiSuccess({ key, message: 'Deleted' })
  } catch (error: any) {
    return apiError(error.message || 'Internal server error in Cache delete', 'CACHE_DELETE_ERROR', 500)
  }
}
