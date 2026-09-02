// api/rateLimiter.ts
// Distributed Rate-Limiting & Quota Management Engine
// Connects to Redis (via REDIS_URL) with seamless In-Memory sliding-window fallback

interface RateLimitMemoryEntry {
  count: number
  firstRequestTime: number
}

interface QuotaMemoryEntry {
  count: number
  expiresAt: number
}

let redisClient: any = null
let redisAvailable = false
let connectionAttempted = false

const memoryRateLimitStore = new Map<string, RateLimitMemoryEntry>()
const memoryQuotaStore = new Map<string, QuotaMemoryEntry>()

export async function getRedisInstance() {
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
      retryStrategy: () => null, // Don't hang if Redis is offline
    })

    redisClient.on('error', () => {
      redisAvailable = false
    })

    await redisClient.connect().catch(() => {
      redisAvailable = false
    })

    redisAvailable = redisClient.status === 'ready' || redisClient.status === 'connect'
    if (redisAvailable) {
      console.log('[RateLimiter] ✓ Connected to Redis at', redisUrl)
    } else {
      console.log('[RateLimiter] ℹ Redis not reachable, using in-memory fallback')
    }
  } catch (err) {
    redisAvailable = false
  }

  return redisAvailable ? redisClient : null
}

export function isRedisConnected(): boolean {
  return redisAvailable
}

/**
 * Checks and increments rate limit for a given key within a sliding/fixed time window.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const windowSec = Math.ceil(windowMs / 1000)

  // 1. Try Redis Atomic Rate Limiting
  const client = await getRedisInstance()
  if (client && redisAvailable) {
    try {
      const redisKey = `ratelimit:${key}`
      const current = await client.incr(redisKey)

      if (current === 1) {
        await client.expire(redisKey, windowSec)
      }

      const ttl = await client.ttl(redisKey)
      const retryAfterSeconds = ttl > 0 ? ttl : windowSec

      if (current > maxRequests) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds,
        }
      }

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - current),
        retryAfterSeconds: 0,
      }
    } catch (redisErr) {
      console.warn('[RateLimiter] Redis error, falling back to memory:', redisErr)
    }
  }

  // 2. In-Memory Sliding Window Fallback
  const now = Date.now()
  const entry = memoryRateLimitStore.get(key)

  // Periodic cleanup if store grows large
  if (memoryRateLimitStore.size > 2000) {
    for (const [k, v] of memoryRateLimitStore.entries()) {
      if (now - v.firstRequestTime > windowMs * 2) {
        memoryRateLimitStore.delete(k)
      }
    }
  }

  if (!entry || now - entry.firstRequestTime > windowMs) {
    memoryRateLimitStore.set(key, { count: 1, firstRequestTime: now })
    return { allowed: true, remaining: maxRequests - 1, retryAfterSeconds: 0 }
  }

  if (entry.count < maxRequests) {
    entry.count++
    return { allowed: true, remaining: maxRequests - entry.count, retryAfterSeconds: 0 }
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((entry.firstRequestTime + windowMs - now) / 1000))
  return { allowed: false, remaining: 0, retryAfterSeconds }
}

/**
 * Computes the key for today's UTC daily gasless quota.
 */
function getTodayUtcDateStr(): string {
  return new Date().toISOString().split('T')[0]
}

function getEndOfDayUtcTimestamp(): number {
  const endOfDay = new Date()
  endOfDay.setUTCHours(23, 59, 59, 999)
  return endOfDay.getTime()
}

/**
 * Gets daily free Gasless USDC transfer quota for a wallet address.
 */
export async function getGaslessDailyQuota(
  address: string,
  limit = 5
): Promise<{ count: number; remaining: number; limit: number }> {
  const normalizedAddr = address.toLowerCase().trim()
  const dateStr = getTodayUtcDateStr()
  const quotaKey = `gasless:${normalizedAddr}:${dateStr}`

  // 1. Try Redis
  const client = await getRedisInstance()
  if (client && redisAvailable) {
    try {
      const raw = await client.get(quotaKey)
      const count = raw ? parseInt(raw, 10) || 0 : 0
      const remaining = Math.max(0, limit - count)
      return { count, remaining, limit }
    } catch (e) {
      console.warn('[RateLimiter] Redis quota fetch error, falling back to memory:', e)
    }
  }

  // 2. In-Memory Fallback
  const now = Date.now()
  const entry = memoryQuotaStore.get(quotaKey)

  if (!entry || entry.expiresAt <= now) {
    return { count: 0, remaining: limit, limit }
  }

  const count = entry.count
  const remaining = Math.max(0, limit - count)
  return { count, remaining, limit }
}

/**
 * Atomically increments the daily Gasless USDC transfer quota for a wallet address.
 */
export async function incrementGaslessDailyQuota(address: string, limit = 5): Promise<number> {
  const normalizedAddr = address.toLowerCase().trim()
  const dateStr = getTodayUtcDateStr()
  const quotaKey = `gasless:${normalizedAddr}:${dateStr}`
  const now = Date.now()
  const expiresAt = getEndOfDayUtcTimestamp()
  const ttlSeconds = Math.max(60, Math.ceil((expiresAt - now) / 1000))

  // 1. Try Redis
  const client = await getRedisInstance()
  if (client && redisAvailable) {
    try {
      const newCount = await client.incr(quotaKey)
      if (newCount === 1) {
        await client.expire(quotaKey, ttlSeconds)
      }
      return Math.max(0, limit - newCount)
    } catch (e) {
      console.warn('[RateLimiter] Redis quota increment error, using memory fallback:', e)
    }
  }

  // 2. In-Memory Fallback
  const entry = memoryQuotaStore.get(quotaKey)
  let count = 1
  if (entry && entry.expiresAt > now) {
    count = entry.count + 1
  }

  memoryQuotaStore.set(quotaKey, { count, expiresAt })
  return Math.max(0, limit - count)
}
