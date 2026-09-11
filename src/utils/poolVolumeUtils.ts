// Persistent 24h Rolling Swap Volume Utilities for Arcis AMM Pools & Yield Hub.
// Tracks client-side swaps with localStorage persistence, automatic 24-hour pruning,
// and cross-component event dispatching for real-time UI synchronization.

const SWAP_VOL_STORAGE_KEY = 'arcis_swap_volume_history'
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export interface StoredSwapVolumeEntry {
  poolId: string
  timestamp: number
  volumeUsd: number
  txHash?: string
}

// In-memory cache fallback for SSR and non-storage environments
const memorySwapVolume: Record<string, StoredSwapVolumeEntry[]> = {}

export function loadStoredSwapVolume(): StoredSwapVolumeEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = localStorage.getItem(SWAP_VOL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const cutoff = Date.now() - ONE_DAY_MS
    return parsed.filter(
      (e) => e && typeof e.volumeUsd === 'number' && typeof e.timestamp === 'number' && e.timestamp > cutoff
    )
  } catch (err) {
    console.warn('[poolVolumeUtils] Failed to parse stored swap volume:', err)
    return []
  }
}

export function saveStoredSwapVolume(entries: StoredSwapVolumeEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const cutoff = Date.now() - ONE_DAY_MS
    const pruned = entries.filter(
      (e) => e && typeof e.volumeUsd === 'number' && typeof e.timestamp === 'number' && e.timestamp > cutoff
    )
    localStorage.setItem(SWAP_VOL_STORAGE_KEY, JSON.stringify(pruned))
  } catch (err) {
    console.warn('[poolVolumeUtils] Failed to save stored swap volume:', err)
  }
}

/**
 * Records a swap volume entry in USD for a specific pool.
 * Persists to localStorage, updates memory cache, and broadcasts an update event.
 */
export const recordClientSwapVolume = (poolId: string, volumeUsd: number, txHash?: string): void => {
  if (volumeUsd <= 0 || isNaN(volumeUsd)) return

  const cutoff = Date.now() - ONE_DAY_MS
  const entry: StoredSwapVolumeEntry = {
    poolId,
    timestamp: Date.now(),
    volumeUsd,
    txHash,
  }

  // 1. Update in-memory cache
  if (!memorySwapVolume[poolId]) {
    memorySwapVolume[poolId] = []
  }
  memorySwapVolume[poolId] = memorySwapVolume[poolId].filter((e) => e && e.timestamp > cutoff)
  memorySwapVolume[poolId].push(entry)

  // 2. Persist to localStorage
  const stored = loadStoredSwapVolume()
  stored.push(entry)
  saveStoredSwapVolume(stored)

  // 3. Dispatch window event for instant reactive updates in mounted React hooks
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('arcis:swap-volume-updated', {
        detail: { poolId, volumeUsd, txHash },
      })
    )
  }
}

/**
 * Calculates the rolling 24-hour swap volume in USD for a given pool ID.
 */
export const getRollingClientSwapVolume = (poolId: string): number => {
  const cutoff = Date.now() - ONE_DAY_MS
  let total = 0

  // 1. Read from persistent localStorage
  const storedEntries = loadStoredSwapVolume()
  for (const entry of storedEntries) {
    if (entry.poolId === poolId && entry.timestamp > cutoff) {
      total += entry.volumeUsd || 0
    }
  }

  // 2. Supplement from memory cache if not already present in storedEntries
  const memList = memorySwapVolume[poolId]
  if (memList && memList.length > 0) {
    for (const mem of memList) {
      if (
        mem.timestamp > cutoff &&
        !storedEntries.some((s) => s.timestamp === mem.timestamp && s.volumeUsd === mem.volumeUsd)
      ) {
        total += mem.volumeUsd || 0
      }
    }
  }

  return parseFloat(total.toFixed(2))
}
