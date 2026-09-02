// src/services/redisCacheService.ts
//
// Redis cache service for ArcFlow frontend with 30-second TTL.
// Stores and retrieves on-chain pool states, user positions, and balances.
// Integrates with /api/cache (Redis backend with in-memory TTL fallback).

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

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

    // 2. Fetch from backend Redis API
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

    return null
  }

  /**
   * Stores an item in Redis with a specified TTL in seconds (default: 30s).
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 30): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000

    // 1. Immediately store in local memory cache
    this.localMemory.set(key, { value, expiresAt })

    // 2. Persist to Redis backend asynchronously
    try {
      await fetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, ttlSeconds }),
      })
    } catch (err) {
      console.warn(`[RedisCache] Backend save failed for key "${key}":`, err)
    }
  }

  /**
   * Deletes an item from Redis and local cache.
   */
  async del(key: string): Promise<void> {
    this.localMemory.delete(key)
    try {
      await fetch(`/api/cache?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      })
    } catch (err) {
      console.warn(`[RedisCache] Backend delete failed for key "${key}":`, err)
    }
  }
}

export const redisCache = new RedisCacheService()
