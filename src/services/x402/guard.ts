// src/services/x402/guard.ts
// Invariant enforcement: Budget caps, nonce freshness, idempotency, and rate limits

import type { PaymentReceipt } from '../../types/x402'

export interface GuardBudgetArgs {
  payer: string
  costUsdc: number
  maxAmountUsdc: number
  currentSpentUsdc: number
  maxSessionBudgetUsdc?: number
}

export interface GuardResult {
  allowed: boolean
  reason?: string
}

export interface RateLimitResult {
  allowed: boolean
  remainingRpm: number
  resetInSeconds: number
}

// In-memory sets & maps for runtime guarding (synced with session / KV where applicable)
const usedNonces = new Map<string, number>() // nonce:payer -> timestamp
const receiptCache = new Map<string, PaymentReceipt>() // idempotencyKey -> PaymentReceipt
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>()

const DEFAULT_RPM = 60
const NONCE_EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Checks budget against maximum authorized per-call and session limits.
 * Enforces Invariant I1 (No Overcharge).
 */
export function checkBudget(args: GuardBudgetArgs): GuardResult {
  if (args.costUsdc <= 0) {
    return { allowed: false, reason: 'Invalid call price: price must be greater than 0 USDC.' }
  }

  // Ensure cost does not exceed authorized max amount
  if (args.costUsdc > args.maxAmountUsdc) {
    return {
      allowed: false,
      reason: `Cost (${args.costUsdc} USDC) exceeds authorized maximum (${args.maxAmountUsdc} USDC).`,
    }
  }

  // Ensure cost does not exceed remaining session budget if defined
  if (args.maxSessionBudgetUsdc !== undefined) {
    const projectedSpend = args.currentSpentUsdc + args.costUsdc
    if (projectedSpend > args.maxSessionBudgetUsdc) {
      return {
        allowed: false,
        reason: `Session budget limit reached: $${args.currentSpentUsdc.toFixed(4)} spent / $${args.maxSessionBudgetUsdc.toFixed(2)} limit.`,
      }
    }
  }

  return { allowed: true }
}

/**
 * Enforces Invariant I2 (Idempotency).
 * Returns 'new' if unseen, or 'replay' with cached receipt if previously executed.
 */
export function checkIdempotency(idempotencyKey: string): {
  status: 'new' | 'replay'
  cachedReceipt?: PaymentReceipt
} {
  const cached = receiptCache.get(idempotencyKey)
  if (cached) {
    return { status: 'replay', cachedReceipt: cached }
  }
  return { status: 'new' }
}

export function registerReceipt(receipt: PaymentReceipt): void {
  receiptCache.set(receipt.idempotencyKey, receipt)
  receiptCache.set(receipt.id, receipt)
}

/**
 * Enforces Invariant I3 (Fresh Nonce).
 * Validates that an authorization nonce has not been consumed yet.
 */
export function checkNonce(nonce: string, payer: string): 'fresh' | 'replayed' {
  const key = `${payer.toLowerCase()}:${nonce.toLowerCase()}`
  const now = Date.now()

  // Clean expired nonces occasionally
  if (usedNonces.size > 5000) {
    for (const [k, time] of usedNonces.entries()) {
      if (now - time > NONCE_EXPIRY_MS) {
        usedNonces.delete(k)
      }
    }
  }

  if (usedNonces.has(key)) {
    return 'replayed'
  }

  usedNonces.set(key, now)
  return 'fresh'
}

/**
 * Sliding window rate limiter per (payer + serviceId)
 */
export function checkRateLimit(
  payer: string,
  serviceId: string,
  rpm: number = DEFAULT_RPM
): RateLimitResult {
  const key = `${payer.toLowerCase()}:${serviceId}`
  const now = Date.now()
  const windowMs = 60 * 1000

  const bucket = rateLimitBuckets.get(key)
  if (!bucket || now - bucket.windowStart > windowMs) {
    rateLimitBuckets.set(key, { count: 1, windowStart: now })
    return { allowed: true, remainingRpm: rpm - 1, resetInSeconds: 60 }
  }

  if (bucket.count >= rpm) {
    const resetInSeconds = Math.max(1, Math.round((bucket.windowStart + windowMs - now) / 1000))
    return { allowed: false, remainingRpm: 0, resetInSeconds }
  }

  bucket.count += 1
  const remaining = rpm - bucket.count
  const resetInSeconds = Math.max(1, Math.round((bucket.windowStart + windowMs - now) / 1000))

  return { allowed: true, remainingRpm: remaining, resetInSeconds }
}

export function resetGuardStateForTesting(): void {
  usedNonces.clear()
  receiptCache.clear()
  rateLimitBuckets.clear()
}
