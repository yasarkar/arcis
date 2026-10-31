// src/config/x402/manifests/vaultAnalytics.ts
import type { ServiceManifest } from '../../../types/x402'
import { ARC_TESTNET_TOKENS } from '../../arcChain'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

const PROVIDER_ADDRESS = '0x9482Ac02f0B0F3Ac9443Bf38e78fC3A360049f5E'

export const vaultAnalyticsManifest: ServiceManifest = {
  id: 'arc-yield-vault-analytics',
  version: '1.0.0',
  name: 'USDC Yield Vault Analytics',
  tagline: 'Live ERC-4626 TVL and Share Price for the Arc Yield Vault',
  category: 'Yield & Flash-Loan',
  engine: 'native',
  description:
    'Delivers real-time on-chain reads of Arc ERC-4626 USDC Yield Vault reserves, total TVL, and computed share value with verified accounting precision. Each response is an institutional report with read coverage, freshness, a data-quality grade and explicitly graded findings.',
  listing: {
    kind: 'official',
    ownerAddress: PROVIDER_ADDRESS,
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arcis Vault Analytics',
    address: PROVIDER_ADDRESS,
    isVerified: true,
    reputationScore: 97,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.002,
    maxAmountUsdc: 0.002,
    protocolFeeBps: 50,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: PROVIDER_ADDRESS,
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
    path: '/api/x402/arc-yield-vault-analytics',
  },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['windowDays'],
    properties: {
      windowDays: { type: 'string', enum: ['7', '30', '90'] },
    },
  },
  ui: {
    form: [
      {
        name: 'windowDays',
        label: 'Observation Window',
        type: 'select',
        defaultValue: '30',
        options: [
          { label: '7 days', value: '7' },
          { label: '30 days', value: '30' },
          { label: '90 days', value: '90' },
        ],
        description:
          'Echoed back with the call. The vault exposes no historical series, so no window return or APY is computed.',
        required: true,
      },
    ],
  },
  examples: {
    request: { windowDays: '30' },
    response: {
      status: 'EXAMPLE',
      windowDays: 30,
      vaultAddress: '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A',
      totalAssetsUsdc: null,
      totalSupplyShares: null,
      sharePriceUsdc: null,
      tvlUsdc: null,
      shareDecimals: 9,
      readAt: null,
      unavailable: [],
      note: 'Illustrative shape only — no vault read was taken.',
    },
  },
  sla: {
    p95LatencyMs: 350,
    uptimePct: 99.8,
    successRate: 99.8,
  },
  healthcheckUrl: '/api/x402/health/arc-yield-vault-analytics',
  agentPrompts: [
    'What is the current TVL of the Arc USDC Yield Vault?',
    'How much USDC is one vault share worth right now?',
  ],
  tags: ['Vault', 'ERC-4626', 'TVL-Analytics', 'Yield'],
}
