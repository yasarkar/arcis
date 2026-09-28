import type { x402Service, x402ExecutionResult, x402PaymentChallenge } from '../types/marketplace'
import { arcTestnet } from '../config/arcChain'
import { serviceTelemetryService } from './serviceTelemetryService'

// Session Key & Budget state stored in memory / localStorage
const SESSION_BUDGET_KEY = 'arcis_x402_session_budget'
const SESSION_SPENT_KEY = 'arcis_x402_session_spent'

export interface SessionBudgetState {
  enabled: boolean
  maxBudgetUsdc: number
  spentUsdc: number
  autoApprove: boolean
  expiresAt: number
}

export function getSessionBudget(): SessionBudgetState {
  try {
    const raw = localStorage.getItem(SESSION_BUDGET_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.expiresAt > Date.now()) {
        return parsed
      }
    }
  } catch (e) {
    console.error('Failed to load session budget', e)
  }

  // Default initial session budget
  return {
    enabled: true,
    maxBudgetUsdc: 1.00,
    spentUsdc: 0.00,
    autoApprove: true,
    expiresAt: Date.now() + 24 * 3600 * 1000,
  }
}

export function saveSessionBudget(state: SessionBudgetState): void {
  localStorage.setItem(SESSION_BUDGET_KEY, JSON.stringify(state))
}

export function deductSessionBudget(amountUsdc: number): void {
  const current = getSessionBudget()
  current.spentUsdc = Number((current.spentUsdc + amountUsdc).toFixed(6))
  saveSessionBudget(current)
}

export function resetSessionBudget(newMax = 1.00): void {
  const state: SessionBudgetState = {
    enabled: true,
    maxBudgetUsdc: newMax,
    spentUsdc: 0.00,
    autoApprove: true,
    expiresAt: Date.now() + 24 * 3600 * 1000,
  }
  saveSessionBudget(state)
}

export { executePaidCall } from './x402/paymentOrchestrator'
import { executePaidCall } from './x402/paymentOrchestrator'

/**
 * Execute an x402 call for a given service and input payload.
 * Unified entry point orchestrating EIP-3009 payment authorization,
 * Invariant I1-I4 guards, live intelligence engine, and fee routing.
 */
export async function executeX402Call(
  service: x402Service,
  inputPayload: Record<string, any>,
  payerAddress?: string,
  provider?: any
): Promise<x402ExecutionResult> {
  const startTime = performance.now()

  // 1. Check local session budget guard for backward compatibility
  const budget = getSessionBudget()
  const price = service.pricing.priceUsdc
  if (budget.enabled && budget.spentUsdc + price > budget.maxBudgetUsdc) {
    const failDuration = Math.round(performance.now() - startTime)
    serviceTelemetryService.recordExecution(service.id, failDuration, false)
    return {
      statusCode: 402,
      success: false,
      error: `Session budget limit reached! Spent: $${budget.spentUsdc.toFixed(4)} / Max: $${budget.maxBudgetUsdc.toFixed(2)} USDC.`,
      executionTimeMs: failDuration,
      costUsdc: 0,
      challenge: {
        statusCode: 402,
        paymentRequired: true,
        token: 'USDC',
        recipient: service.provider.address,
        amountUsdc: price,
        amountUnits: (price * 1e6).toString(),
        scheme: service.accepts[0]?.scheme || 'exact',
        chainId: arcTestnet.id,
        nonce: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
        validUntil: Date.now() + 60000,
      },
    }
  }

  // 2. Delegate to F1 Payment Orchestrator (EIP-3009 Zero-Popup Session EOA & Two-Phase Settlement)
  const res = await executePaidCall({
    manifest: service,
    payload: inputPayload,
    walletAddress: payerAddress as `0x${string}`,
    provider,
  })

  // Deduct from local legacy budget for UI sync
  if (res.success && res.costUsdc > 0) {
    deductSessionBudget(res.costUsdc)
  }

  // Record live telemetry for execution
  serviceTelemetryService.recordExecution(service.id, res.executionTimeMs, res.success)

  const challenge: x402PaymentChallenge | undefined = res.requirements ? {
    statusCode: 402,
    paymentRequired: true,
    token: 'USDC',
    recipient: service.provider.address,
    amountUsdc: price,
    amountUnits: (price * 1e6).toString(),
    scheme: service.accepts[0]?.scheme || 'exact',
    chainId: arcTestnet.id,
    nonce: res.payment?.idempotencyKey ? res.payment.idempotencyKey.split(':').pop() || '' : '',
    validUntil: Date.now() + 60000,
  } : undefined

  return {
    ...res,
    txHash: res.txHash || res.payment?.batchTxHash,
    blockNumber: res.payment?.settlementRef ? parseInt(res.payment.settlementRef) : undefined,
    challenge,
    authProof: res.authProof ? {
      signature: res.authProof.signature,
      payerAddress: res.authProof.payerAddress,
      timestamp: res.authProof.timestamp || Date.now(),
    } : undefined,
    executionMode: res.engineMode === 'gateway_batched' ? 'session_autonomous' : 'onchain_verified',
  }
}

