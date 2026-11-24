// src/services/latencyClient.ts
// Client access to `GET /api/x402/latency`.
//
// The AI Services card shows one latency figure for every visitor, so it reads the deployment's
// shared measurement instead of averaging this browser's own probes. The bounded 60-second
// sessionStorage cache only paints a recent live reading while revalidating, and an `unavailable`
// response immediately clears it so the card renders a dash (`—`).

import type { LatencySnapshot } from '../types/x402'

export const LATENCY_ENDPOINT = '/api/x402/latency'

/** Maximum age for a sessionStorage first-paint snapshot (60 seconds). */
export const LATENCY_SESSION_MAX_AGE_MS = 60_000

const LATENCY_CACHE_KEY = 'arcis_shared_latency_v1'
const LATENCY_POLL_MS = 30_000

export interface CachedLatencyEntry {
  snapshot: LatencySnapshot
  cachedAt: number
}

function toNonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function toCount(value: unknown): number {
  const parsed = toNonNegativeNumber(value)
  return parsed === null ? 0 : Math.trunc(parsed)
}

/** Accepts only a well-formed payload; anything else is treated as an unreadable probe. */
export function normalizeLatencySnapshot(body: unknown): LatencySnapshot | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const source = record.source
  if (source !== 'ledger' && source !== 'memory' && source !== 'unavailable') return null
  if (source === 'unavailable') {
    return { source, avgLatencyMs: null, sampleCount: 0, measuredAt: null }
  }

  const avgLatencyMs = toNonNegativeNumber(record.avgLatencyMs)
  const sampleCount = toCount(record.sampleCount)
  const measuredAt = toNonNegativeNumber(record.measuredAt)
  if (avgLatencyMs === null || sampleCount < 1 || measuredAt === null || measuredAt < 1) return null

  return {
    source,
    avgLatencyMs: Math.round(avgLatencyMs),
    sampleCount,
    measuredAt,
  }
}

export function clearCachedLatency(): void {
  try {
    sessionStorage.removeItem(LATENCY_CACHE_KEY)
  } catch {
    // Storage unavailable or blocked; nothing to clear.
  }
}

export function readCachedLatencyEntry(now: number = Date.now()): CachedLatencyEntry | null {
  try {
    const raw = sessionStorage.getItem(LATENCY_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null

    if ('snapshot' in parsed && 'cachedAt' in parsed) {
      const cachedAt = Number(parsed.cachedAt)
      if (!Number.isFinite(cachedAt) || cachedAt <= 0 || now - cachedAt > LATENCY_SESSION_MAX_AGE_MS) {
        clearCachedLatency()
        return null
      }
      const snapshot = normalizeLatencySnapshot(parsed.snapshot)
      if (!snapshot || snapshot.source === 'unavailable') {
        clearCachedLatency()
        return null
      }
      return { snapshot, cachedAt }
    }

    // Legacy raw snapshot without cachedAt cannot prove freshness -> expire it.
    clearCachedLatency()
    return null
  } catch {
    return null
  }
}

export function readCachedLatency(now: number = Date.now()): LatencySnapshot | null {
  return readCachedLatencyEntry(now)?.snapshot ?? null
}

export function cacheLatency(snapshot: LatencySnapshot, now: number = Date.now()): void {
  // Never keep a stale positive reading when the server reports unavailable.
  if (snapshot.source === 'unavailable') {
    clearCachedLatency()
    return
  }
  try {
    const entry: CachedLatencyEntry = { snapshot, cachedAt: now }
    sessionStorage.setItem(LATENCY_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // A full/blocked storage quota only costs the instant first paint.
  }
}

/** The URL stays stable and unparameterised so Vercel's edge cache can absorb polling traffic. */
export async function fetchLatency(signal?: AbortSignal): Promise<LatencySnapshot | null> {
  try {
    const res = await fetch(LATENCY_ENDPOINT, {
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!res.ok) return null
    const snapshot = normalizeLatencySnapshot(await res.json())
    if (snapshot) cacheLatency(snapshot)
    return snapshot
  } catch {
    return null
  }
}

export function latencyPollIntervalMs(): number {
  return LATENCY_POLL_MS
}
