// Data structures for x402 AI Services Marketplace & Arcis AI Copilot
import type {
  ServiceCategory,
  ServiceManifest,
  PricingModel,
  X402PaymentRequirements,
  X402PaymentSignaturePayload,
  PaymentReceipt,
  ProviderLedger,
  ServiceHealth,
  X402ExecutionReceipt,
} from './x402'

export type {
  ServiceCategory,
  ServiceManifest,
  PricingModel,
  X402PaymentRequirements,
  X402PaymentSignaturePayload,
  PaymentReceipt,
  ProviderLedger,
  ServiceHealth,
  X402ExecutionReceipt,
}

// Backward compatibility alias: legacy code referring to x402Service now refers to ServiceManifest
export type x402Service = ServiceManifest

export interface ServiceInputParameter {
  name: string
  label: string
  type: 'string' | 'number' | 'select' | 'boolean'
  defaultValue: string | number | boolean
  options?: { label: string; value: string | number }[]
  description: string
  required?: boolean
}

/** @deprecated Use X402PaymentRequirements instead */
export interface x402PaymentChallenge {
  statusCode: 402
  paymentRequired: true
  token: 'USDC'
  recipient: string
  amountUsdc: number
  amountUnits: string // in 6 decimals wei string
  scheme: string
  chainId: number
  nonce: string
  validUntil: number
}

export interface ActionableSignalPayload {
  type: 'swap' | 'arbitrage' | 'deposit' | 'navigate'
  title: string
  badgeText: string
  details: {
    fromToken?: string
    toToken?: string
    amountIn?: number
    estimatedOut?: number
    poolAddress?: string
    spreadPct?: number
    estimatedProfitUsdc?: number
    priceImpactPct?: number
    targetChain?: string
    navTab?: string
    [key: string]: any
  }
}

// Backward compatibility alias: legacy code referring to x402ExecutionResult
export type x402ExecutionResult = X402ExecutionReceipt & {
  txHash?: string
  blockNumber?: number
  challenge?: x402PaymentChallenge
  authProof?: {
    signature: string
    payerAddress: string
    timestamp: number
  }
  executionMode?: 'onchain_verified' | 'session_autonomous'
}


export interface ProviderStats {
  totalCallsServed: number
  totalUsdcEarned: number
  unclaimedEarningsUsdc: number
  activeServicesCount: number
}

export interface CopilotStepLog {
  stepNumber: number
  serviceId: string
  serviceName: string
  status: 'pending' | 'executing' | 'completed' | 'failed'
  costUsdc: number
  durationMs: number
  detail: string
  resultSummary?: string
}

export type CopilotActionType =
  | 'trade'
  | 'zap'
  | 'view_pool'
  | 'code'
  | 'faucet'
  | 'bridge'
  | 'send'
  | 'ai-services'
  | 'interactive_swap'
  | 'interactive_deposit'
  | 'interactive_bridge'
  | 'interactive_send'
  | 'interactive_batch_send'
  | 'configure_session'

export interface CopilotActionPayload {
  type: CopilotActionType
  title: string
  data?: {
    fromToken?: string
    toToken?: string
    tokenSymbol?: string
    recipient?: string
    memo?: string
    amount?: number
    slippage?: number
    estimatedOut?: number
    rate?: number
    fromChain?: string
    toChain?: string
    apy?: string
    estimatedYieldUsdcYearly?: number
    recipients?: Array<{ address: string; amount: number }>
    [key: string]: any
  }
}

import type { InlineExecutionReceipt, ExecutionProgressState } from './sessionKey'

export interface CopilotMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  steps?: CopilotStepLog[]
  totalCostUsdc?: number
  actionPayload?: CopilotActionPayload
  receipt?: InlineExecutionReceipt
  executionState?: ExecutionProgressState
  isExecutingInline?: boolean
  isStreaming?: boolean
}

export interface MarketplaceStats {
  totalCallsProcessed: number
  totalVolumeUsdc: number
  totalYieldGeneratedUsdc: number
  averageResponseTimeMs: number
  activeServicesCount: number
  savedSubscriptionCostUsd: number
}
