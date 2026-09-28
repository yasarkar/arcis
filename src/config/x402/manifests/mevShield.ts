// src/config/x402/manifests/mevShield.ts
import type { ServiceManifest } from '../../../types/x402'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_BATCHED_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const mevShieldManifest: ServiceManifest = {
  id: 'arc-mempool-mev-shield',
  version: '1.0.0',
  name: 'Arc Mempool & MEV Shield Simulator',
  tagline: 'Pre-Simulates Sandwich Attacks and Frontrunning Risks for Pending Transactions',
  category: 'MEV & Security',
  engine: 'native',
  description: 'Simulates pending high-volume transactions against malicious mempool MEV bots. Provides 100% protection through Arc L1 priority gas optimizations and private RPC relayer routes.',
  listing: {
    kind: 'official',
    ownerAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'ArcGuard Security Labs',
    address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    isVerified: true,
    reputationScore: 98,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.004,
    maxAmountUsdc: 0.01,
    protocolFeeBps: 100,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.ARC_TESTNET,
      asset: 'USDC',
      payTo: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      amount: '4000',
      maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
      extra: {
        name: CIRCLE_BATCHING_METADATA.NAME,
        version: CIRCLE_BATCHING_METADATA.VERSION,
        verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet,
      },
      domain: DEFAULT_X402_DOMAIN,
    },
  ],
  serve: {
    method: 'POST',
    path: '/api/x402/arc-mempool-mev-shield',
  },
  requestSchema: {
    type: 'object',
    required: ['targetTxAmountUsdc', 'slippageTolerancePct'],
    properties: {
      targetTxAmountUsdc: { type: 'number', minimum: 1 },
      slippageTolerancePct: { type: 'number', minimum: 0.01 },
    },
  },
  ui: {
    form: [
      {
        name: 'targetTxAmountUsdc',
        label: 'Transaction Value (USDC)',
        type: 'number',
        defaultValue: 100000,
        description: 'Transaction size to evaluate for MEV exposure.',
        required: true,
      },
      {
        name: 'slippageTolerancePct',
        label: 'Slippage Tolerance (%)',
        type: 'number',
        defaultValue: 0.5,
        description: 'Configured maximum slippage tolerance.',
        required: true,
      },
    ],
  },
  examples: {
    request: {
      targetTxAmountUsdc: 100000,
      slippageTolerancePct: 0.5,
    },
    response: {
      status: 'ANALYSIS_COMPLETE',
      vulnerabilityLevel: 'HIGH_IF_UNPROTECTED',
      detectedActiveMevBotsCount: 6,
      potentialLossWithoutShieldUsdc: 450.8,
      recommendedShieldAction: {
        bundleType: 'Flashbots/ArcPrivateRelayer',
        adjustedMaxSlippagePct: 0.08,
        mevProtectionScore: '100% SECURE',
      },
    },
  },
  sla: {
    p95LatencyMs: 110,
    uptimePct: 99.98,
    successRate: 99.98,
  },
  healthcheckUrl: '/api/x402/health/arc-mempool-mev-shield',
  agentPrompts: [
    'Simulate MEV risk for $100,000 swap on Arc',
    'Calculate sandwich attack exposure before executing large order',
  ],
  tags: ['MEV', 'Security', 'Anti-Sandwich', 'Simulation'],
}
