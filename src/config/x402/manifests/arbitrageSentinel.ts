// src/config/x402/manifests/arbitrageSentinel.ts
import type { ServiceManifest } from '../../../types/x402'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_BATCHED_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const arbitrageSentinelManifest: ServiceManifest = {
  id: 'arc-cross-dex-arbitrage-sentinel',
  version: '1.0.0',
  name: 'Arc Cross-DEX Arbitrage Sentinel',
  tagline: 'Calculates Real-Time Price Spreads and Net Profit Across Arc L1 DEX Pools',
  category: 'Arbitrage',
  engine: 'native',
  description: 'Detects arbitrage cycles across Arc L1 Uniswap v3, Curve, and Aerodrome forks alongside external CEX/Gateway bridges in milliseconds. Returns estimated gross profit, gas costs (USDC), and net yield percentage.',
  listing: {
    kind: 'official',
    ownerAddress: '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arc Alpha Labs & Quantitative AI',
    address: '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A',
    isVerified: true,
    reputationScore: 99,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.005,
    maxAmountUsdc: 0.01,
    protocolFeeBps: 100,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.ARC_TESTNET,
      asset: 'USDC',
      payTo: '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A',
      amount: '5000',
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
    path: '/api/x402/arc-cross-dex-arbitrage-sentinel',
  },
  requestSchema: {
    type: 'object',
    required: ['pair', 'tradeSizeUsdc'],
    properties: {
      pair: {
        type: 'string',
        enum: ['USDC/WETH', 'USDC/WBTC', 'USDC/EURC', 'af-USDC/USDC'],
      },
      tradeSizeUsdc: { type: 'number', minimum: 100 },
      minNetProfitPct: { type: 'number', minimum: 0 },
    },
  },
  ui: {
    form: [
      {
        name: 'pair',
        label: 'Token Pair',
        type: 'select',
        defaultValue: 'USDC/WETH',
        options: [
          { label: 'USDC / WETH', value: 'USDC/WETH' },
          { label: 'USDC / WBTC', value: 'USDC/WBTC' },
          { label: 'USDC / EURC', value: 'USDC/EURC' },
          { label: 'af-USDC / USDC (Vault Peg)', value: 'af-USDC/USDC' },
        ],
        description: 'Primary liquidity pair to scan.',
        required: true,
      },
      {
        name: 'tradeSizeUsdc',
        label: 'Trade Capital (USDC)',
        type: 'number',
        defaultValue: 25000,
        description: 'Simulated swap trade volume.',
        required: true,
      },
      {
        name: 'minNetProfitPct',
        label: 'Min. Net Profit Threshold (%)',
        type: 'number',
        defaultValue: 0.35,
        description: 'Filter opportunities exceeding this net profit margin.',
        required: false,
      },
    ],
  },
  examples: {
    request: {
      pair: 'USDC/WETH',
      tradeSizeUsdc: 25000,
      minNetProfitPct: 0.35,
      includeGasCostEstimate: true,
    },
    response: {
      status: 'OPPORTUNITY_DETECTED',
      timestamp: 1760000000000,
      pair: 'USDC/WETH',
      bestRoute: {
        buyDex: 'ArcSwap V3 (Pool 0.05%)',
        buyPriceUsdc: 2842.1,
        sellDex: 'Aerodrome Arc Fork (Pool 0.3%)',
        sellPriceUsdc: 2864.8,
        grossSpreadPct: 0.798,
        recommendedTradeSize: 25000,
        estimatedGasCostUsdc: 0.0084,
        netProfitUsdc: 199.25,
        netProfitPct: 0.797,
        confidenceScore: 0.984,
        executionCalldataHex: '0x522faf9a0000000000000000000000003600000000000000000000000000000000000000...',
      },
      mempoolRisk: 'LOW_MEV_THREAT',
    },
  },
  sla: {
    p95LatencyMs: 125,
    uptimePct: 99.9,
    successRate: 99.9,
  },
  healthcheckUrl: '/api/x402/health/arc-cross-dex-arbitrage-sentinel',
  agentPrompts: [
    'Scan DEX pools for USDC/WETH triangular arbitrage',
    'Calculate net profit after Arc gas fees for 25k USDC arb',
  ],
  tags: ['Arbitrage', 'DEX Spreads', 'Flash-Exec', 'Alpha'],
}
