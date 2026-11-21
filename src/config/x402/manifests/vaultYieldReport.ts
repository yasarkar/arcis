// src/config/x402/manifests/vaultYieldReport.ts
import type { ServiceManifest } from '../../../types/x402.js'
import { ARC_TESTNET_TOKENS } from '../../arcChain.js'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes.js'

const PROVIDER_ADDRESS = '0x9482Ac02f0B0F3Ac9443Bf38e78fC3A360049f5E'

export const vaultYieldReportManifest: ServiceManifest = {
  id: 'arc-vault-yield-tax-report',
  version: '1.1.0',
  name: 'Yield, LP Fees & Position Statement (AI)',
  tagline: 'Vault Principal, Accrued Yield & All 6 LP Pool Fees Explained by AI + CSV/JSON Export',
  category: 'Reporting & Tax',
  engine: 'llm',
  description:
    'Measures your on-chain Arc USDC Yield Vault principal and pending yield plus all 6 Arc V4 AMM LP positions and harvestable swap fees, then generates an AI-narrated statement with CSV/JSON export.',
  listing: {
    kind: 'official',
    ownerAddress: PROVIDER_ADDRESS,
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arcis Reporting Desk',
    address: PROVIDER_ADDRESS,
    isVerified: true,
    reputationScore: 96,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.012,
    maxAmountUsdc: 0.012,
    protocolFeeBps: 50,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: PROVIDER_ADDRESS,
      amount: '12000',
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
    path: '/api/x402/arc-vault-yield-tax-report',
  },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['address'],
    properties: {
      address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
    },
  },
  ui: {
    form: [
      {
        name: 'address',
        label: 'Wallet Address',
        type: 'string',
        defaultValue: '0x0000000000000000000000000000000000000000',
        description: 'Public Arc address whose vault position is measured.',
        required: true,
      },
    ],
  },
  examples: {
    request: { address: '0x0000000000000000000000000000000000000000' },
    response: {
      status: 'EXAMPLE',
      address: '0x0000000000000000000000000000000000000000',
      vaultAddress: '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A',
      measured: {
        shares: null,
        shareDecimals: 9,
        currentValueUsdc: null,
        principalUsdc: null,
        pendingYieldUsdc: null,
        unrealizedYieldUsdc: null,
        vaultTotalAssetsUsdc: null,
        sharePriceUsdc: null,
      },
      narrative: null,
      model: null,
      usage: null,
      readAt: null,
      unavailable: [],
      limitations: [],
      note: 'Illustrative shape only — no vault read and no model call were made.',
    },
  },
  sla: {
    p95LatencyMs: 12000,
    uptimePct: 99.2,
    successRate: 99.2,
  },
  healthcheckUrl: '/api/x402/health/arc-vault-yield-tax-report',
  agentPrompts: [
    'Summarise this wallet’s vault yield position for my records',
    'What does my vault principal and redeemable value look like?',
  ],
  tags: ['Reporting', 'Yield-Audit', 'Tax', 'Accounting'],
}
