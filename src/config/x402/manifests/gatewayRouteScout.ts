// src/config/x402/manifests/gatewayRouteScout.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import { ROUTE_SCOUT_DESTINATIONS } from '../routeScoutChains'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

const PROVIDER_ADDRESS = '0x522fAf9A91c41c443c66765030741e4AaCe147D0'

export const gatewayRouteScoutManifest: ServiceManifest = {
  id: 'arc-gateway-fee-route-scout',
  version: '1.0.0',
  name: 'Gateway vs CCTP Route Scout',
  tagline: 'Compare Circle Gateway and CCTP Fees for One Route Before You Bridge',
  category: 'Cross-Chain Gateway',
  engine: 'native',
  description:
    'Simultaneously quotes and compares Circle Gateway and CCTP forwarding rails on Arc Testnet, identifying the lowest fee and fastest transfer path.',
  listing: {
    kind: 'official',
    ownerAddress: PROVIDER_ADDRESS,
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arcis Gateway Routing Desk',
    address: PROVIDER_ADDRESS,
    isVerified: true,
    reputationScore: 98,
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
      payTo: PROVIDER_ADDRESS,
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
    path: '/api/x402/arc-gateway-fee-route-scout',
  },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['amountUsdc', 'destinationChain', 'urgency'],
    properties: {
      amountUsdc: { type: 'number', minimum: 1 },
      destinationChain: { type: 'string', enum: [...ROUTE_SCOUT_DESTINATIONS] },
      urgency: { type: 'string', enum: ['standard', 'fast'] },
    },
  },
  ui: {
    form: [
      {
        name: 'amountUsdc',
        label: 'Amount to Bridge (USDC)',
        type: 'number',
        defaultValue: 100,
        description: 'Amount the recipient should receive on the destination chain.',
        required: true,
      },
      {
        name: 'destinationChain',
        label: 'Destination Chain',
        type: 'select',
        defaultValue: 'Ethereum_Sepolia',
        options: ROUTE_SCOUT_DESTINATIONS.map((chain) => ({ label: chain.replace(/_/g, ' '), value: chain })),
        description: 'Circle Gateway and CCTP destination to quote.',
        required: true,
      },
      {
        name: 'urgency',
        label: 'Urgency',
        type: 'select',
        defaultValue: 'standard',
        options: [
          { label: 'Standard finality', value: 'standard' },
          { label: 'Fast (CCTP fast fee)', value: 'fast' },
        ],
        description: 'CCTP finality threshold to price; Gateway has a single transfer fee.',
        required: true,
      },
    ],
  },
  examples: {
    request: {
      amountUsdc: 100,
      destinationChain: 'Base_Sepolia',
      urgency: 'standard',
    },
    // Shape only: status 'EXAMPLE' and every quoted field null. A live call carries
    // status QUOTE_READY / PARTIAL / UNAVAILABLE and the readAt time of the quotes.
    response: {
      status: 'EXAMPLE',
      amountUsdc: 100,
      destinationChain: 'Base_Sepolia',
      destinationDomain: null,
      urgency: 'standard',
      recommendedRail: null,
      savingsUsdc: null,
      estimatedArrivalMs: null,
      gateway: {
        available: false,
        feeUsdc: null,
        feeBps: 5,
        maxFeeCeilingUsdc: null,
        sourceGasUsdc: null,
        totalCostUsdc: null,
        feeSource: "Circle Gateway's 0.005% transfer fee",
      },
      cctp: {
        available: false,
        feeUsdc: null,
        feeBps: null,
        protocolFeeUsdc: null,
        forwardFeeUsdc: null,
        sourceGasUsdc: null,
        totalCostUsdc: null,
        finalityThreshold: null,
        feeSource: 'Circle Iris CCTP fee endpoint',
      },
      unavailable: ['both rails'],
      readAt: null,
      note: 'Illustrative shape only — no quote was taken.',
    },
  },
  sla: {
    p95LatencyMs: 4000,
    uptimePct: 99.5,
    successRate: 99.5,
  },
  healthcheckUrl: '/api/x402/health/arc-gateway-fee-route-scout',
  agentPrompts: [
    'Is Circle Gateway or CCTP cheaper to move 100 USDC from Arc to Base Sepolia?',
    'Quote the CCTP fast fee for an Arc to Ethereum Sepolia transfer',
  ],
  tags: ['Gateway', 'CCTP', 'Fees', 'Route-Optimizer'],
}
