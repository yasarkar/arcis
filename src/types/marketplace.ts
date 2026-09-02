// Data structures for x402 AI Services Marketplace & Arcis AI Copilot
export type ServiceCategory = 
  | 'All'
  | 'Arbitrage'
  | 'Liquidity & Routing'
  | 'Yield & Flash-Loan'
  | 'MEV & Security'
  | 'Cross-Chain Gateway'

export interface ServiceInputParameter {
  name: string
  label: string
  type: 'string' | 'number' | 'select' | 'boolean'
  defaultValue: string | number | boolean
  options?: { label: string; value: string | number }[]
  description: string
  required?: boolean
}

export interface x402Service {
  id: string
  name: string
  tagline: string
  category: Exclude<ServiceCategory, 'All'>
  description: string
  priceUsdc: number // Price in USDC, e.g. 0.005
  latencyMs: number // Expected average response latency in ms
  successRate: number // e.g. 99.8%
  endpointUrl: string
  method: 'GET' | 'POST'
  tags: string[]
  provider: {
    name: string
    address: string
    isVerified: boolean
    reputationScore: number
  }
  inputParameters: ServiceInputParameter[]
  sampleRequestPayload: Record<string, any>
  sampleResponseData: Record<string, any>
  supportedChains: string[]
  paymentScheme: 'GatewayWalletBatched' | 'x402-exact'
}

export interface x402PaymentChallenge {
  statusCode: 402
  paymentRequired: true
  token: 'USDC'
  recipient: string
  amountUsdc: number
  amountUnits: string // in 6 decimals wei string
  scheme: 'GatewayWalletBatched' | 'x402-exact'
  chainId: number
  nonce: string
  validUntil: number
}

export interface x402ExecutionResult {
  statusCode: number
  success: boolean
  data?: any
  error?: string
  executionTimeMs: number
  costUsdc: number
  txHash?: string
  challenge?: x402PaymentChallenge
  authProof?: {
    signature: string
    payerAddress: string
    timestamp: number
  }
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
