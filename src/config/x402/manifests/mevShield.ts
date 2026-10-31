// src/config/x402/manifests/mevShield.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const mevShieldManifest: ServiceManifest = {
  id: 'arc-mempool-mev-shield',
  version: '1.0.0',
  name: 'Mempool MEV Shield Simulator',
  tagline: 'Measures How Much of the Arc Pool a Pending Trade Would Move',
  category: 'MEV & Security',
  engine: 'native',
  description: 'Measures a pending trade against the live reserve of the side it drains in the Arc pool it would trade through — USDC/EURC, USDC/WETH, USDC/cirBTC or EURC/WETH — and classifies its sandwich exposure. The sold token’s reserve is valued in USDC with live oracle prices. The result is advisory: this service neither submits a bundle nor provides private relay or transaction protection.',
  listing: {
    kind: 'official',
    ownerAddress: '0x5407d034bf3ed112646252AfA7A76c5E3d18CE4B',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'ArcGuard Security Labs',
    address: '0x5407d034bf3ed112646252AfA7A76c5E3d18CE4B',
    isVerified: true,
    reputationScore: 98,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.004,
    maxAmountUsdc: 0.004,
    protocolFeeBps: 50,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: '0x5407d034bf3ed112646252AfA7A76c5E3d18CE4B',
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
    additionalProperties: false,
    required: ['targetTxAmountUsdc', 'slippageTolerancePct'],
    properties: {
      pair: {
        type: 'string',
        enum: ['USDC/EURC', 'USDC/WETH', 'USDC/cirBTC', 'EURC/WETH'],
      },
      tokenIn: {
        type: 'string',
        enum: ['pair-first', 'USDC', 'EURC', 'WETH', 'cirBTC'],
        description:
          'Token the trade sells into the pool. \'pair-first\' (default) sells the pair’s first token; anything else must be one of the pair’s two tokens.',
      },
      targetTxAmountUsdc: { type: 'number', minimum: 1 },
      slippageTolerancePct: { type: 'number', minimum: 0.01 },
    },
  },
  ui: {
    form: [
      {
        name: 'pair',
        label: 'Trading Pair',
        type: 'select',
        defaultValue: 'USDC/EURC',
        options: [
          { label: 'USDC / EURC (StableSwap)', value: 'USDC/EURC' },
          { label: 'USDC / WETH (Constant Product)', value: 'USDC/WETH' },
          { label: 'USDC / cirBTC (Constant Product)', value: 'USDC/cirBTC' },
          { label: 'EURC / WETH (Constant Product)', value: 'EURC/WETH' },
        ],
        description:
          'Pool the pending trade would move; exposure is measured against the reserve of the side the trade drains.',
        required: true,
      },
      {
        name: 'tokenIn',
        label: 'Token Sold (tokenIn)',
        type: 'select',
        defaultValue: 'pair-first',
        options: [
          { label: 'Auto — first token of the pair', value: 'pair-first' },
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WETH', value: 'WETH' },
          { label: 'cirBTC', value: 'cirBTC' },
        ],
        description:
          'Token the trade sells into the pool. Exposure is measured against that token’s reserve — its live USDC value when it is not USDC. \'Auto\' sells the pair’s first token; an explicit token must belong to the selected pair.',
        required: false,
      },
      {
        name: 'targetTxAmountUsdc',
        label: 'Transaction Value (USDC)',
        type: 'number',
        defaultValue: 100000,
        description:
          'Transaction size to evaluate for MEV exposure, as a USDC notional (the size measure for every pair, including EURC/WETH).',
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
      pair: 'USDC/EURC',
      tokenIn: 'USDC',
      targetTxAmountUsdc: 100000,
      slippageTolerancePct: 0.5,
    },
    response: {
      status: 'ANALYSIS_COMPLETE',
      pair: 'USDC/EURC',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      poolAddress: '0xC3EdDA15AdfaC31ADfC23aC86dC96d791f72bE8a',
      poolReserveUsdc: 1400000,
      vulnerabilityLevel: 'HIGH_IF_UNPROTECTED',
      // Real ratio of the user's trade size to the on-chain USDC pool reserve; null with
      // status 'UNAVAILABLE' when that reserve read fails.
      tradeReserveExposurePct: 7.14,
      recommendedShieldAction: {
        bundleType: 'Advisory only — no bundle is submitted',
        adjustedMaxSlippagePct: 0.5,
        estimatedGasCostUsdc: 0.0084,
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
  tags: ['MEV-Shield', 'Security', 'Frontrunning', 'Private-RPC'],
}
