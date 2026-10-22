// src/services/platformStatsClient.ts
// Client access to `GET /api/x402/stats`.
//
// The number this returns is shared by every visitor, so it is not derived from anything local:
// the browser cache only exists to paint the last known value while the request is in flight.

import type { PlatformStatsSnapshot, PlatformStatsServiceRow } from '../types/x402'

export const PLATFORM_STATS_ENDPOINT = '/api/x402/stats'

/** Fired by the local execution path after a paid call succeeds, so the card can update at once. */
export const PLATFORM_CALL_RECORDED_EVENT = 'arcis:platform-stats:call-recorded'

const PLATFORM_STATS_CACHE_KEY = 'arcis_platform_stats_v1'
const PLATFORM_STATS_POLL_MS = 30_000

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

export function readCachedPlatformStats(): PlatformStatsSnapshot | null {
  try {
    const raw = sessionStorage.getItem(PLATFORM_STATS_CACHE_KEY)
    if (!raw) return null
    return normalizePlatformStats(JSON.parse(raw))
  } catch {
    return null
  }
}

export function cachePlatformStats(snapshot: PlatformStatsSnapshot): void {
  try {
    sessionStorage.setItem(PLATFORM_STATS_CACHE_KEY, JSON.stringify(snapshot))
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
