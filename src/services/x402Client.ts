import type { x402Service, x402ExecutionResult, x402PaymentChallenge } from '../types/marketplace'
import type { X402ExecutionReceipt } from '../types/x402'
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

  // Default initial session budget.
  // Safe-off: no autonomous authorization until the user explicitly turns it on.
  return {
    enabled: true,
    maxBudgetUsdc: 1.00,
    spentUsdc: 0.00,
    autoApprove: false,
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
    // Reset restores the safe default: the user must re-opt into autonomous spending.
    autoApprove: false,
    expiresAt: Date.now() + 24 * 3600 * 1000,
  }
  saveSessionBudget(state)
}

export { executePaidCall } from './x402/paymentOrchestrator'
import { executePaidCall } from './x402/paymentOrchestrator'

export function  hasVerifiedX402Settlement(

  result: Pick<X402ExecutionReceipt, 'success' | 'costUsdc' | 'payment'>
): boolean {
  // Circle Gateway's reference is not an Arc transaction hash, and `settlement_pending`
  // means only that the facilitator accepted the nanopayment for later batch settlement.
  return Boolean(
    result.success &&
      result.costUsdc > 0 &&
      result.payment?.status === 'settled' &&
      result.payment.amountUsdc === result.costUsdc &&
      typeof result.payment.settlementRef === 'string' &&
      /^0x[0-9a-fA-F]{64}$/.test(result.payment.settlementRef)
  )
}

export function hasAcceptedX402Payment(
  result: Pick<X402ExecutionReceipt, 'success' | 'costUsdc' | 'payment'>
): boolean {
  return Boolean(
    result.success && result.costUsdc > 0 &&
    result.payment?.status === 'settlement_pending' &&
    result.payment.amountUsdc === result.costUsdc &&
    typeof result.payment.settlementRef === 'string' && result.payment.settlementRef.length > 0 &&
    !/^0x[0-9a-fA-F]{64}$/.test(result.payment.settlementRef)
  )
}

export function isServiceDataAvailable(
  result: Pick<X402ExecutionReceipt, 'data'>
): boolean {
  return Boolean(
    result.data &&
      typeof result.data === 'object' &&
      typeof (result.data as Record<string, unknown>).status === 'string' &&
      (result.data as Record<string, unknown>).status !== 'UNAVAILABLE'
  )
}

export function isSuccessfulX402ServiceResult(
  result: Pick<X402ExecutionReceipt, 'success' | 'costUsdc' | 'payment' | 'data'>
): boolean {
  // A valid provider response can be served once Gateway accepts the nanopayment. This is
  // distinct from final provider accounting: only `hasVerifiedX402Settlement` is final.
  return (hasVerifiedX402Settlement(result) || hasAcceptedX402Payment(result)) && isServiceDataAvailable(result)
}

/**
 * Execute an x402 call for a given service and input payload.
 * Paid data requires facilitator acceptance; provider accounting stays pending until reconciliation.
 */
export async function executeX402Call(
  service: x402Service,
  inputPayload: Record<string, any>,
  payerAddress?: string,
  provider?: any,
  payerKind: 'session_eoa' | 'external_eoa' = 'external_eoa'
): Promise<x402ExecutionResult> {
  const startTime = performance.now()

  const price = service.pricing.priceUsdc

  // A browser-local session budget is informational only; it is neither an on-chain
  // authorization nor a reliable cap for an explicitly signed external-EOA payment.
  // Only a wallet explicitly resolved as an external EOA can sign Gateway nanopayments.
  const res = await executePaidCall({
    manifest: service,
    payload: inputPayload,
    payer: payerAddress ? { kind: payerKind, address: payerAddress as `0x${string}` } : undefined,
    walletAddress: payerAddress as `0x${string}`,
    provider,
  })

  // This local preference is not a payment authority/accounting ledger; Gateway pending
  // acceptance must not be presented as a finalized debit or autonomous session spend.

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
    // A Circle facilitator reference is not a chain transaction hash.
    txHash: res.txHash || res.payment?.batchTxHash,
    challenge,
    authProof: res.authProof ? {
      signature: res.authProof.signature,
      payerAddress: res.authProof.payerAddress,
      timestamp: res.authProof.timestamp || Date.now(),
    } : undefined,
    executionMode: res.payment?.status === 'settled'
      ? (res.engineMode === 'gateway_batched' ? 'gateway_batched' : 'onchain_verified')
      : undefined,
  }
}

