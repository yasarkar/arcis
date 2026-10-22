// api/_utils/x402Reconciler.ts
// Background reconciler for Circle Gateway x402 settlements.
//
// A paid call is served once the facilitator accepts it, but provider accounting only becomes final
// when Circle reports the matching transfer as confirmed/completed. Until this sweep runs, those
// records stay `pending` forever. The sweep is intentionally independent of
// ENABLE_GATEWAY_SETTLE: turning new payments off must not strand already-accepted ones.

import { kvScanKeys, kvSetIfAbsent } from './redisStorage'
import { reconcileSettlementByNonce } from './x402Settlement'

const PENDING_KEY_PATTERN = 'arcis:x402:pending:{*}'
const PENDING_KEY_SHAPE = /^arcis:x402:pending:\{(0x[0-9a-f]{40})\}:(0x[0-9a-f]{64})$/

export interface ReconcileSweepSummary {
  enabled: boolean
  scanned: number
  attempted: number
  confirmed: number
  failed: number
  pending: number
  skipped: number
  errors: number
  durationMs: number
}

function readEnv(name: string): string {
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  return String(localEnv[name] ?? globalEnv[name] ?? '').trim()
}

export function isX402ReconcilerEnabled(): boolean {
  return readEnv('X402_RECONCILE_ENABLED').toLowerCase() !== 'false'
}

/** Per-record throttle. One Circle lookup per pending nonce per interval, not per sweep. */
export function getReconcileIntervalSeconds(): number {
  const parsed = parseInt(readEnv('X402_RECONCILE_INTERVAL_MINUTES') || '5', 10)
  const minutes = Number.isFinite(parsed) ? Math.max(1, Math.min(1440, parsed)) : 5
  return minutes * 60
}

function getBatchSize(): number {
  const parsed = parseInt(readEnv('X402_RECONCILE_BATCH_SIZE') || '50', 10)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 50
}

/**
 * Reconciles up to X402_RECONCILE_BATCH_SIZE pending settlements.
 * Never throws: a driver or Circle failure is counted in `errors` so the scheduler keeps running.
 */
export async function runReconcileSweep(): Promise<ReconcileSweepSummary> {
  const startedAt = Date.now()
  const summary: ReconcileSweepSummary = {
    enabled: isX402ReconcilerEnabled(),
    scanned: 0,
    attempted: 0,
    confirmed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    errors: 0,
    durationMs: 0,
  }
  if (!summary.enabled) {
    summary.durationMs = Date.now() - startedAt
    return summary
  }

  let keys: string[]
  try {
    keys = await kvScanKeys(PENDING_KEY_PATTERN, getBatchSize())
  } catch (err) {
    console.error('[x402-reconciler] Could not scan pending settlements:', err)
    summary.errors += 1
    summary.durationMs = Date.now() - startedAt
    return summary
  }
  summary.scanned = keys.length
  const intervalSeconds = getReconcileIntervalSeconds()

  for (const key of keys) {
    const match = key.match(PENDING_KEY_SHAPE)
    if (!match) {
      summary.skipped += 1
      continue
    }
    const [, providerAddress, nonce] = match
    const throttleKey = `arcis:x402:reconcile:{${providerAddress}}:${nonce}`

    let throttle: 'acquired' | 'exists' | 'unavailable'
    try {
      throttle = await kvSetIfAbsent(throttleKey, '1', intervalSeconds)
    } catch {
      throttle = 'unavailable'
    }
    if (throttle !== 'acquired') {
      summary.skipped += 1
      continue
    }

    summary.attempted += 1
    try {
      const result = await reconcileSettlementByNonce(providerAddress, nonce)
      const status = typeof result.body.status === 'string' ? result.body.status : ''
      if (status === 'confirmed') summary.confirmed += 1
      else if (status === 'failed') summary.failed += 1
      else if (status === 'pending' || status === 'settling') summary.pending += 1
      else summary.errors += 1
    } catch (err) {
      summary.errors += 1
      console.error(`[x402-reconciler] Reconcile failed for nonce ${nonce.slice(0, 12)}…:`, err)
    }
  }

  summary.durationMs = Date.now() - startedAt
  return summary
}

let intervalHandle: NodeJS.Timeout | null = null
let initialHandle: NodeJS.Timeout | null = null

/** Starts the in-process sweep loop. Intended for the standalone server, not serverless. */
export function startX402Reconciler(): void {
  if (!isX402ReconcilerEnabled()) {
    console.log('[x402-reconciler] Disabled via X402_RECONCILE_ENABLED=false')
    return
  }
  if (intervalHandle) clearInterval(intervalHandle)
  if (initialHandle) clearTimeout(initialHandle)

  const minutes = Math.round(getReconcileIntervalSeconds() / 60)
  console.log(`[x402-reconciler] Initialized. Reconciling pending Gateway settlements every ${minutes}m.`)

  const tick = (label: string) => {
    runReconcileSweep()
      .then((summary) => {
        if (summary.attempted > 0 || summary.errors > 0) {
          console.log(
            `[x402-reconciler] ${label}: scanned=${summary.scanned} attempted=${summary.attempted} confirmed=${summary.confirmed} failed=${summary.failed} pending=${summary.pending} errors=${summary.errors} in ${summary.durationMs}ms`
          )
        }
      })
      .catch((err) => console.error('[x402-reconciler] Sweep failed:', err))
  }

  initialHandle = setTimeout(() => tick('initial sweep'), 20_000)
  intervalHandle = setInterval(() => tick('sweep'), getReconcileIntervalSeconds() * 1000)
}

export function stopX402Reconciler(): void {
  if (initialHandle) {
    clearTimeout(initialHandle)
    initialHandle = null
  }
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
  console.log('[x402-reconciler] Stopped.')
}
