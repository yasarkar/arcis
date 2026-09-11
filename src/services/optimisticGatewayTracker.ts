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

/**
 * Records an optimistic balance change for a specific wallet and pool.
 * @param walletAddress The user's wallet address
 * @param delta Number of tokens (+ for deposit, - for withdraw)
 * @param baselineRaw Current raw balance before the action
 * @param poolId Defaults to 'gateway-settlement-pool'
 */
export function recordOptimisticDelta(
  walletAddress: string,
  delta: number,
  baselineRaw = 0,
  poolId = 'gateway-settlement-pool'
) {
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
  })

  saveStoredDeltas(deltas)
  console.log(`[OptimisticTracker] Recorded delta ${delta > 0 ? '+' : ''}${delta} for ${poolId} (${normalized})`)
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
  if (!walletAddress) return 0
  const normalized = walletAddress.toLowerCase()
  const deltas = getStoredDeltas()
  const now = Date.now()

  let netDelta = 0
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

    netDelta += item.delta
  }

  if (hasChanges) {
    saveStoredDeltas(deltas)
  }

  return netDelta
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
