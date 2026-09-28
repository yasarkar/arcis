// src/config/x402/manifests/flashLoanRadar.ts
import type { ServiceManifest } from '../../../types/x402'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_BATCHED_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../schemes'

export const flashLoanRadarManifest: ServiceManifest = {
  id: 'arc-flash-loan-yield-radar',
  version: '1.0.0',
  name: 'Flash-Loan Yield & Liquidation Radar',
  tagline: 'Identifies Zero-Capital Flash-Loan Arbitrage and Liquidation Premiums',
  category: 'Yield & Flash-Loan',
  engine: 'native',
  description: 'Monitors undercollateralized positions and flash-loan arbitrage opportunities across Arc lending protocols (Aave / Compound Arc L1 forks). Generates execution calldata to capture 5% - 12% liquidation bonuses with zero capital risk.',
  listing: {
    kind: 'official',
    ownerAddress: '0x9482Ac02f0B0F3Ac9443Bf38e78fC3A360049f5E',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arc Quantum Arbitrage DAO',
    address: '0x9482Ac02f0B0F3Ac9443Bf38e78fC3A360049f5E',
    isVerified: true,
    reputationScore: 96,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.008,
    maxAmountUsdc: 0.015,
    protocolFeeBps: 100,
  },
  accepts: [
    {
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.ARC_TESTNET,
      asset: 'USDC',
      payTo: '0x9482Ac02f0B0F3Ac9443Bf38e78fC3A360049f5E',
      amount: '8000',
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
    path: '/api/x402/arc-flash-loan-yield-radar',
  },
  requestSchema: {
    type: 'object',
    required: ['minLiquidationRewardUsdc'],
    properties: {
      minLiquidationRewardUsdc: { type: 'number', minimum: 1 },
      targetProtocol: { type: 'string' },
    },
  },
  ui: {
    form: [
      {
        name: 'minLiquidationRewardUsdc',
        label: 'Min. Liquidation Reward (USDC)',
        type: 'number',
        defaultValue: 100,
        description: 'Minimum net liquidation revenue threshold.',
        required: true,
      },
      {
        name: 'targetProtocol',
        label: 'Target Lending Protocol',
        type: 'select',
        defaultValue: 'All',
        options: [
          { label: 'All Arc Lending Protocols', value: 'All' },
          { label: 'ArcLend (Aave v3 Fork)', value: 'ArcLend' },
          { label: 'ArcCompound Core', value: 'ArcCompound' },
        ],
        description: 'Target lending protocol to monitor.',
        required: false,
      },
    ],
  },
  examples: {
    request: {
      minLiquidationRewardUsdc: 100,
      targetProtocol: 'All',
    },
    response: {
      status: 'LIQUIDATIONS_FOUND',
      activeOpportunitiesCount: 2,
      opportunities: [
        {
          protocol: 'ArcLend V3',
          borrowerAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          healthFactor: 0.942,
          debtAsset: 'USDC',
          debtToCoverUsdc: 42000,
          collateralAsset: 'WETH',
          collateralAmount: '16.24 WETH',
          liquidationBonusPct: 8.0,
          netExpectedProfitUsdc: 3360.0,
        },
      ],
    },
  },
  sla: {
    p95LatencyMs: 160,
    uptimePct: 99.7,
    successRate: 99.7,
  },
  healthcheckUrl: '/api/x402/health/arc-flash-loan-yield-radar',
  agentPrompts: [
    'Check for liquidation opportunities on Arc lending pools',
    'Calculate flash loan profit for undercollateralized loans',
  ],
  tags: ['Flash-Loan', 'Liquidations', 'Zero-Capital', 'Yield'],
}
