// src/services/latencyClient.ts
// Client access to `GET /api/x402/latency`.
//
// The AI Services card shows one latency figure for every visitor, so it reads the deployment's
// shared measurement instead of averaging this browser's own probes. The cache only paints the last
// known value while the request is in flight.

import type { LatencySnapshot } from '../types/x402'

export const LATENCY_ENDPOINT = '/api/x402/latency'

const LATENCY_CACHE_KEY = 'arcis_shared_latency_v1'
const LATENCY_POLL_MS = 30_000

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

export function readCachedLatency(): LatencySnapshot | null {
  try {
    const raw = sessionStorage.getItem(LATENCY_CACHE_KEY)
    if (!raw) return null
    return normalizeLatencySnapshot(JSON.parse(raw))
  } catch {
    return null
  }
}

export function cacheLatency(snapshot: LatencySnapshot): void {
  try {
    sessionStorage.setItem(LATENCY_CACHE_KEY, JSON.stringify(snapshot))
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
