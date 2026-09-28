// src/types/x402.ts
// Arc AI Services & Circle Gateway Nanopayments (x402) Architectural Contracts

import type { ActionableSignalPayload, ServiceInputParameter } from './marketplace'

export type ServiceCategory =
  | 'All'
  // Mevcut kategoriler (5 resmî servis bu kategorilerdedir)
  | 'Arbitrage'
  | 'Liquidity & Routing'
  | 'Yield & Flash-Loan'
  | 'MEV & Security'
  | 'Cross-Chain Gateway'
  // Genişletilmiş katalog kategorileri
  | 'Agent & Copilot'
  | 'Automation'
  | 'Risk & Compliance'
  | 'Payments & Invoicing'
  | 'Reporting & Tax'
  | 'Data & Oracles'

export interface PricingModel {
  model: 'per_call' | 'tiered' | 'token_based'
  priceUsdc: number // Baz çağrı fiyatı
  maxAmountUsdc: number // İstemcinin imzalayacağı üst sınır (slippage/overcharge koruması)
  protocolFeeBps?: number // Protokol komisyonu (bps, varsayılan 100 = %1)
  tiers?: Array<{ upTo: number; priceUsdc: number }>
  tokenUnit?: number // token_based: 1000 token başına birim
}

export interface ServiceManifest {
  id: string
  version: `${number}.${number}.${number}`
  name: string
  tagline: string
  category: Exclude<ServiceCategory, 'All'>
  engine: 'native' | 'llm' | 'proxy'
  description: string
  listing: {
    kind: 'official' | 'community'
    ownerAddress: string
    createdAt: number
  }
  provider: {
    name: string
    address: string
    isVerified: boolean
    reputationScore?: number
    verifiedAt?: number
  }
  pricing: PricingModel
  accepts: Array<{
    scheme: 'exact'
    network: string
    asset: string
    payTo: string
    amount?: string
    maxTimeoutSeconds?: number
    extra?: {
      name: string
      version: string
      verifyingContract: string
    }
    domain?: {
      name: string
      version: string
      chainId: number
      verifyingContract: string
    }
  }>
  serve: {
    method: 'GET' | 'POST'
    path: string
  }
  upstream?: {
    url: string
    method: 'GET' | 'POST'
  }
  requestSchema: Record<string, unknown>
  responseSchema?: Record<string, unknown>
  ui: {
    form: ServiceInputParameter[]
  }
  examples: {
    request: Record<string, any>
    response: Record<string, any>
  }
  sla: {
    p95LatencyMs: number
    uptimePct: number
    successRate: number
  }
  healthcheckUrl?: string
  agentPrompts?: string[]
  tags: string[]
}

export interface X402PaymentRequirements {
  x402Version: 1 | 2
  accepts: Array<{
    scheme: 'exact'
    network: string
    asset: string
    payTo: `0x${string}`
    amount?: string // base units, 6 decimal (x402 v2)
    maxAmountRequired?: string // base units, 6 decimal (x402 v1 backwards-compatibility)
    resource?: string
    description?: string
    mimeType?: string
    maxTimeoutSeconds?: number
    extra?: {
      name: string
      version: string
      verifyingContract: `0x${string}` | string
    }
    domain?: {
      name: string
      version: string
      chainId: number
      verifyingContract: `0x${string}`
    }
  }>
  error?: string
}

export interface X402PaymentSignaturePayload {
  x402Version?: 1 | 2
  scheme?: 'exact'
  network?: string
  payload: {
    signature: `0x${string}` // EIP-3009 TransferWithAuthorization signature (ecrecover compatible)
    authorization: {
      from: `0x${string}`
      to: `0x${string}`
      value: string
      validAfter: string
      validBefore: string
      nonce: `0x${string}`
    }
  }
  accepted?: any
}

export interface PaymentReceipt {
  id: string
  idempotencyKey: string // sha256(serviceId|payer|nonce)
  serviceId: string
  serviceVersion: string
  payer: `0x${string}`
  payTo: `0x${string}`
  payerAddress?: `0x${string}`
  providerAddress?: `0x${string}`
  amountUsdc: number
  authorizedMaxUsdc: number
  scheme: 'exact'
  network: string
  authorizationSignature: `0x${string}`
  settlementRef?: string
  batchTxHash?: `0x${string}`
  explorerUrl?: string
  protocolFeeUsdc: number
  providerEarnedUsdc: number
  latencyMs: number
  status: 'authorized' | 'settled' | 'served' | 'refunded' | 'voided' | 'failed'
  failureReason?: string
  engineMode: 'gateway_batched' | 'onchain_exact'
  gasSponsored: boolean
  createdAt: number
}

export interface ProviderLedger {
  providerAddress: `0x${string}`
  services: Array<{ serviceId: string; callsServed: number; grossUsdc: number }>
  pendingUsdc: number
  availableUsdc: number
  withdrawnUsdc: number
  lastWithdrawal?: { amountUsdc: number; txHash: `0x${string}`; at: number }
}

export interface ServiceHealth {
  serviceId: string
  online: boolean
  latencyMs: number
  p95LatencyMs: number
  successRate: number
  sampleCount: number
  status: 'online' | 'degraded' | 'offline'
  probeTarget: 'endpoint' | 'rpc'
  lastProbeAt: number
  history: Array<{ latencyMs: number; success: boolean; at: number }>
}

export interface X402ExecutionReceipt {
  statusCode: number
  success: boolean
  data?: unknown
  error?: string
  executionTimeMs: number
  costUsdc: number
  protocolFeeUsdc?: number
  providerEarnedUsdc?: number
  payment?: PaymentReceipt
  actionablePayload?: ActionableSignalPayload
  explorerUrl?: string
  txHash?: string
  authProof?: {
    signature: `0x${string}` | string
    payerAddress: `0x${string}` | string
    timestamp?: number
  }
  requirements?: X402PaymentRequirements
  engineMode?: 'gateway_batched' | 'onchain_exact'
  gasSponsored?: boolean
}
