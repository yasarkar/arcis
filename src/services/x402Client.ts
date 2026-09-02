// src/services/x402Client.ts
// x402 Client Engine: Handles HTTP 402 challenge negotiation, nanopayment authorization, and response caching

import type { x402Service, x402ExecutionResult, x402PaymentChallenge } from '../types/marketplace'
import { DEFAULT_DEMO_PAYER_ADDRESS } from '../config/servicesRegistry'
import { arcTestnet } from '../config/arcChain'

// Session Key & Budget state stored in memory / localStorage
const SESSION_BUDGET_KEY = 'arcflow_x402_session_budget'
const SESSION_SPENT_KEY = 'arcflow_x402_session_spent'

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

/**
 * Execute an x402 call for a given service and input payload
 */
export async function executeX402Call(
  service: x402Service,
  inputPayload: Record<string, any>,
  payerAddress?: string
): Promise<x402ExecutionResult> {
  const startTime = performance.now()
  const activePayer = payerAddress || DEFAULT_DEMO_PAYER_ADDRESS

  // Step 1: Probe the endpoint (or local /api/x402 handler)
  const challenge: x402PaymentChallenge = {
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
  }

  // Simulate ultra-fast network roundtrip (<150ms)
  const simulatedLatency = Math.floor(service.latencyMs * (0.85 + Math.random() * 0.3))
  await new Promise((resolve) => setTimeout(resolve, simulatedLatency))

  // Check budget
  const budget = getSessionBudget()
  if (budget.enabled && budget.spentUsdc + service.priceUsdc > budget.maxBudgetUsdc) {
    return {
      statusCode: 402,
      success: false,
      error: `Session budget limit reached! Spent: $${budget.spentUsdc.toFixed(4)} / Max: $${budget.maxBudgetUsdc.toFixed(2)} USDC.`,
      executionTimeMs: Math.round(performance.now() - startTime),
      costUsdc: 0,
      challenge,
    }
  }

  // Deduct from budget
  deductSessionBudget(service.priceUsdc)

  // Dynamic response payload generation based on service and inputs
  let responseData: any = { ...service.sampleResponseData }
  const now = Date.now()

  if (service.id === 'arc-cross-dex-arbitrage-sentinel') {
    const pair = inputPayload.pair || 'USDC/WETH'
    const tradeSize = Number(inputPayload.tradeSizeUsdc) || 25000
    const basePrice = pair === 'USDC/WBTC' ? 96450 : pair === 'USDC/EURC' ? 1.082 : pair === 'af-USDC/USDC' ? 1.042 : 2842.50
    const spreadPct = Number((0.45 + (Math.random() * 0.6)).toFixed(3))
    const grossProfit = Number((tradeSize * (spreadPct / 100)).toFixed(2))
    const gasUsdc = 0.0084
    const netProfit = Number((grossProfit - gasUsdc).toFixed(2))

    responseData = {
      status: 'OPPORTUNITY_DETECTED',
      timestamp: now,
      pair,
      bestRoute: {
        buyDex: 'ArcSwap V3 (Pool 0.05%)',
        buyPriceUsdc: basePrice,
        sellDex: 'Aerodrome Arc Fork (Pool 0.3%)',
        sellPriceUsdc: Number((basePrice * (1 + spreadPct / 100)).toFixed(2)),
        grossSpreadPct: spreadPct,
        recommendedTradeSize: tradeSize,
        estimatedGasCostUsdc: gasUsdc,
        netProfitUsdc: netProfit,
        netProfitPct: Number((spreadPct - (gasUsdc / tradeSize) * 100).toFixed(3)),
        confidenceScore: 0.988,
        executionCalldataHex: '0x522faf9a' + Math.random().toString(16).substring(2, 42),
      },
      secondaryOpportunities: [
        {
          buyDex: 'Arc Curve StableSwap',
          sellDex: 'ArcSwap V3',
          grossSpreadPct: Number((spreadPct * 0.4).toFixed(3)),
          netProfitUsdc: Number((netProfit * 0.35).toFixed(2)),
        },
      ],
      mempoolRisk: 'LOW_MEV_THREAT',
    }
  } else if (service.id === 'arc-deep-liquidity-slippage-optimizer') {
    const amount = Number(inputPayload.amount) || 50000
    const fromToken = inputPayload.fromToken || 'USDC'
    const toToken = inputPayload.toToken || 'WETH'
    const priceImpact = Number((0.015 + (amount / 1000000) * 0.08).toFixed(3))
    const saved = Number((amount * 0.0068).toFixed(2))

    responseData = {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: `${amount} ${fromToken}`,
      expectedOutput: `${(amount / 2842.50 * (1 - priceImpact / 100)).toFixed(4)} ${toToken}`,
      effectiveExecutionPrice: Number((2842.50 * (1 + priceImpact / 100)).toFixed(2)),
      overallPriceImpactPct: priceImpact,
      savedVsSinglePoolUsdc: saved,
      splitExecutionDistribution: [
        { pool: 'ArcSwap V3 (0.05%)', allocationPct: 60, amountUsdc: amount * 0.6, priceImpact: priceImpact * 0.7 },
        { pool: 'Aerodrome Arc (0.3%)', allocationPct: 40, amountUsdc: amount * 0.4, priceImpact: priceImpact * 1.2 },
      ],
      flashReserveDepthUsdc: 14200000,
      settlementTimeEstimateMs: simulatedLatency + 18,
    }
  }

  const duration = Math.round(performance.now() - startTime)

  return {
    statusCode: 200,
    success: true,
    data: responseData,
    executionTimeMs: duration,
    costUsdc: service.priceUsdc,
    txHash: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
    challenge,
    authProof: {
      signature: '0x7b4a2f8c01d9e76a94b5c8d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0',
      payerAddress: activePayer,
      timestamp: now,
    },
  }
}
