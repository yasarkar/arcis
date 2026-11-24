// src/services/platformStatsClient.ts
// Client access to `GET /api/x402/stats`.
//
// The number this returns is shared by every visitor, so it is not derived from anything local:
// the bounded 60-second sessionStorage cache only paints a recent live reading while revalidating,
// and an `unavailable` response immediately clears it so the card renders a dash (`—`).

import type { PlatformStatsSnapshot, PlatformStatsServiceRow } from '../types/x402'

export const PLATFORM_STATS_ENDPOINT = '/api/x402/stats'

/** Fired by the local execution path after a paid call succeeds, so the card can update at once. */
export const PLATFORM_CALL_RECORDED_EVENT = 'arcis:platform-stats:call-recorded'

/** Maximum age for a sessionStorage first-paint snapshot (60 seconds). */
export const PLATFORM_STATS_SESSION_MAX_AGE_MS = 60_000

const PLATFORM_STATS_CACHE_KEY = 'arcis_platform_stats_v1'
const PLATFORM_STATS_POLL_MS = 30_000

export interface CachedPlatformStatsEntry {
  snapshot: PlatformStatsSnapshot
  cachedAt: number
}

function toCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function normalizeServiceRows(value: unknown): PlatformStatsServiceRow[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => ({
      serviceId: String(row.serviceId || ''),
      acceptedCalls: toCount(row.acceptedCalls),
      settledCalls: toCount(row.settledCalls),
    }))
    .filter((row) => row.serviceId.length > 0)
}

/** Accepts only a well-formed payload; anything else is treated as an unreadable counter. */
export function normalizePlatformStats(body: unknown): PlatformStatsSnapshot | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const source = record.source
  if (source !== 'ledger' && source !== 'memory' && source !== 'unavailable') return null
  const updatedAt = Number(record.updatedAt)
  return {
    source,
    acceptedCalls: toCount(record.acceptedCalls),
    settledCalls: toCount(record.settledCalls),
    volumeUsdc: Number.isFinite(Number(record.volumeUsdc)) ? Number(record.volumeUsdc) : 0,
    byService: normalizeServiceRows(record.byService),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
  }
}

export function clearCachedPlatformStats(): void {
  try {
    sessionStorage.removeItem(PLATFORM_STATS_CACHE_KEY)
  } catch {
    // Storage unavailable or blocked; nothing to clear.
  }
}

export function readCachedPlatformStatsEntry(now: number = Date.now()): CachedPlatformStatsEntry | null {
  try {
    const raw = sessionStorage.getItem(PLATFORM_STATS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null

    // Envelope format: { snapshot, cachedAt }
    if ('snapshot' in parsed && 'cachedAt' in parsed) {
      const cachedAt = Number(parsed.cachedAt)
      if (!Number.isFinite(cachedAt) || cachedAt <= 0 || now - cachedAt > PLATFORM_STATS_SESSION_MAX_AGE_MS) {
        clearCachedPlatformStats()
        return null
      }
      const snapshot = normalizePlatformStats(parsed.snapshot)
      if (!snapshot || snapshot.source === 'unavailable') {
        clearCachedPlatformStats()
        return null
      }
      return { snapshot, cachedAt }
    }

    // Legacy raw snapshot without cachedAt cannot prove freshness -> expire it.
    clearCachedPlatformStats()
    return null
  } catch {
    return null
  }
}

export function readCachedPlatformStats(now: number = Date.now()): PlatformStatsSnapshot | null {
  return readCachedPlatformStatsEntry(now)?.snapshot ?? null
}

export function cachePlatformStats(snapshot: PlatformStatsSnapshot, now: number = Date.now()): void {
  // Never keep a stale positive figure when the server reports unavailable.
  if (snapshot.source === 'unavailable') {
    clearCachedPlatformStats()
    return
  }
  try {
    const entry: CachedPlatformStatsEntry = { snapshot, cachedAt: now }
    sessionStorage.setItem(PLATFORM_STATS_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // A full/blocked storage quota only costs the instant first paint.
  }
}

/**
 * Reads the shared counter. The URL is intentionally stable and unparameterised so Vercel's edge
 * cache can absorb polling traffic; a cache-busting query would turn every poll into an invocation.
 */
export async function fetchPlatformStats(signal?: AbortSignal): Promise<PlatformStatsSnapshot | null> {
  try {
    const res = await fetch(PLATFORM_STATS_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!res.ok) return null
    const snapshot = normalizePlatformStats(await res.json())
    if (snapshot) cachePlatformStats(snapshot)
    return snapshot
  } catch {
    return null
  }
}

export function platformStatsPollIntervalMs(): number {
  return PLATFORM_STATS_POLL_MS
}

/** Announces a locally completed paid call; the hook turns that into an optimistic increment. */
export function notifyPlatformCallRecorded(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PLATFORM_CALL_RECORDED_EVENT))
}

export function subscribeToPlatformCalls(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(PLATFORM_CALL_RECORDED_EVENT, listener)
  return () => window.removeEventListener(PLATFORM_CALL_RECORDED_EVENT, listener)
}
