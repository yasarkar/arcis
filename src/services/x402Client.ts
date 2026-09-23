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

import { settleX402Payment } from './x402PaymentEngine'
import { generateLiveServiceData } from './aiServicesDataProvider'

/**
 * Execute an x402 call for a given service and input payload
 * Combines Arc Testnet cryptographic payment settlement, session key budget,
 * live on-chain data intelligence, and actionable execution payloads.
 */
export async function executeX402Call(
  service: x402Service,
  inputPayload: Record<string, any>,
  payerAddress?: string,
  provider?: any
): Promise<x402ExecutionResult> {
  const startTime = performance.now()
  const activePayer = payerAddress

  // 1. Check local session budget guard
  const budget = getSessionBudget()
  if (budget.enabled && budget.spentUsdc + service.priceUsdc > budget.maxBudgetUsdc) {
    return {
      statusCode: 402,
      success: false,
      error: `Session budget limit reached! Spent: $${budget.spentUsdc.toFixed(4)} / Max: $${budget.maxBudgetUsdc.toFixed(2)} USDC.`,
      executionTimeMs: Math.round(performance.now() - startTime),
      costUsdc: 0,
      challenge: {
        statusCode: 402,
        paymentRequired: true,
        token: 'USDC',
        recipient: service.provider.address,
        amountUsdc: service.priceUsdc,
        amountUnits: (service.priceUsdc * 1e6).toString(),
        scheme: service.paymentScheme,
        chainId: arcTestnet.id,
        nonce: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
        validUntil: Date.now() + 60000,
      },
    }
  }

  // 2. Perform Real Micropayment Settlement & Fee Routing
  const settlement = await settleX402Payment(service, activePayer, provider)
  if (!settlement.success) {
    const failDuration = Math.round(performance.now() - startTime)
    serviceTelemetryService.recordExecution(service.id, failDuration, false)
    return {
      statusCode: 402,
      success: false,
      error: settlement.error || 'x402 Payment Settlement Failed',
      executionTimeMs: failDuration,
      costUsdc: 0,
      challenge: settlement.challenge,
    }
  }

  // Deduct from local legacy budget for UI sync
  deductSessionBudget(service.priceUsdc)

  // 3. Generate Live On-Chain Intelligence & Actionable Triggers
  const { data, actionablePayload } = await generateLiveServiceData(service, inputPayload)
  const duration = Math.round(performance.now() - startTime)

  // Record live telemetry for actual execution
  serviceTelemetryService.recordExecution(service.id, duration, true)

  return {
    statusCode: 200,
    success: true,
    data,
    executionTimeMs: duration,
    costUsdc: settlement.costUsdc,
    protocolFeeUsdc: settlement.protocolFeeUsdc,
    providerEarnedUsdc: settlement.providerEarnedUsdc,
    txHash: settlement.txHash,
    blockNumber: settlement.blockNumber,
    explorerUrl: settlement.explorerUrl,
    actionablePayload,
    challenge: settlement.challenge,
    authProof: settlement.authProof,
    executionMode: settlement.executionMode,
    gasSponsored: settlement.gasSponsored,
  }
}
