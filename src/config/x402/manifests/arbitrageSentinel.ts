// src/config/x402/manifests/arbitrageSentinel.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const arbitrageSentinelManifest: ServiceManifest = {
  id: 'arc-cross-dex-arbitrage-sentinel',
  version: '1.0.0',
  name: 'Cross-DEX Arbitrage Sentinel',
  tagline: 'Prices an Arc L1 Pool Against an External Oracle and Reports the Net Spread',
  category: 'Arbitrage',
  engine: 'native',
  description: 'Reads one Arc L1 pool rate and compares it with the external oracle rate for the same pair, then reports the gross spread and the net result after the measured Arc gas cost.',
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
    maxAmountUsdc: 0.005,
    protocolFeeBps: 50,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
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
    additionalProperties: false,
    required: ['pair', 'tradeSizeUsdc'],
    properties: {
      pair: {
        type: 'string',
        enum: ['USDC/EURC', 'USDC/WETH', 'USDC/cirBTC'],
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
        defaultValue: 'USDC/EURC',
        options: [
          { label: 'USDC / EURC (StableSwap)', value: 'USDC/EURC' },
          { label: 'USDC / WETH (Volatile Pool)', value: 'USDC/WETH' },
          { label: 'USDC / cirBTC (Constant Product)', value: 'USDC/cirBTC' },
        ],
        description: 'Primary liquidity pair to scan on Arc L1.',
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
      pair: 'USDC/EURC',
      tradeSizeUsdc: 25000,
      minNetProfitPct: 0.35,
      includeGasCostEstimate: true,
    },
    // Every figure comes from the on-chain pool reserves, the live oracle prices and Arc's
    // gas price for the requested trade size. If one of those reads fails the response is
    // { status: 'UNAVAILABLE', unavailable: [...], reason: [...] } with no numbers at all.
    response: {
      status: 'OPPORTUNITY_DETECTED',
      timestamp: 1760000000000,
      pair: 'USDC/EURC',
      liveOraclePrices: { USDC: 1, EURC: 1.082 },
      bestRoute: {
        buyDex: 'Arcis StableSwap V3 Pool',
        buyPriceUsdc: 1.082,
        sellDex: 'External Oracle / Gateway Bridge',
        sellPriceUsdc: 1.091,
        grossSpreadPct: 0.832,
        recommendedTradeSize: 25000,
        estimatedGasCostUsdc: 0.0084,
        netProfitUsdc: 207.99,
        netProfitPct: 0.832,
      },
    },
  },
  sla: {
    p95LatencyMs: 125,
    uptimePct: 99.9,
    successRate: 99.9,
  },
  healthcheckUrl: '/api/x402/health/arc-cross-dex-arbitrage-sentinel',
  agentPrompts: [
    'Scan DEX pools for USDC/EURC stable arbitrage',
    'Calculate net profit after Arc gas fees for 25k USDC arb',
  ],
  tags: ['Arbitrage', 'DEX-Spreads', 'Alpha', 'Flash-Exec'],
}
