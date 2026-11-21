// src/config/x402/manifests/vaultAnalytics.ts
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

export const vaultAnalyticsManifest: ServiceManifest = {
  id: 'arc-yield-vault-analytics',
  version: '1.1.0',
  name: 'Arc Yield & Pool Opportunity Finder',
  tagline: 'Compare All 6 Live Arc Pools & ERC-4626 Vault by TVL, 24h Volume & Your Balances',
  category: 'Yield & Flash-Loan',
  engine: 'native',
  description:
    'Scans all 6 deployed Arc L1 AMM pools and the ERC-4626 USDC Yield Vault live on-chain — reporting TVL, 24h swap volume, fee tiers, IL risk, vault share price, and optional wallet-balance matching in one institutional report.',
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
    required: ['riskPreference'],
    properties: {
      riskPreference: { type: 'string', enum: ['all', 'stable_only', 'volatile_only'] },
      walletAddress: { type: 'string', pattern: '^(|0x[a-fA-F0-9]{40})$' },
    },
  },
  ui: {
    form: [
      {
        name: 'riskPreference',
        label: 'Risk Profile',
        type: 'select',
        defaultValue: 'all',
        options: [
          { label: 'All Opportunities (Vault + 6 Pools)', value: 'all' },
          { label: 'Stablecoins & Vault Only (Zero / Low IL)', value: 'stable_only' },
          { label: 'Volatile Pairs Only (WETH / cirBTC)', value: 'volatile_only' },
        ],
        description: 'Filter which live Arc yield pools and vaults are ranked.',
        required: true,
      },
      {
        name: 'walletAddress',
        label: 'Wallet Address (Optional)',
        type: 'string',
        defaultValue: '',
        description: 'Optional 0x address to match opportunities against tokens your wallet already holds.',
        required: false,
      },
    ],
  },
  examples: {
    request: { riskPreference: 'all', walletAddress: '' },
    response: {
      status: 'EXAMPLE',
      riskPreference: 'all',
      walletAddress: null,
      vaultAddress: '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A',
      totalAssetsUsdc: null,
      totalSupplyShares: null,
      sharePriceUsdc: null,
      tvlUsdc: null,
      shareDecimals: 9,
      poolsScannedCount: 6,
      poolsMeasuredCount: 0,
      totalProtocolTvlUsd: null,
      opportunities: [],
      readAt: null,
      unavailable: [],
      note: 'Illustrative shape only — no on-chain pool or vault read was taken.',
    },
  },
  sla: {
    p95LatencyMs: 650,
    uptimePct: 99.8,
    successRate: 99.8,
  },
  healthcheckUrl: '/api/x402/health/arc-yield-vault-analytics',
  agentPrompts: [
    'Compare live TVL, 24h volume and fee tiers across all Arc pools and the USDC Yield Vault',
    'Which Arc yield pools match the tokens currently in my wallet?',
  ],
  tags: ['Yield-Finder', 'All-Pools', 'ERC-4626', 'TVL-Volume'],
}
