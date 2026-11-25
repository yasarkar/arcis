// src/config/x402/manifests/arbitrageSentinel.ts
import type { ServiceManifest } from '../../../types/x402.js'
import { ARC_TESTNET_TOKENS } from '../../arcChain.js'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes.js'

export const arbitrageSentinelManifest: ServiceManifest = {
  id: 'arc-cross-dex-arbitrage-sentinel',
  version: '1.1.0',
  name: 'All-Pools Spread & Mispricing Scanner',
  tagline: 'Scan All 6 Live Arc Pools Against Market Oracles & Rank Net Spreads After Gas',
  category: 'Arbitrage',
  engine: 'native',
  description: 'Scans all 6 Arc L1 V4 pools in parallel (or a single selected pair), compares live reserve ratios against external market oracles, and ranks net spreads after Arc USDC gas costs.',
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
        enum: ['ALL_POOLS', 'USDC/EURC', 'USDC/WETH', 'USDC/cirBTC', 'EURC/WETH', 'EURC/cirBTC', 'cirBTC/WETH'],
      },
      tradeSizeUsdc: { type: 'number', minimum: 100 },
      minNetProfitPct: { type: 'number', minimum: 0 },
    },
  },
  ui: {
    form: [
      {
        name: 'pair',
        label: 'Pools to Scan',
        type: 'select',
        defaultValue: 'ALL_POOLS',
        options: [
          { label: 'All 6 Arc Pools (Recommended)', value: 'ALL_POOLS' },
          { label: 'USDC / EURC (StableSwap)', value: 'USDC/EURC' },
          { label: 'USDC / WETH (Constant Product)', value: 'USDC/WETH' },
          { label: 'USDC / cirBTC (Constant Product)', value: 'USDC/cirBTC' },
          { label: 'EURC / WETH (Cross-Pair)', value: 'EURC/WETH' },
          { label: 'EURC / cirBTC (Cross-Pair)', value: 'EURC/cirBTC' },
          { label: 'cirBTC / WETH (Bluechip Pair)', value: 'cirBTC/WETH' },
        ],
        description: 'Scan all 6 deployed Arc L1 V4 pools at once or focus on a single pair.',
        required: true,
      },
      {
        name: 'tradeSizeUsdc',
        label: 'Notional Size (USDC)',
        type: 'number',
        defaultValue: 25000,
        description: 'Reference USDC notional volume for net spread calculation.',
        required: true,
      },
      {
        name: 'minNetProfitPct',
        label: 'Min. Net Spread Threshold (%)',
        type: 'number',
        defaultValue: 0.35,
        description: 'Highlight pools whose net spread after Arc gas exceeds this hurdle.',
        required: false,
      },
    ],
  },
  examples: {
    request: {
      pair: 'ALL_POOLS',
      tradeSizeUsdc: 25000,
      minNetProfitPct: 0.35,
    },
    response: {
      status: 'OPPORTUNITY_DETECTED',
      timestamp: 1760000000000,
      pair: 'ALL_POOLS',
      bestPair: 'USDC/EURC',
      poolsScannedCount: 6,
      poolsMeasuredCount: 6,
      opportunitiesCount: 1,
      liveOraclePrices: { USDC: 1, EURC: 1.082 },
      bestRoute: {
        pair: 'USDC/EURC',
        buyDex: 'Arcis StableSwap V4 Pool',
        buyPriceUsdc: 1.082,
        sellDex: 'External Market Oracle (Reference)',
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
    p95LatencyMs: 280,
    uptimePct: 99.9,
    successRate: 99.9,
  },
  healthcheckUrl: '/api/x402/health/arc-cross-dex-arbitrage-sentinel',
  agentPrompts: [
    'Scan all 6 Arc pools for the widest price divergence against market oracles',
    'Rank Arc DEX pool spreads after USDC gas for a $25,000 trade size',
  ],
  tags: ['All-Pools', 'Spreads', 'Mispricing', 'Oracle-Check'],
}
