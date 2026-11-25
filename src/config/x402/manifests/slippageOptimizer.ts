// src/config/x402/manifests/slippageOptimizer.ts
import type { ServiceManifest } from '../../../types/x402.js'
import { ARC_TESTNET_TOKENS } from '../../arcChain.js'
import {
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_MAX_SLIPPAGE_BPS,
  POOL_MIN_SLIPPAGE_BPS,
} from '../../poolsConfig.js'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes.js'

const MIN_SLIPPAGE_PCT = POOL_MIN_SLIPPAGE_BPS / 100
const MAX_SLIPPAGE_PCT = POOL_MAX_SLIPPAGE_BPS / 100
const DEFAULT_SLIPPAGE_PCT = POOL_DEFAULT_SLIPPAGE_BPS / 100

export const slippageOptimizerManifest: ServiceManifest = {
  id: 'arc-deep-liquidity-slippage-optimizer',
  version: '1.2.0',
  name: 'Smart Trade & Execution Advisor',
  tagline: 'Compare Direct vs 2-Hop Routes, Reserve Exposure & Batch Sizing Before You Swap',
  category: 'Liquidity & Routing',
  engine: 'native',
  description: 'Compares direct and 2-hop routes across all 6 Arc L1 V4 pools, measures pool reserve pressure & execution risk, and recommends optimal batch sizing before you submit a swap.',
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
      slippageTolerancePct: {
        type: 'number',
        minimum: MIN_SLIPPAGE_PCT,
        maximum: MAX_SLIPPAGE_PCT,
      },
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
        defaultValue: 10,
        description: 'Token amount to evaluate across direct and 2-hop pools.',
        required: true,
      },
      {
        name: 'slippageTolerancePct',
        label: 'Max Slippage Tolerance (%)',
        type: 'number',
        defaultValue: DEFAULT_SLIPPAGE_PCT,
        description: `Maximum slippage tolerance enforced by Arc DEX pools (${MIN_SLIPPAGE_PCT}% – ${MAX_SLIPPAGE_PCT}%).`,
        required: false,
      },
    ],
  },
  examples: {
    request: {
      fromToken: 'USDC',
      toToken: 'WETH',
      amount: 10,
      slippageTolerancePct: DEFAULT_SLIPPAGE_PCT,
    },
    response: {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: '10 USDC',
      expectedOutput: '0.0035 WETH',
      minGuaranteedOutput: '0.003482 WETH',
      recommendedPath: 'USDC → WETH',
      recommendedHops: 1,
      effectiveExecutionPrice: 0.000352,
      ammPriceImpactPct: 0.34,
      poolFeePct: 0.3,
      overallPriceImpactPct: 0.42,
      tradeReserveExposurePct: 3.41,
      sandwichRiskLevel: 'MODERATE',
      flashReserveDepthUsdc: 293,
    },
  },
  sla: {
    p95LatencyMs: 250,
    uptimePct: 99.95,
    successRate: 99.95,
  },
  healthcheckUrl: '/api/x402/health/arc-deep-liquidity-slippage-optimizer',
  agentPrompts: [
    'Compare direct vs 2-hop swap route and reserve pressure for 10 USDC to WETH',
    'Check slippage and batch sizing before executing an Arc swap',
  ],
  tags: ['Trade-Advisor', 'Multi-Hop', 'Slippage', 'Reserve-Risk'],
}
