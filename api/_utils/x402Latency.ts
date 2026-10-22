// api/_utils/x402Latency.ts
// Shared, server-measured latency for the AI Services hero card.
//
// The card used to average this browser's own probes against the tollgate, so two visitors looking
// at the same protocol card could read different numbers and both were labelled "live". This module
// measures Arc Testnet RPC round-trip time from the deployment, caches the reading in the shared
// store, and serves one snapshot to everyone.
//
// Nothing is fabricated: when no sample succeeds (or a production instance has no shared store) the
// snapshot is `unavailable` and the card renders a dash instead of an old or invented number.

import { ACTIVE_ARC_RPCS } from '../../src/services/rpc/rpcConfig'
import type { LatencySnapshot } from '../../src/types/x402'
import { getStorageDriver, kvDel, kvGet, kvSet } from './redisStorage'
import { getPlatformStatsNamespace } from './x402Stats'

/** Storage-schema version. Bump only when the snapshot layout changes. */
export const LATENCY_SNAPSHOT_VERSION = 'v1'

/** A reading older than this is re-measured before it is served. */
export const LATENCY_TTL_SECONDS = 60

/** How many RPC round-trips one measurement averages. */
export const LATENCY_SAMPLE_COUNT = 3

const PROBE_TIMEOUT_MS = 2500

function getEnv(key: string): string {
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  return String(localEnv[key] || globalEnv[key] || '').trim()
}

function isProduction(): boolean {
  return getEnv('NODE_ENV') === 'production'
}

/** Preview, production and local development each keep their own reading. */
export function latencyKey(namespace: string = getPlatformStatsNamespace()): string {
  return `arcis:x402:latency:${LATENCY_SNAPSHOT_VERSION}:${namespace}`
}

function unavailableSnapshot(): LatencySnapshot {
  return { source: 'unavailable', avgLatencyMs: null, sampleCount: 0, measuredAt: null }
}

function toMs(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

/** Accepts only a well-formed stored reading; anything else is treated as absent. */
export function parseLatencySnapshot(
  raw: string | null | undefined,
  source: LatencySnapshot['source']
): LatencySnapshot | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    const avgLatencyMs = toMs(parsed.avgLatencyMs)
    const sampleCount = toMs(parsed.sampleCount)
    const measuredAt = toMs(parsed.measuredAt)
    if (avgLatencyMs === null || sampleCount === null || sampleCount < 1 || measuredAt === null || measuredAt < 1) {
      return null
    }
    return { source, avgLatencyMs, sampleCount, measuredAt }
  } catch {
    return null
  }
}

export function isLatencyFresh(snapshot: LatencySnapshot, now: number = Date.now()): boolean {
  if (snapshot.measuredAt === null) return false
  return now - snapshot.measuredAt < LATENCY_TTL_SECONDS * 1000
}

async function pingRpc(rpcUrl: string, fetchImpl: typeof fetch): Promise<number | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const start = performance.now()
  try {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    await res.json()
    return Math.max(0, Math.round(performance.now() - start))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Measures RPC round-trip time and averages the successful samples.
 *
 * Sequential on purpose: parallel pings queue behind each other on the same socket pool and would
 * report the queue, not the network.
 */
export async function measureLatency(options: {
  rpcUrls?: string[]
  fetchImpl?: typeof fetch
  samples?: number
  now?: () => number
} = {}): Promise<LatencySnapshot> {
  // An explicit list is honoured even when empty: a caller that configured no endpoint must get an
  // unavailable reading, not a silent fallback to the defaults.
  const configured = options.rpcUrls ?? ACTIVE_ARC_RPCS
  const rpcUrls = configured.filter((url): url is string => typeof url === 'string' && url.startsWith('http'))
  if (rpcUrls.length === 0) return unavailableSnapshot()

  const fetchImpl = options.fetchImpl ?? fetch
  const sampleTarget = Math.max(1, Math.min(5, Math.trunc(options.samples ?? LATENCY_SAMPLE_COUNT)))
  const now = options.now ?? Date.now

  const readings: number[] = []
  for (let index = 0; index < sampleTarget; index += 1) {
    const rpcUrl = rpcUrls[index % rpcUrls.length]
    const reading = await pingRpc(rpcUrl, fetchImpl)
    if (reading !== null) readings.push(reading)
  }

  if (readings.length === 0) return unavailableSnapshot()
  const average = Math.round(readings.reduce((sum, value) => sum + value, 0) / readings.length)
  return {
    source: 'ledger',
    avgLatencyMs: average,
    sampleCount: readings.length,
    measuredAt: now(),
  }
}

/**
 * Serves the cached reading when it is fresh, otherwise measures once and stores it.
 *
 * `ledger` means the reading came from the shared store; `memory` means this process measured it
 * with no durable driver (local development only). A production instance without a shared store
 * reports `unavailable`, because one instance's measurement is not the number every visitor sees.
 */
export async function readLatencySnapshot(): Promise<LatencySnapshot> {
  const shared = getStorageDriver() !== 'memory'
  const key = latencyKey()

  if (shared || !isProduction()) {
    try {
      const stored = parseLatencySnapshot(await kvGet(key), shared ? 'ledger' : 'memory')
      if (stored && isLatencyFresh(stored)) return stored
    } catch (err) {
      console.warn('[x402-latency] Shared latency read failed:', err)
    }
  }

  const measured = await measureLatency()
  if (measured.source === 'unavailable') return measured

  if (!shared && isProduction()) return unavailableSnapshot()

  const snapshot: LatencySnapshot = { ...measured, source: shared ? 'ledger' : 'memory' }
  try {
    await kvSet(key, JSON.stringify(snapshot), LATENCY_TTL_SECONDS * 2)
  } catch (err) {
    console.warn('[x402-latency] Shared latency write failed:', err)
  }
  return snapshot
}

/** Test helper: drops the current namespace's stored reading. */
export async function __resetLatencyForTests(): Promise<void> {
  await kvDel(latencyKey())
}
