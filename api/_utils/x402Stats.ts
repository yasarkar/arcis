// api/_utils/x402Stats.ts
// Protocol-wide paid-call counters for the AI Services surface.
//
// Vercel runs every invocation in a fresh, isolated process, so a module-level counter is not a
// metric — it is a per-instance coincidence. These counters therefore live in the shared store and
// move only through one atomic script that also writes a per-authorization claim key, which makes
// the increment exactly-once even when the paid call and the reconciler both observe the same
// settlement. Keys are namespaced by `VERCEL_ENV` so preview traffic can never inflate the number
// the public page shows.
//
// Nothing here fabricates a value: with no durable driver the snapshot reports
// `source: 'unavailable'` and the UI renders a dash instead of a zero.

import type { PlatformStatsServiceRow, PlatformStatsSnapshot } from '../../src/types/x402'
import { kvEval, kvHgetall } from './redisStorage'

function getEnv(key: string): string {
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const val = localEnv[key] || globalEnv[key] || ''
  return String(val).replace(/^["']|["']$/g, '').trim()
}

/** Storage-schema version. Bump only when the field layout below changes. */
export const PLATFORM_STATS_VERSION = 'v1'

/** Claim keys outlive the 30-day settlement records they deduplicate. */
const CLAIM_TTL_SECONDS = 30 * 24 * 60 * 60

const ACCEPTED_FIELD = 'accepted'
const SETTLED_FIELD = 'settled'
const VOLUME_FIELD = 'volumeMicros'
const UPDATED_AT_FIELD = 'updatedAt'
const SERVICE_ACCEPTED_PREFIX = 'svc:'
const SERVICE_SETTLED_PREFIX = 'svcSettled:'

const ADDRESS_SHAPE = /^0x[0-9a-f]{40}$/
const NONCE_SHAPE = /^0x[0-9a-f]{64}$/
const SERVICE_ID_SHAPE = /^[a-z0-9-]{1,100}$/

/**
 * One script, one round trip: claim the authorization, then increment the counters.
 * `SET ... NX` is the idempotency guard, so a retried or reconciled settlement cannot count twice.
 */
const RECORD_SCRIPT = `
local claimed = redis.call('SET', KEYS[2], '1', 'EX', ${CLAIM_TTL_SECONDS}, 'NX')
if not claimed then return 'duplicate' end
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
local volume = tonumber(ARGV[2])
if volume and volume > 0 then redis.call('HINCRBY', KEYS[1], ARGV[3], volume) end
if ARGV[4] ~= '' then redis.call('HINCRBY', KEYS[1], ARGV[5], 1) end
redis.call('HSET', KEYS[1], ARGV[6], ARGV[7])
return 'recorded'
`

export type PlatformCallKind = 'accepted' | 'settled'

export type PlatformCallInput = {
  providerAddress: string
  nonce: string
  serviceId: string
  /** Exact USDC amount in 6-decimal base units. Ignored for `settled` (already counted once). */
  amountMicros?: number
}

export type PlatformRecordResult = 'recorded' | 'duplicate' | 'unavailable'

/** Preview and production share one Redis database, so the environment must be part of the key. */
export function getPlatformStatsNamespace(): string {
  const raw = getEnv('VERCEL_ENV') || getEnv('NODE_ENV') || 'development'
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32)
  return slug || 'development'
}

export function platformStatsKey(namespace: string = getPlatformStatsNamespace()): string {
  return `arcis:x402:stats:${PLATFORM_STATS_VERSION}:${namespace}`
}

function claimKey(kind: PlatformCallKind, providerAddress: string, nonce: string): string {
  return `${platformStatsKey()}:claim:${kind}:${providerAddress.toLowerCase()}:${nonce.toLowerCase()}`
}

function isProduction(): boolean {
  return getEnv('NODE_ENV') === 'production'
}

// Process-local mirror for local development and tests only. It is never read in production,
// because one instance's memory is not a protocol metric.
const memoryHash = new Map<string, number>()
const memoryClaims = new Set<string>()

function memoryRecord(kind: PlatformCallKind, input: PlatformCallInput): PlatformRecordResult {
  if (isProduction()) return 'unavailable'
  const claim = claimKey(kind, input.providerAddress, input.nonce)
  if (memoryClaims.has(claim)) return 'duplicate'
  memoryClaims.add(claim)

  const bump = (field: string, by: number) => {
    memoryHash.set(field, (memoryHash.get(field) || 0) + by)
  }
  bump(kind === 'accepted' ? ACCEPTED_FIELD : SETTLED_FIELD, 1)
  if (kind === 'accepted') {
    const micros = Math.max(0, Math.trunc(input.amountMicros || 0))
    if (micros > 0) bump(VOLUME_FIELD, micros)
    bump(`${SERVICE_ACCEPTED_PREFIX}${input.serviceId}`, 1)
  } else {
    bump(`${SERVICE_SETTLED_PREFIX}${input.serviceId}`, 1)
  }
  memoryHash.set(UPDATED_AT_FIELD, Date.now())
  return 'recorded'
}

function isValidCallInput(input: PlatformCallInput): boolean {
  if (!ADDRESS_SHAPE.test(String(input.providerAddress || '').toLowerCase())) return false
  if (!NONCE_SHAPE.test(String(input.nonce || '').toLowerCase())) return false
  if (!SERVICE_ID_SHAPE.test(String(input.serviceId || ''))) return false
  if (input.amountMicros !== undefined && (!Number.isSafeInteger(input.amountMicros) || input.amountMicros < 0)) return false
  return true
}

/**
 * Counts one facilitator-accepted or Circle-confirmed paid call.
 * Never throws: accounting must not fail a payment that already succeeded.
 */
export async function recordPlatformCall(
  kind: PlatformCallKind,
  input: PlatformCallInput
): Promise<PlatformRecordResult> {
  try {
    if (!isValidCallInput(input)) return 'unavailable'
    const key = platformStatsKey()
    const claim = claimKey(kind, input.providerAddress, input.nonce)
    const volumeMicros = kind === 'accepted' ? Math.max(0, Math.trunc(input.amountMicros || 0)) : 0
    const serviceField =
      kind === 'accepted'
        ? `${SERVICE_ACCEPTED_PREFIX}${input.serviceId}`
        : `${SERVICE_SETTLED_PREFIX}${input.serviceId}`

    const result = await kvEval(
      RECORD_SCRIPT,
      [key, claim],
      [
        kind === 'accepted' ? ACCEPTED_FIELD : SETTLED_FIELD,
        volumeMicros,
        VOLUME_FIELD,
        kind === 'accepted' ? input.serviceId : '',
        serviceField,
        UPDATED_AT_FIELD,
        Date.now(),
      ]
    )
    if (result === 'recorded' || result === 'duplicate') return result
    return memoryRecord(kind, input)
  } catch (err) {
    // A counter outage is logged and swallowed; the payment path must not fail because of it.
    console.warn('[x402-stats] Platform call counter update failed:', err)
    return 'unavailable'
  }
}

function toCount(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0
}

function round6(value: number): number {
  return Number(value.toFixed(6))
}

function emptySnapshot(source: PlatformStatsSnapshot['source']): PlatformStatsSnapshot {
  return {
    source,
    acceptedCalls: 0,
    settledCalls: 0,
    volumeUsdc: 0,
    byService: [],
    updatedAt: null,
  }
}

/** Builds the public snapshot from a flat hash of counter fields. */
export function parsePlatformStats(
  hash: Record<string, string>,
  source: PlatformStatsSnapshot['source']
): PlatformStatsSnapshot {
  const services = new Map<string, PlatformStatsServiceRow>()
  for (const [field, value] of Object.entries(hash)) {
    if (field.startsWith(SERVICE_ACCEPTED_PREFIX)) {
      const serviceId = field.slice(SERVICE_ACCEPTED_PREFIX.length)
      if (!serviceId) continue
      const row = services.get(serviceId) || { serviceId, acceptedCalls: 0, settledCalls: 0 }
      row.acceptedCalls = toCount(value)
      services.set(serviceId, row)
    } else if (field.startsWith(SERVICE_SETTLED_PREFIX)) {
      const serviceId = field.slice(SERVICE_SETTLED_PREFIX.length)
      if (!serviceId) continue
      const row = services.get(serviceId) || { serviceId, acceptedCalls: 0, settledCalls: 0 }
      row.settledCalls = toCount(value)
      services.set(serviceId, row)
    }
  }

  const updatedAt = toCount(hash[UPDATED_AT_FIELD])
  return {
    source,
    acceptedCalls: toCount(hash[ACCEPTED_FIELD]),
    settledCalls: toCount(hash[SETTLED_FIELD]),
    volumeUsdc: round6(toCount(hash[VOLUME_FIELD]) / 1_000_000),
    byService: [...services.values()].sort(
      (a, b) => b.acceptedCalls - a.acceptedCalls || a.serviceId.localeCompare(b.serviceId)
    ),
    updatedAt: updatedAt > 0 ? updatedAt : null,
  }
}

/**
 * Reads the shared snapshot. Order: durable store -> process-local (development only) -> unavailable.
 */
export async function readPlatformStats(): Promise<PlatformStatsSnapshot> {
  let hash: Record<string, string> | null = null
  try {
    hash = await kvHgetall(platformStatsKey())
  } catch (err) {
    console.warn('[x402-stats] Platform stats read failed:', err)
    hash = null
  }

  if (hash && Object.keys(hash).length > 0) return parsePlatformStats(hash, 'ledger')

  if (!isProduction() && memoryHash.size > 0) {
    const local: Record<string, string> = {}
    for (const [field, value] of memoryHash.entries()) local[field] = String(value)
    return parsePlatformStats(local, 'memory')
  }

  // A durable driver that answered with an empty hash is a real zero; no driver at all is not.
  if (hash) return parsePlatformStats(hash, 'ledger')
  return emptySnapshot('unavailable')
}

/** Test helper: clears the process-local mirror. */
export function __resetPlatformStatsForTests(): void {
  memoryHash.clear()
  memoryClaims.clear()
}
