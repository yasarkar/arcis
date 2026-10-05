// src/services/optimisticGatewayTracker.ts
// Client-side optimistic delta engine for Circle Gateway & Arcis Pools.
// Bridges the 20-30s off-chain indexing lag of Circle Gateway REST API (/v1/balances)
// so user deposits & withdrawals reflect INSTANTLY in the UI.

interface OptimisticDelta {
  walletAddress: string
  poolId: string
  delta: number // Positive for deposit, negative for withdraw
  baselineRaw: number
  timestamp: number
  expiresAt: number
  /** Chain the pending action originated from; drives honest per-chain "pending" attribution. */
  chainKey?: string
}

/** An unexpired, not-yet-indexed delta as exposed to attribution consumers. */
export interface ActiveOptimisticDelta {
  chainKey?: string
  delta: number
  baselineRaw: number
  expiresAt: number
}

const STORAGE_KEY = 'arcis:optimistic:deltas:v1'
const DEFAULT_TTL_MS = 45_000 // 45 seconds TTL (exceeds Circle's ~25s indexer delay)

function getStoredDeltas(): OptimisticDelta[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: OptimisticDelta[] = JSON.parse(raw)
    const now = Date.now()
    // Filter out expired
    return parsed.filter((d) => d && d.expiresAt > now)
  } catch {
    return []
  }
}

function saveStoredDeltas(deltas: OptimisticDelta[]) {
  if (typeof window === 'undefined') return
  try {
    const now = Date.now()
    const active = deltas.filter((d) => d && d.expiresAt > now)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(active))
  } catch {
    // Ignore storage quota
  }
}

export interface RecordOptimisticDeltaOptions {
  /** Defaults to 'gateway-settlement-pool'. */
  poolId?: string
  /** Chain the action originated from, used for per-chain pending attribution. */
  chainKey?: string
}

/**
 * Records an optimistic balance change for a specific wallet and pool.
 * @param walletAddress The user's wallet address
 * @param delta Number of tokens (+ for deposit, - for withdraw)
 * @param baselineRaw Current raw balance before the action
 * @param options Optional pool id and originating chain key
 */
export function recordOptimisticDelta(
  walletAddress: string,
  delta: number,
  baselineRaw = 0,
  options: RecordOptimisticDeltaOptions = {}
) {
  const { poolId = 'gateway-settlement-pool', chainKey } = options
  if (!walletAddress || isNaN(delta) || delta === 0) return
  const normalized = walletAddress.toLowerCase()
  const deltas = getStoredDeltas()
  const now = Date.now()

  deltas.push({
    walletAddress: normalized,
    poolId,
    delta,
    baselineRaw,
    timestamp: now,
    expiresAt: now + DEFAULT_TTL_MS,
    chainKey,
  })

  saveStoredDeltas(deltas)
  console.log(
    `[OptimisticTracker] Recorded delta ${delta > 0 ? '+' : ''}${delta} for ${poolId}${chainKey ? ` on ${chainKey}` : ''} (${normalized})`
  )
}

/**
 * Gets the active (unexpired and not yet indexed by Circle) deltas for a wallet/pool.
 * When rawCurrent shows that Circle's off-chain indexer has already caught up, the
 * corresponding record is cleared automatically — same reconciliation as before.
 */
export function getActiveOptimisticDeltas(
  walletAddress: string,
  rawCurrent?: number,
  poolId = 'gateway-settlement-pool'
): ActiveOptimisticDelta[] {
  if (!walletAddress) return []
  const normalized = walletAddress.toLowerCase()
  const deltas = getStoredDeltas()
  const now = Date.now()

  const active: ActiveOptimisticDelta[] = []
  let hasChanges = false

  for (let i = deltas.length - 1; i >= 0; i--) {
    const item = deltas[i]
    if (item.walletAddress !== normalized || item.poolId !== poolId) continue
    if (item.expiresAt <= now) {
      deltas.splice(i, 1)
      hasChanges = true
      continue
    }

    // Auto-reconciliation: if raw API has already moved by >= 90% of the delta,
    // it means Circle's backend indexer has successfully processed the on-chain event!
    if (rawCurrent !== undefined && !isNaN(rawCurrent) && typeof item.baselineRaw === 'number') {
      const actualRawMovement = rawCurrent - item.baselineRaw
      // Check if raw movement is in the same direction and magnitude
      if (
        (item.delta < 0 && actualRawMovement <= item.delta * 0.9) ||
        (item.delta > 0 && actualRawMovement >= item.delta * 0.9)
      ) {
        console.log(`[OptimisticTracker] Raw API indexed change (${actualRawMovement}), clearing delta for ${poolId}`)
        deltas.splice(i, 1)
        hasChanges = true
        continue
      }
    }

    active.push({
      chainKey: item.chainKey,
      delta: item.delta,
      baselineRaw: item.baselineRaw,
      expiresAt: item.expiresAt,
    })
  }

  if (hasChanges) {
    saveStoredDeltas(deltas)
  }

  // Iteration walks backwards for safe splicing; restore insertion order for callers.
  return active.reverse()
}

/**
 * Gets the total net optimistic delta for a given wallet and pool.
 * If rawCurrent shows that Circle's off-chain indexer has already caught up,
 * the delta is cleared automatically.
 */
export function getOptimisticDelta(
  walletAddress: string,
  rawCurrent?: number,
  poolId = 'gateway-settlement-pool'
): number {
  return getActiveOptimisticDeltas(walletAddress, rawCurrent, poolId).reduce(
    (sum, item) => sum + item.delta,
    0
  )
}

/**
 * Applies active optimistic deltas to a raw base amount safely (clamped to >= 0).
 */
export function applyOptimisticDelta(
  walletAddress: string,
  rawAmount: number,
  poolId = 'gateway-settlement-pool'
): number {
  const delta = getOptimisticDelta(walletAddress, rawAmount, poolId)
  if (delta === 0) return Math.max(0, rawAmount)
  const adjusted = rawAmount + delta
  return Math.max(0, parseFloat(adjusted.toFixed(4)))
}

/**
 * Clears all pending deltas for a wallet (e.g. on disconnect or hard reset).
 */
export function clearOptimisticDeltas(walletAddress?: string) {
  if (!walletAddress) {
    if (typeof window !== 'undefined') sessionStorage.removeItem(STORAGE_KEY)
    return
  }
  const normalized = walletAddress.toLowerCase()
  const deltas = getStoredDeltas().filter((d) => d.walletAddress !== normalized)
  saveStoredDeltas(deltas)
}
