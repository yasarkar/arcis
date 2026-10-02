// src/config/x402/manifests/slippageOptimizer.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const slippageOptimizerManifest: ServiceManifest = {
  id: 'arc-deep-liquidity-slippage-optimizer',
  version: '1.0.0',
  name: 'Deep Liquidity Depth & Slippage Predictor',
  tagline: 'Lowest Slippage and Multi-Hop Routing for High-Volume Trades',
  category: 'Liquidity & Routing',
  engine: 'native',
  description: 'Analyzes concentrated liquidity depth across all Arc L1 pools to calculate price impact with 0.01% precision and optimal split-order distribution for trades from $10K to $5M.',
  listing: {
    kind: 'official',
    ownerAddress: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arcis Core Routing Engine',
    address: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
    isVerified: true,
    reputationScore: 100,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.002,
    maxAmountUsdc: 0.002,
    protocolFeeBps: 0,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
      amount: '2000',
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
    path: '/api/x402/arc-deep-liquidity-slippage-optimizer',
  },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['fromToken', 'toToken', 'amount'],
    properties: {
      fromToken: { type: 'string' },
      toToken: { type: 'string' },
      amount: { type: 'number', minimum: 1 },
    },
  },
  ui: {
    form: [
      {
        name: 'fromToken',
        label: 'Sell Token',
        type: 'select',
        defaultValue: 'USDC',
        options: [
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WETH', value: 'WETH' },
          { label: 'af-USDC (Yield Vault)', value: 'af-USDC' },
        ],
        description: 'Source asset to swap.',
        required: true,
      },
      {
        name: 'toToken',
        label: 'Buy Token',
        type: 'select',
        defaultValue: 'WETH',
        options: [
          { label: 'WETH', value: 'WETH' },
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WBTC', value: 'WBTC' },
        ],
        description: 'Target destination asset.',
        required: true,
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'number',
        defaultValue: 50000,
        description: 'Token amount to swap.',
        required: true,
      },
    ],
  },
  examples: {
    request: {
      fromToken: 'USDC',
      toToken: 'WETH',
      amount: 50000,
      maxSplitParts: 3,
    },
    response: {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: '50000 USDC',
      expectedOutput: '17.5842 WETH',
      effectiveExecutionPrice: 2843.46,
      overallPriceImpactPct: 0.042,
      // Real pool depth; null when the reserve read fails (the response then reports
      // status 'UNAVAILABLE' with no quote rather than a substituted estimate).
      flashReserveDepthUsdc: 14200000,
    },
  },
  sla: {
    p95LatencyMs: 95,
    uptimePct: 99.95,
    successRate: 99.95,
  },
  healthcheckUrl: '/api/x402/health/arc-deep-liquidity-slippage-optimizer',
  agentPrompts: [
    'Find the optimal multi-hop route for 50,000 USDC to WETH',
    'Calculate slippage across Arc pools',
  ],
  tags: ['Liquidity', 'Slippage', 'Multi-Hop', 'Smart Routing'],
}
