// api/utils/redisStorage.ts
//
// Unified, serverless-optimized KV & Redis storage abstraction for Arcis Protocol.
// Supports:
// 1. Upstash REST API (Vercel KV native, HTTP-based, 0-latency connection reuse, no TCP socket limits)
// 2. ioredis TCP/TLS (via REDIS_URL or KV_URL rediss://)
// 3. Graceful in-memory fallback for offline/isolated execution

function getEnv(key: string): string {
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const val = localEnv[key] || globalEnv[key] || ''
  // Strip enclosing quotes if present in .env
  return val.replace(/^["']|["']$/g, '').trim()
}

// In-memory fallback map for offline resilience
const memoryStore = new Map<string, { value: string; expiresAt?: number }>()
const memoryCounters = new Map<string, { count: number; expiresAt: number }>()

let ioredisClient: any = null
let ioredisAttempted = false
let ioredisAvailable = false

function getRestConfig() {
  const url = getEnv('KV_REST_API_URL')
  const token = getEnv('KV_REST_API_TOKEN')
  if (url && token) {
    return { url, token }
  }
  return null
}

async function execRest(command: any[]): Promise<any> {
  const conf = getRestConfig()
  if (!conf) return null

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 4500)

  try {
    const res = await fetch(conf.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conf.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      throw new Error(`Upstash REST returned ${res.status}`)
    }
    const data = await res.json()
    return data.result
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

async function getIoredisClient(): Promise<any> {
  if (ioredisAttempted) {
    return ioredisAvailable ? ioredisClient : null
  }
  ioredisAttempted = true

  const redisUrl = getEnv('REDIS_URL') || getEnv('KV_URL') || 'redis://127.0.0.1:6379'
  try {
    const { default: Redis } = await import('ioredis')
    ioredisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 4000,
      lazyConnect: true,
      retryStrategy: () => null,
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    })

    ioredisClient.on('error', () => {
      ioredisAvailable = false
    })

    await ioredisClient.connect().catch(() => {
      ioredisAvailable = false
    })

    ioredisAvailable = ioredisClient.status === 'ready' || ioredisClient.status === 'connect'
    return ioredisAvailable ? ioredisClient : null
  } catch {
    ioredisAvailable = false
    return null
  }
}

/**
 * Get a string value from storage.
 */
export async function kvGet(key: string): Promise<string | null> {
  // 1. Try Upstash REST (best for Vercel Serverless)
  if (getRestConfig()) {
    try {
      const res = await execRest(['GET', key])
      if (res !== null && res !== undefined) {
        return typeof res === 'string' ? res : JSON.stringify(res)
      }
      return null
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST GET failed for "${key}", falling back:`, err)
    }
  }

  // 2. Try ioredis TCP/TLS
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const val = await client.get(key)
      return val ?? null
    }
  } catch (err) {
    console.warn(`[redisStorage] ioredis GET failed for "${key}":`, err)
  }

  // 3. In-memory fallback
  const item = memoryStore.get(key)
  if (!item) return null
  if (item.expiresAt && item.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return item.value
}

/**
 * Set a string value in storage with optional TTL in seconds.
 */
export async function kvSet(key: string, value: string, exSeconds?: number): Promise<boolean> {
  let saved = false

  // 1. Try Upstash REST
  if (getRestConfig()) {
    try {
      const cmd = exSeconds && exSeconds > 0
        ? ['SET', key, value, 'EX', exSeconds]
        : ['SET', key, value]
      const res = await execRest(cmd)
      if (res === 'OK') {
        saved = true
      }
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST SET failed for "${key}":`, err)
    }
  }

  // 2. Try ioredis TCP/TLS if not saved
  if (!saved) {
    try {
      const client = await getIoredisClient()
      if (client && ioredisAvailable) {
        if (exSeconds && exSeconds > 0) {
          await client.setex(key, exSeconds, value)
        } else {
          await client.set(key, value)
        }
        saved = true
      }
    } catch (err) {
      console.warn(`[redisStorage] ioredis SET failed for "${key}":`, err)
    }
  }

  // 3. Always mirror to in-memory store for resilience
  const expiresAt = exSeconds && exSeconds > 0 ? Date.now() + exSeconds * 1000 : undefined
  memoryStore.set(key, { value, expiresAt })

  return saved
}

/**
 * Delete a key from storage.
 */
export async function kvDel(key: string): Promise<boolean> {
  let deleted = false

  if (getRestConfig()) {
    try {
      await execRest(['DEL', key])
      deleted = true
    } catch {}
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      await client.del(key)
      deleted = true
    }
  } catch {}

  memoryStore.delete(key)
  return deleted
}

/**
 * Get remaining TTL for a key in seconds (-1 if no expiry, -2 if not found).
 */
export async function kvTtl(key: string): Promise<number> {
  if (getRestConfig()) {
    try {
      const res = await execRest(['TTL', key])
      return typeof res === 'number' ? res : -1
    } catch {}
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const ttl = await client.ttl(key)
      return ttl
    }
  } catch {}

  const item = memoryStore.get(key)
  if (!item) return -2
  if (!item.expiresAt) return -1
  const remaining = Math.max(0, Math.round((item.expiresAt - Date.now()) / 1000))
  return remaining
}

/**
 * Atomic increment for rate-limiting.
 */
export async function kvIncr(
  key: string,
  expireSeconds = 60
): Promise<{ current: number; ttl: number }> {
  if (getRestConfig()) {
    try {
      const current = await execRest(['INCR', key])
      if (current === 1 && expireSeconds > 0) {
        await execRest(['EXPIRE', key, expireSeconds])
      }
      const ttl = await execRest(['TTL', key])
      return {
        current: Number(current) || 1,
        ttl: typeof ttl === 'number' && ttl > 0 ? ttl : expireSeconds,
      }
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST INCR failed for "${key}":`, err)
    }
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const current = await client.incr(key)
      if (current === 1 && expireSeconds > 0) {
        await client.expire(key, expireSeconds)
      }
      const ttl = await client.ttl(key)
      return {
        current: Number(current) || 1,
        ttl: ttl > 0 ? ttl : expireSeconds,
      }
    }
  } catch {}

  // In-memory fallback
  const now = Date.now()
  let entry = memoryCounters.get(key)
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 1, expiresAt: now + expireSeconds * 1000 }
    memoryCounters.set(key, entry)
    return { current: 1, ttl: expireSeconds }
  }

  entry.count += 1
  const ttl = Math.max(1, Math.round((entry.expiresAt - now) / 1000))
  return { current: entry.count, ttl }
}

/**
 * Check whether a live remote storage (Upstash REST or ioredis) is available.
 */
export async function isStorageAvailable(): Promise<boolean> {
  if (getRestConfig()) {
    try {
      const pong = await execRest(['PING'])
      if (pong === 'PONG') return true
    } catch {}
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      return true
    }
  } catch {}

  return false
}

export function getStorageDriver(): 'upstash-rest' | 'ioredis' | 'memory' {
  if (getRestConfig()) return 'upstash-rest'
  if (ioredisAvailable) return 'ioredis'
  return 'memory'
}
