// api/_utils/boundedStore.ts
// Bounded in-process fallback stores — audit ARC-008.
//
// The durable Redis/KV path stays authoritative for replay protection and provider accounting.
// These in-memory structures only back it up when KV is unavailable, so they must never be able to
// grow with traffic: entries expire after a TTL and, once the entry budget is reached, the oldest
// writes are dropped first (Map preserves insertion order and every write re-inserts its key).
//
// Dropping an entry that has not expired yet is a defence-in-depth loss, not a correctness loss,
// because the durable nonce reservation already exists whenever a payment actually settles. It is
// reported through `onCapacityEviction` so an operator can see the budget is too small.

export interface BoundedStoreOptions {
  /** Label used in capacity warnings. */
  name: string
  /** Hard entry budget; the store never holds more than this. */
  maxEntries: number
  /** Lifetime of an entry, refreshed by every write. */
  ttlMs: number
  /** Called (at most once a minute) when an unexpired entry is dropped for capacity. */
  onCapacityEviction?: (name: string, evictedKey: string, size: number) => void
  /** Injectable clock, for tests. */
  now?: () => number
}

export interface BoundedTtlSet {
  has(key: string): boolean
  /** Returns false when the key was already present and still valid. */
  add(key: string): boolean
  delete(key: string): void
  size(): number
  clear(): void
}

export interface BoundedTtlMap<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  delete(key: string): void
  size(): number
  clear(): void
}

const CAPACITY_WARN_INTERVAL_MS = 60_000

function createCore<T>(options: BoundedStoreOptions) {
  const entries = new Map<string, { value: T; expiresAt: number }>()
  const now = options.now ?? (() => Date.now())
  let lastCapacityWarnAt = 0

  function purgeExpired(): void {
    const deadline = now()
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= deadline) entries.delete(key)
    }
  }

  /** Drops the oldest writes until the budget holds, warning at most once a minute. */
  function enforceBudget(): void {
    purgeExpired()
    const overflow = entries.size - options.maxEntries
    if (overflow <= 0) return

    let evictedKey = ''
    let dropped = 0
    for (const key of entries.keys()) {
      if (dropped >= overflow) break
      evictedKey = key
      entries.delete(key)
      dropped += 1
    }

    const timestamp = now()
    if (options.onCapacityEviction && timestamp - lastCapacityWarnAt >= CAPACITY_WARN_INTERVAL_MS) {
      lastCapacityWarnAt = timestamp
      options.onCapacityEviction(options.name, evictedKey, entries.size)
    }
  }

  function read(key: string): T | undefined {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= now()) {
      entries.delete(key)
      return undefined
    }
    return entry.value
  }

  function write(key: string, value: T): void {
    // Re-inserting moves the key to the end of the insertion order, so eviction stays oldest-first.
    entries.delete(key)
    entries.set(key, { value, expiresAt: now() + options.ttlMs })
    enforceBudget()
  }

  return { entries, read, write, purgeExpired }
}

export function createBoundedTtlSet(options: BoundedStoreOptions): BoundedTtlSet {
  const core = createCore<true>(options)

  return {
    has: (key) => core.read(key) === true,
    add: (key) => {
      if (core.read(key) === true) return false
      core.write(key, true)
      return true
    },
    delete: (key) => {
      core.entries.delete(key)
    },
    size: () => {
      core.purgeExpired()
      return core.entries.size
    },
    clear: () => {
      core.entries.clear()
    },
  }
}

export function createBoundedTtlMap<T>(options: BoundedStoreOptions): BoundedTtlMap<T> {
  const core = createCore<T>(options)

  return {
    get: (key) => core.read(key),
    set: (key, value) => {
      core.write(key, value)
    },
    delete: (key) => {
      core.entries.delete(key)
    },
    size: () => {
      core.purgeExpired()
      return core.entries.size
    },
    clear: () => {
      core.entries.clear()
    },
  }
}
