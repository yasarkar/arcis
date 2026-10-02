// src/config/x402/manifests/gatewayIndexer.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const gatewayIndexerManifest: ServiceManifest = {
  id: 'arc-cross-chain-gateway-flow-indexer',
  version: '1.0.0',
  name: 'Cross-Chain Gateway Flow Indexer',
  tagline: 'Real-Time Institutional USDC Liquidity Migration Flowing into Arc L1 from 13+ Chains',
  category: 'Cross-Chain Gateway',
  engine: 'native',
  description: 'Tracks real-time net USDC inflows and outflows between Circle Gateway-supported chains (Ethereum, Base, Arbitrum, Solana) and Arc L1. Delivers early signals on institutional capital movements and whale migrations.',
  listing: {
    kind: 'official',
    ownerAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Circle Gateway Analytics Collective',
    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    isVerified: true,
    reputationScore: 99,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.003,
    maxAmountUsdc: 0.003,
    protocolFeeBps: 0,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
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
    method: 'GET',
    path: '/api/x402/arc-cross-chain-gateway-flow-indexer',
  },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['timeWindow'],
    properties: {
      timeWindow: {
        type: 'string',
        enum: ['1h', '24h', '7d'],
      },
    },
  },
  ui: {
    form: [
      {
        name: 'timeWindow',
        label: 'Time Window',
        type: 'select',
        defaultValue: '1h',
        options: [
          { label: 'Past 1 Hour', value: '1h' },
          { label: 'Past 24 Hours', value: '24h' },
          { label: 'Past 7 Days', value: '7d' },
        ],
        description: 'Timeframe window to analyze.',
        required: true,
      },
    ],
  },
  examples: {
    request: {
      timeWindow: '1h',
    },
    // Shape only, and it says so: `status` is 'EXAMPLE' and every measured field is null.
    // A real response reads the Circle Gateway contracts on Arc L1 (GatewayMinter.AttestationUsed
    // for inflow, GatewayWallet.GatewayBurned for outflow) and reports `status` as LIVE / STALE /
    // UNAVAILABLE together with the `readAt` time it was read; when the read yields nothing the
    // service says so with its read time instead of substituting a number.
    response: {
      status: 'EXAMPLE',
      source:
        'Circle Gateway contracts on Arc L1: GatewayMinter.AttestationUsed + GatewayWallet.GatewayBurned logs',
      readAt: null,
      ageSeconds: null,
      timeWindow: '1h',
      requestedWindowSeconds: 3600,
      grossInflowUsdc: null,
      grossOutflowUsdc: null,
      netUsdcInflowUsdc: null,
      transferCount: null,
      whaleTransferCount: null,
      topSourceChains: [{ chain: '<resolved from AttestationUsed.sourceDomain>', domain: null, inflowUsdc: null, sharePct: null }],
      flowDirection: null,
      window: {
        fromBlock: null,
        toBlock: null,
        scannedBlocks: null,
        requestedSeconds: 3600,
        secondsPerBlock: null,
        coveredSeconds: null,
        partialWindow: null,
      },
      note: 'Illustrative shape only — no measurement was taken. A real response carries status LIVE (or STALE / UNAVAILABLE) and the readAt time of the on-chain read.',
    },
  },
  sla: {
    p95LatencyMs: 130,
    uptimePct: 99.85,
    successRate: 99.85,
  },
  healthcheckUrl: '/api/x402/health/arc-cross-chain-gateway-flow-indexer',
  agentPrompts: [
    'Track institutional USDC flows into Arc over the last 24 hours',
    'Which chain is bridging the most liquidity to Arc right now?',
  ],
  tags: ['Gateway', 'Cross-Chain', 'Whale Alert', 'Indexer'],
}
