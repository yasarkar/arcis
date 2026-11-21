// src/config/x402/manifests/slippageOptimizer.ts
import type { ServiceManifest } from '../../../types/x402.js'
import { ARC_TESTNET_TOKENS } from '../../arcChain.js'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes.js'

export const slippageOptimizerManifest: ServiceManifest = {
  id: 'arc-deep-liquidity-slippage-optimizer',
  version: '1.1.0',
  name: 'Smart Trade & Execution Advisor',
  tagline: 'Compare Direct vs 2-Hop Routes, Reserve Exposure & Batch Sizing Before You Swap',
  category: 'Liquidity & Routing',
  engine: 'native',
  description: 'Compares direct and 2-hop routes across all 6 Arc L1 V4 pools, measures pool reserve exposure (sandwich risk), and recommends optimal batch sizing before you submit a swap.',
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
    priceUsdc: 0.003,
    maxAmountUsdc: 0.003,
    protocolFeeBps: 50,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
      amount: '3000',
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
      fromToken: { type: 'string', enum: ['USDC', 'EURC', 'WETH', 'cirBTC'] },
      toToken: { type: 'string', enum: ['USDC', 'EURC', 'WETH', 'cirBTC'] },
      amount: { type: 'number', minimum: 0.0001 },
      slippageTolerancePct: { type: 'number', minimum: 0.01, maximum: 5 },
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
          { label: 'cirBTC', value: 'cirBTC' },
        ],
        description: 'Source asset to swap. Only assets with a live Arc pool are offered.',
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
          { label: 'cirBTC', value: 'cirBTC' },
        ],
        description: 'Target destination asset. Arc has no WBTC; its Bitcoin asset is cirBTC.',
        required: true,
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'number',
        defaultValue: 50000,
        description: 'Token amount to evaluate across direct and 2-hop pools.',
        required: true,
      },
      {
        name: 'slippageTolerancePct',
        label: 'Max Slippage Tolerance (%)',
        type: 'number',
        defaultValue: 0.5,
        description: 'Maximum slippage tolerance used in the advisory execution sizing check.',
        required: false,
      },
    ],
  },
  examples: {
    request: {
      fromToken: 'USDC',
      toToken: 'WETH',
      amount: 50000,
      slippageTolerancePct: 0.5,
    },
    response: {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: '50,000 USDC',
      expectedOutput: '17.5842 WETH',
      recommendedPath: 'USDC → WETH',
      recommendedHops: 1,
      effectiveExecutionPrice: 0.000352,
      overallPriceImpactPct: 0.042,
      tradeReserveExposurePct: 3.57,
      sandwichRiskLevel: 'MODERATE',
      flashReserveDepthUsdc: 1400000,
    },
  },
  sla: {
    p95LatencyMs: 250,
    uptimePct: 99.95,
    successRate: 99.95,
  },
  healthcheckUrl: '/api/x402/health/arc-deep-liquidity-slippage-optimizer',
  agentPrompts: [
    'Compare direct vs 2-hop swap route and reserve risk for 50,000 USDC to WETH',
    'Check slippage and batch sizing before executing a large Arc swap',
  ],
  tags: ['Trade-Advisor', 'Multi-Hop', 'Slippage', 'Reserve-Risk'],
}
