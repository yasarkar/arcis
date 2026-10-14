// Redis cache service for Arcis frontend with 30-second TTL.
// Stores and retrieves on-chain pool states, user positions, and balances.
// Integrates with /api/cache (Redis backend with in-memory TTL fallback).

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

// Keys that are publicly readable from /api/cache backend (SEC-01)
const ALLOWED_BACKEND_READ_KEYS = new Set([
  'arcis:token_prices:v1',
  'arcis:pools:state',
])

class RedisCacheService {
  private localMemory = new Map<string, CacheEntry<any>>()

  /**
   * Retrieves an item from Redis / cache by key.
   * Returns null if expired or not found.
   */
  async get<T>(key: string): Promise<T | null> {
    const now = Date.now()

    // 1. Fast local client cache check
    const local = this.localMemory.get(key)
    if (local && local.expiresAt > now) {
      return local.value as T
    }

    // 2. Fetch from backend Redis API only for allowed public keys
    if (ALLOWED_BACKEND_READ_KEYS.has(key)) {
      try {
        const res = await fetch(`/api/cache?key=${encodeURIComponent(key)}`)
        if (res.ok) {
          const json = await res.json()
          if (json.success && json.hit && json.data !== null && json.data !== undefined) {
            const ttlRemaining = (json.ttlRemainingSeconds || 30) * 1000
            this.localMemory.set(key, {
              value: json.data,
              expiresAt: now + ttlRemaining,
            })
            return json.data as T
          }
        }
      } catch (err) {
        // Non-blocking fallback
        console.warn(`[RedisCache] Backend fetch failed for key "${key}", checking local:`, err)
      }
    }

    return null
  }

  /**
   * Stores an item in local memory cache with a specified TTL in seconds (default: 30s).
   * Note: Client-side writes to /api/cache are disabled on the backend for security (SEC-01).
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 30): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000

    // Store in local memory cache
    this.localMemory.set(key, { value, expiresAt })
  }

  /**
   * Deletes an item from local memory cache.
   * Note: Client-side deletion on /api/cache is disabled on the backend for security (SEC-01).
   */
  async del(key: string): Promise<void> {
    this.localMemory.delete(key)
  }
}

export const redisCache = new RedisCacheService()
