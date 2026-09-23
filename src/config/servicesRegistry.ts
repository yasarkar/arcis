// src/config/servicesRegistry.ts
// Arc Arbitrage and Liquidity x402 AI Services Catalog & Configuration

import type { x402Service, MarketplaceStats } from '../types/marketplace'

export const MARKETPLACE_STATS: MarketplaceStats = {
  totalCallsProcessed: 0,
  totalVolumeUsdc: 0.00,
  totalYieldGeneratedUsdc: 0.00,
  averageResponseTimeMs: 120,
  activeServicesCount: 5,
  savedSubscriptionCostUsd: 0.00,
}

export const ARC_SERVICES_REGISTRY: x402Service[] = [
  {
    id: 'arc-cross-dex-arbitrage-sentinel',
    name: 'Arc Cross-DEX Arbitrage Sentinel',
    tagline: 'Calculates Real-Time Price Spreads and Net Profit Across Arc L1 DEX Pools',
    category: 'Arbitrage',
    description: 'Detects arbitrage cycles across Arc L1 Uniswap v3, Curve, and Aerodrome forks alongside external CEX/Gateway bridges in milliseconds. Returns estimated gross profit, gas costs (USDC), and net yield percentage.',
    priceUsdc: 0.005,
    latencyMs: 125,
    successRate: 99.9,
    endpointUrl: 'https://api.arcis.finance/v1/alpha/arbitrage-sentinel',
    method: 'POST',
    tags: ['Arbitrage', 'DEX Spreads', 'Flash-Exec', 'Alpha'],
    provider: {
      name: 'Arc Alpha Labs & Quantitative AI',
      address: '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A',
      isVerified: true,
      reputationScore: 99,
    },
    paymentScheme: 'GatewayWalletBatched',
    supportedChains: ['Arc Testnet (5042002)', 'Circle Gateway'],
    inputParameters: [
      {
        name: 'pair',
        label: 'Token Pair',
        type: 'select',
        defaultValue: 'USDC/WETH',
        options: [
          { label: 'USDC / WETH', value: 'USDC/WETH' },
          { label: 'USDC / WBTC', value: 'USDC/WBTC' },
          { label: 'USDC / EURC', value: 'USDC/EURC' },
          { label: 'af-USDC / USDC (Vault Peg)', value: 'af-USDC/USDC' },
        ],
        description: 'Primary liquidity pair to scan.',
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
    sampleRequestPayload: {
      pair: 'USDC/WETH',
      tradeSizeUsdc: 25000,
      minNetProfitPct: 0.35,
      includeGasCostEstimate: true,
    },
    sampleResponseData: {
      status: 'OPPORTUNITY_DETECTED',
      timestamp: Date.now(),
      pair: 'USDC/WETH',
      bestRoute: {
        buyDex: 'ArcSwap V3 (Pool 0.05%)',
        buyPriceUsdc: 2842.10,
        sellDex: 'Aerodrome Arc Fork (Pool 0.3%)',
        sellPriceUsdc: 2864.80,
        grossSpreadPct: 0.798,
        recommendedTradeSize: 25000,
        estimatedGasCostUsdc: 0.0084,
        netProfitUsdc: 199.25,
        netProfitPct: 0.797,
        confidenceScore: 0.984,
        executionCalldataHex: '0x522faf9a0000000000000000000000003600000000000000000000000000000000000000...',
      },
      secondaryOpportunities: [
        {
          buyDex: 'Arc Curve StableSwap',
          sellDex: 'ArcSwap V3',
          grossSpreadPct: 0.28,
          netProfitUsdc: 69.40,
        },
      ],
      mempoolRisk: 'LOW_MEV_THREAT',
    },
  },
  {
    id: 'arc-deep-liquidity-slippage-optimizer',
    name: 'Deep Liquidity Depth & Slippage Predictor',
    tagline: 'Lowest Slippage and Multi-Hop Routing for High-Volume Trades',
    category: 'Liquidity & Routing',
    description: 'Analyzes concentrated liquidity depth across all Arc L1 pools to calculate price impact with 0.01% precision and optimal split-order distribution for trades from $10K to $5M.',
    priceUsdc: 0.002,
    latencyMs: 95,
    successRate: 99.95,
    endpointUrl: 'https://api.arcis.finance/v1/liquidity/slippage-optimizer',
    method: 'POST',
    tags: ['Liquidity', 'Slippage', 'Multi-Hop', 'Smart Routing'],
    provider: {
      name: 'Arcis Core Routing Engine',
      address: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
      isVerified: true,
      reputationScore: 100,
    },
    paymentScheme: 'GatewayWalletBatched',
    supportedChains: ['Arc Testnet (5042002)', 'Circle Gateway'],
    inputParameters: [
      {
        name: 'fromToken',
        label: 'Sell Token',
        type: 'select',
        defaultValue: 'USDC',
        options: [
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WETH', value: 'WETH' },
          { label: 'af-USDC (Yield Vault)', value: 'af-USDC' },
        ],
        description: 'Source asset to swap.',
        required: true,
      },
      {
        name: 'toToken',
        label: 'Buy Token',
        type: 'select',
        defaultValue: 'WETH',
        options: [
          { label: 'WETH', value: 'WETH' },
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WBTC', value: 'WBTC' },
        ],
        description: 'Target destination asset.',
        required: true,
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'number',
        defaultValue: 50000,
        description: 'Token amount to swap.',
        required: true,
      },
    ],
    sampleRequestPayload: {
      fromToken: 'USDC',
      toToken: 'WETH',
      amount: 50000,
      maxSplitParts: 3,
    },
    sampleResponseData: {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: '50000 USDC',
      expectedOutput: '17.5842 WETH',
      effectiveExecutionPrice: 2843.46,
      overallPriceImpactPct: 0.042,
      savedVsSinglePoolUsdc: 384.20,
      splitExecutionDistribution: [
        { pool: 'ArcSwap V3 USDC/WETH (0.05%)', allocationPct: 65, amountUsdc: 32500, priceImpact: 0.024 },
        { pool: 'Aerodrome Arc USDC/WETH (0.3%)', allocationPct: 35, amountUsdc: 17500, priceImpact: 0.038 },
      ],
      flashReserveDepthUsdc: 14200000,
      settlementTimeEstimateMs: 380,
    },
  },
  {
    id: 'arc-flash-loan-yield-radar',
    name: 'Flash-Loan Yield & Liquidation Radar',
    tagline: 'Identifies Zero-Capital Flash-Loan Arbitrage and Liquidation Premiums',
    category: 'Yield & Flash-Loan',
    description: 'Monitors undercollateralized positions and flash-loan arbitrage opportunities across Arc lending protocols (Aave / Compound Arc L1 forks). Generates execution calldata to capture 5% - 12% liquidation bonuses with zero capital risk.',
    priceUsdc: 0.008,
    latencyMs: 160,
    successRate: 99.7,
    endpointUrl: 'https://api.arcis.finance/v1/yield/flash-loan-radar',
    method: 'POST',
    tags: ['Flash-Loan', 'Liquidations', 'Zero-Capital', 'Yield'],
    provider: {
      name: 'Arc Quantum Arbitrage DAO',
      address: '0x9482Ac02f0B0F3Ac9443Bf38e78fC3A360049f5E',
      isVerified: true,
      reputationScore: 96,
    },
    paymentScheme: 'GatewayWalletBatched',
    supportedChains: ['Arc Testnet (5042002)', 'Circle Gateway'],
    inputParameters: [
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
    sampleRequestPayload: {
      minLiquidationRewardUsdc: 100,
      targetProtocol: 'All',
    },
    sampleResponseData: {
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
          netExpectedProfitUsdc: 3360.00,
          requiredFlashLoanUsdc: 42000,
          flashLoanFeeUsdc: 21.00,
          executableTxPayload: '0xab4281f0...',
        },
      ],
    },
  },
  {
    id: 'arc-mempool-mev-shield',
    name: 'Arc Mempool & MEV Shield Simulator',
    tagline: 'Pre-Simulates Sandwich Attacks and Frontrunning Risks for Pending Transactions',
    category: 'MEV & Security',
    description: 'Simulates pending high-volume transactions against malicious mempool MEV bots. Provides 100% protection through Arc L1 priority gas optimizations and private RPC relayer routes.',
    priceUsdc: 0.004,
    latencyMs: 110,
    successRate: 99.98,
    endpointUrl: 'https://api.arcis.finance/v1/security/mev-shield',
    method: 'POST',
    tags: ['MEV', 'Security', 'Anti-Sandwich', 'Simulation'],
    provider: {
      name: 'ArcGuard Security Labs',
      address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      isVerified: true,
      reputationScore: 98,
    },
    paymentScheme: 'GatewayWalletBatched',
    supportedChains: ['Arc Testnet (5042002)'],
    inputParameters: [
      {
        name: 'targetTxAmountUsdc',
        label: 'Transaction Value (USDC)',
        type: 'number',
        defaultValue: 100000,
        description: 'Transaction size to evaluate for MEV exposure.',
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
    sampleRequestPayload: {
      targetTxAmountUsdc: 100000,
      slippageTolerancePct: 0.5,
    },
    sampleResponseData: {
      status: 'ANALYSIS_COMPLETE',
      vulnerabilityLevel: 'HIGH_IF_UNPROTECTED',
      detectedActiveMevBotsCount: 6,
      potentialLossWithoutShieldUsdc: 450.80,
      recommendedShieldAction: {
        bundleType: 'Flashbots/ArcPrivateRelayer',
        adjustedMaxSlippagePct: 0.08,
        mevProtectionScore: '100% SECURE',
        relayerSubmissionUrl: 'https://relayer.arcis.finance/v1/private-tx',
      },
    },
  },
  {
    id: 'arc-cross-chain-gateway-flow-indexer',
    name: 'Cross-Chain Gateway Flow Indexer',
    tagline: 'Real-Time Institutional USDC Liquidity Migration Flowing into Arc L1 from 13+ Chains',
    category: 'Cross-Chain Gateway',
    description: 'Tracks real-time net USDC inflows and outflows between Circle Gateway-supported chains (Ethereum, Base, Arbitrum, Solana) and Arc L1. Delivers early signals on institutional capital movements and whale migrations.',
    priceUsdc: 0.003,
    latencyMs: 130,
    successRate: 99.85,
    endpointUrl: 'https://api.arcis.finance/v1/indexer/gateway-flow',
    method: 'GET',
    tags: ['Gateway', 'Cross-Chain', 'Whale Alert', 'Indexer'],
    provider: {
      name: 'Circle Gateway Analytics Collective',
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      isVerified: true,
      reputationScore: 99,
    },
    paymentScheme: 'GatewayWalletBatched',
    supportedChains: ['Arc Testnet (5042002)', 'Circle Gateway'],
    inputParameters: [
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
    sampleRequestPayload: {
      timeWindow: '1h',
    },
    sampleResponseData: {
      status: 'FEED_ACTIVE',
      timeWindow: '1h',
      netUsdcInflowToArc: '+4,820,500 USDC',
      topSourceChains: [
        { chain: 'Ethereum Mainnet/Sepolia', inflowUsdc: 2450000, sharePct: 50.8 },
        { chain: 'Base', inflowUsdc: 1320500, sharePct: 27.4 },
        { chain: 'Arbitrum', inflowUsdc: 850000, sharePct: 17.6 },
        { chain: 'Solana Devnet', inflowUsdc: 200000, sharePct: 4.2 },
      ],
      institutionalWhaleTransfersCount: 14,
      flowSentiment: 'STRONG_BULLISH_LIQUIDITY_ACCUMULATION',
    },
  },
]

// Helper functions for code generation
export function generateCurlCode(service: x402Service, payload: Record<string, any>): string {
  const dataString = JSON.stringify(payload, null, 2)
  return `# 1. Step: Unpaid Probe (Returns HTTP 402 + Payment Requirements)
curl -i -X ${service.method} "${service.endpointUrl}" \\
  -H "Content-Type: application/json"

# 2. Step: x402 Authorized Call (Nanopayment Settled via Gateway / Arc L1)
curl -X ${service.method} "${service.endpointUrl}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: x402-Gateway-V1 payer=0xYOUR_WALLET,amount=${service.priceUsdc},sig=0xSIGNATURE" \\
  -d '${dataString}'`
}

export function generateTypescriptCode(service: x402Service, payload: Record<string, any>): string {
  return `import { createPublicClient, http } from 'viem'

// Arcis x402 Client Execution
async function call${service.name.replace(/[^a-zA-Z0-9]/g, '')}() {
  const endpoint = "${service.endpointUrl}";
  const payload = ${JSON.stringify(payload, null, 2)};

  // 1. Send Probe
  const probe = await fetch(endpoint, {
    method: "${service.method}",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (probe.status === 402) {
    const paymentHeader = probe.headers.get("x-payment-amount"); // "${service.priceUsdc} USDC"
    console.log("⚡ 402 Challenge received. Signing nanopayment of ${service.priceUsdc} USDC...");
    
    // 2. Sign Nanopayment off-chain & execute
    const res = await fetch(endpoint, {
      method: "${service.method}",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer x402_signed_gateway_token"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("✨ Response received in <150ms:", data);
    return data;
  }
}

call${service.name.replace(/[^a-zA-Z0-9]/g, '')}();`
}

export function generatePythonCode(service: x402Service, payload: Record<string, any>): string {
  return `import requests
import json

# Arcis x402 Nanopayment LangChain / Python Tool Integration
def execute_${service.id.replace(/-/g, '_')}():
    url = "${service.endpointUrl}"
    headers = {
        "Content-Type": "application/json",
        "X-Payer-Address": "0xYourArcWalletAddress",
        "X-Max-USDC-Budget": "${service.priceUsdc}"
    }
    payload = ${JSON.stringify(payload, null, 4)}

    # Send Request with automatic Gateway Nanopayments settlement
    response = requests.post(url, headers=headers, json=payload)
    
    if response.status_code == 200:
        alpha_data = response.json()
        print("✅ Received Alpha Data from Arcis x402 Hub:")
        print(json.dumps(alpha_data, indent=2))
        return alpha_data
    else:
        print(f"Error {response.status_code}: {response.text}")

if __name__ == "__main__":
    execute_${service.id.replace(/-/g, '_')}()`
}
