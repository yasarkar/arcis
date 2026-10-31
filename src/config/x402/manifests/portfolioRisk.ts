// src/config/x402/manifests/portfolioRisk.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

const PROVIDER_ADDRESS = '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A'

export const portfolioRiskManifest: ServiceManifest = {
  id: 'arc-portfolio-risk-exposure',
  version: '1.0.0',
  name: 'Portfolio Risk & Exposure Engine',
  tagline: 'On-Chain Arc Token Exposure, Concentration and Stablecoin Share',
  category: 'Risk & Compliance',
  engine: 'native',
  description:
    'Computes multi-asset token exposure, concentration metrics, and stablecoin proportions across Arc L1 and Circle Gateway unified balances, and issues them as an institutional report: read coverage, a data-quality grade, and a severity-graded risk register carrying evidence, threshold and remediation per finding.',
  listing: {
    kind: 'official',
    ownerAddress: PROVIDER_ADDRESS,
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arcis Risk Desk',
    address: PROVIDER_ADDRESS,
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
      payTo: PROVIDER_ADDRESS,
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
    path: '/api/x402/arc-portfolio-risk-exposure',
  },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['address'],
    properties: {
      address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      includeGatewayBalance: { type: 'boolean' },
    },
  },
  ui: {
    form: [
      {
        name: 'address',
        label: 'Wallet Address',
        type: 'string',
        defaultValue: '0x0000000000000000000000000000000000000000',
        description: 'Public Arc address whose token balances are read. No signature is requested.',
        required: true,
      },
      {
        name: 'includeGatewayBalance',
        label: 'Include Gateway Balance',
        type: 'boolean',
        defaultValue: false,
        description: 'Adds the Circle Gateway unified USDC balance read from Circle’s balance API.',
      },
    ],
  },
  examples: {
    request: {
      address: '0x0000000000000000000000000000000000000000',
      includeGatewayBalance: true,
    },
    response: {
      status: 'EXAMPLE',
      address: '0x0000000000000000000000000000000000000000',
      totalUsd: null,
      concentrationPct: null,
      stablecoinSharePct: null,
      holdings: [
        { symbol: 'USDC', balance: null, valueUsd: null, stablecoin: true },
      ],
      gatewayBalanceUsdc: null,
      chainExposure: [],
      riskFlags: [],
      readAt: null,
      unavailable: [],
      note: 'Illustrative shape only — no balance was read.',
    },
  },
  sla: {
    p95LatencyMs: 2500,
    uptimePct: 99.6,
    successRate: 99.6,
  },
  healthcheckUrl: '/api/x402/health/arc-portfolio-risk-exposure',
  agentPrompts: [
    'How concentrated is this Arc wallet’s stablecoin exposure?',
    'Include the Gateway balance in this portfolio risk report',
  ],
  tags: ['Portfolio', 'Risk-Engine', 'Exposure', 'Compliance'],
}
