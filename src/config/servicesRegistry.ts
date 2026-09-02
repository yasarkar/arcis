// src/config/servicesRegistry.ts
// Arc Arbitraj ve Likidite x402 AI Hizmet Kataloğu & Yapılandırması

import type { x402Service, MarketplaceStats } from '../types/marketplace'

export const MARKETPLACE_STATS: MarketplaceStats = {
  totalCallsProcessed: 482914,
  totalVolumeUsdc: 2414.57,
  totalYieldGeneratedUsdc: 24.15, // 1% diverted to Real-Yield Vault
  averageResponseTimeMs: 142,
  activeServicesCount: 5,
  savedSubscriptionCostUsd: 144874.20, // compared to $50/mo API tiers
}

export const DEFAULT_DEMO_PAYER_ADDRESS = '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A'

export const ARC_SERVICES_REGISTRY: x402Service[] = [
  {
    id: 'arc-cross-dex-arbitrage-sentinel',
    name: 'Arc Cross-DEX Arbitrage Sentinel',
    tagline: 'Anlık Arc L1 DEX Havuzları Arasındaki Fiyat Farklarını ve Net Kârı Hesaplar',
    category: 'Arbitrage',
    description: 'Arc L1 üzerindeki Uniswap v3, Curve ve Aerodrome çatalları ile harici CEX/Gateway köprüleri arasındaki arbitraj döngülerini milisaniyeler içinde tespit eder. Tahmini brüt kâr, gas maliyeti (USDC) ve net getiri yüzdesini döner.',
    priceUsdc: 0.005,
    latencyMs: 125,
    successRate: 99.9,
    endpointUrl: 'https://api.arcflow.io/v1/alpha/arbitrage-sentinel',
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
        label: 'İşlem Çifti (Token Pair)',
        type: 'select',
        defaultValue: 'USDC/WETH',
        options: [
          { label: 'USDC / WETH', value: 'USDC/WETH' },
          { label: 'USDC / WBTC', value: 'USDC/WBTC' },
          { label: 'USDC / EURC', value: 'USDC/EURC' },
          { label: 'af-USDC / USDC (Vault Peg)', value: 'af-USDC/USDC' },
        ],
        description: 'Taranacak birincil likidite çifti.',
        required: true,
      },
      {
        name: 'tradeSizeUsdc',
        label: 'Sermaye Büyüklüğü (USDC)',
        type: 'number',
        defaultValue: 25000,
        description: 'Simüle edilecek takas büyüklüğü.',
        required: true,
      },
      {
        name: 'minNetProfitPct',
        label: 'Min. Net Kâr Eşiği (%)',
        type: 'number',
        defaultValue: 0.35,
        description: 'Sadece bu kâr oranının üzerindeki fırsatları filtrele.',
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
    tagline: 'Büyük Hacimli İşlemler İçin En Düşük Kayma (Slippage) ve Çok Adımlı Rotalama',
    category: 'Liquidity & Routing',
    description: 'Arc L1 üzerindeki tüm havuzların konsantre likidite derinliğini analiz ederek, $10K - $5M arası büyük hacimli takaslar için 0.01% hassasiyetle fiyat etkisini (price impact) ve en optimum parçalı emir dağılımını hesaplar.',
    priceUsdc: 0.002,
    latencyMs: 95,
    successRate: 99.95,
    endpointUrl: 'https://api.arcflow.io/v1/liquidity/slippage-optimizer',
    method: 'POST',
    tags: ['Liquidity', 'Slippage', 'Multi-Hop', 'Smart Routing'],
    provider: {
      name: 'ArcFlow Core Routing Engine',
      address: '0x522fAf9A91c41c443c66765030741e4AaCe147D0',
      isVerified: true,
      reputationScore: 100,
    },
    paymentScheme: 'GatewayWalletBatched',
    supportedChains: ['Arc Testnet (5042002)', 'Circle Gateway'],
    inputParameters: [
      {
        name: 'fromToken',
        label: 'Satılacak Token',
        type: 'select',
        defaultValue: 'USDC',
        options: [
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WETH', value: 'WETH' },
          { label: 'af-USDC (Yield Vault)', value: 'af-USDC' },
        ],
        description: 'Takas edilecek kaynak varlık.',
        required: true,
      },
      {
        name: 'toToken',
        label: 'Alınacak Token',
        type: 'select',
        defaultValue: 'WETH',
        options: [
          { label: 'WETH', value: 'WETH' },
          { label: 'USDC', value: 'USDC' },
          { label: 'EURC', value: 'EURC' },
          { label: 'WBTC', value: 'WBTC' },
        ],
        description: 'Hedef varlık.',
        required: true,
      },
      {
        name: 'amount',
        label: 'Miktar',
        type: 'number',
        defaultValue: 50000,
        description: 'Takas edilecek token miktarı.',
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
    tagline: 'Sermayesiz Flash-Loan Arbitrajı ve Tasfiye Primlerini Tespit Eder',
    category: 'Yield & Flash-Loan',
    description: 'Arc borç verme protokollerinde (Aave / Compound Arc L1 çatalları) teminat oranı kritik seviyeye inen pozisyonları ve anlık flash-loan arbitraj fırsatlarını izler. Sıfır sermaye riskiyle %5 - %12 tasfiye bonusu yakalama çağrı verisi üretir.',
    priceUsdc: 0.008,
    latencyMs: 160,
    successRate: 99.7,
    endpointUrl: 'https://api.arcflow.io/v1/yield/flash-loan-radar',
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
        label: 'Min. Tasfiye Ödülü (USDC)',
        type: 'number',
        defaultValue: 100,
        description: 'Taranacak minimum net tasfiye geliri.',
        required: true,
      },
      {
        name: 'targetProtocol',
        label: 'Hedef Kredi Protokolü',
        type: 'select',
        defaultValue: 'All',
        options: [
          { label: 'Tüm Arc Borç Verme Protokolleri', value: 'All' },
          { label: 'ArcLend (Aave v3 Fork)', value: 'ArcLend' },
          { label: 'ArcCompound Core', value: 'ArcCompound' },
        ],
        description: 'Taranacak borç protokolü.',
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
    tagline: 'Bekleyen İşlemlerde Sandwich Attack ve Frontrunning Riskini Önceden Analiz Eder',
    category: 'MEV & Security',
    description: 'Büyük boyutlu işlemlerin mempool üzerinde kötü niyetli MEV botları tarafından sandviçlenip sandviçlenmeyeceğini simüle eder. Arc L1 öncelikli gaz optimizasyonu ve özel RPC gizlilik rotaları ile %100 koruma sağlar.',
    priceUsdc: 0.004,
    latencyMs: 110,
    successRate: 99.98,
    endpointUrl: 'https://api.arcflow.io/v1/security/mev-shield',
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
        label: 'İşlem Tutarı (USDC)',
        type: 'number',
        defaultValue: 100000,
        description: 'MEV risk analizi yapılacak işlem büyüklüğü.',
        required: true,
      },
      {
        name: 'slippageTolerancePct',
        label: 'Slippage Toleransı (%)',
        type: 'number',
        defaultValue: 0.5,
        description: 'Ayarlanan maksimum kayma toleransı.',
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
        relayerSubmissionUrl: 'https://relayer.arcflow.io/v1/private-tx',
      },
    },
  },
  {
    id: 'arc-cross-chain-gateway-flow-indexer',
    name: 'Cross-Chain Gateway Flow Indexer',
    tagline: '13+ Ağdan Arc L1\'e Akan Kurumsal USDC Likidite Göçünü Anlık Raporlar',
    category: 'Cross-Chain Gateway',
    description: 'Ethereum, Base, Arbitrum, Solana ve diğer EVM ağlarından Circle Gateway aracılığıyla Arc L1 ekosistemine giren ve çıkan net USDC akışlarını dakikalık bazda analiz eder. Balina ve kurumsal sermaye hareketlerini önceden sinyaller.',
    priceUsdc: 0.003,
    latencyMs: 130,
    successRate: 99.85,
    endpointUrl: 'https://api.arcflow.io/v1/indexer/gateway-flow',
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
        label: 'Zaman Aralığı',
        type: 'select',
        defaultValue: '1h',
        options: [
          { label: 'Son 1 Saat', value: '1h' },
          { label: 'Son 24 Saat', value: '24h' },
          { label: 'Son 7 Gün', value: '7d' },
        ],
        description: 'İncelenecek zaman dilimi.',
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

// ArcFlow x402 Client Execution
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

# ArcFlow x402 Nanopayment LangChain / Python Tool Integration
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
        print("✅ Received Alpha Data from ArcFlow x402 Hub:")
        print(json.dumps(alpha_data, indent=2))
        return alpha_data
    else:
        print(f"Error {response.status_code}: {response.text}")

if __name__ == "__main__":
    execute_${service.id.replace(/-/g, '_')}()`
}
