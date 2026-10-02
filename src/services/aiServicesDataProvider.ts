// src/services/aiServicesDataProvider.ts
// Live On-Chain Intelligence Engine for Arcis AI Services
// Uses real Arc Testnet DEX pool reserves, Curve AMM mathematics,
// live token price oracles, and dynamic Arc L1 gas metrics.

import { formatUnits, type Address } from 'viem'
import type { x402Service, ActionableSignalPayload } from '../types/marketplace'
import {
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  YIELD_VAULT_ABI,
} from '../config/poolsConfig'
import { getLiveTokenPrices, normalizeTokenSymbol } from './tokenPriceService'
import { getSwapEstimate } from './swapService'
import { getArcPublicClient, resilientReadContract } from './rpc'
import { ARC_MIN_BASE_FEE_FLOOR } from './arcGasService'
import {
  buildGatewayFlowServiceData,
  formatUsdcOrUnavailable,
  readGatewayFlow,
  type GatewayFlowWindow,
} from './gatewayFlowIndexer'

export interface GeneratedServiceData {
  data: Record<string, any>
  actionablePayload?: ActionableSignalPayload
}

/**
 * Reads live reserves from the Arc Testnet StableSwap pool (USDC / EURC).
 * Returns null when the on-chain read fails — never a substituted reserve figure.
 */
async function fetchStablePoolReserves(): Promise<{ reserveA: bigint; reserveB: bigint } | null> {
  try {
    const client = getArcPublicClient()
    const [rA, rB] = await Promise.all([
      resilientReadContract(client, {
        address: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
        abi: STABLE_SWAP_ABI,
        functionName: 'reserveA',
      }),
      resilientReadContract(client, {
        address: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
        abi: STABLE_SWAP_ABI,
        functionName: 'reserveB',
      }),
    ])
    return { reserveA: rA, reserveB: rB }
  } catch (err) {
    console.warn('[aiServicesDataProvider] On-chain stable reserves unavailable:', err)
    return null
  }
}

/**
 * Reads totalAssets from the Arc Testnet YieldVault (af-USDC ERC-4626).
 * Returns null when the on-chain read fails — never a substituted figure.
 */
async function fetchVaultTotalAssets(): Promise<bigint | null> {
  try {
    const client = getArcPublicClient()
    const totalAssets = await resilientReadContract(client, {
      address: POOL_CONTRACTS.YIELD_VAULT as Address,
      abi: YIELD_VAULT_ABI,
      functionName: 'totalAssets',
    })
    return totalAssets
  } catch (err) {
    console.warn('[aiServicesDataProvider] On-chain vault assets unavailable:', err)
    return null
  }
}

/**
 * Computes the dynamic Arc L1 gas cost in USDC for a given gas limit.
 * The protocol's real minimum base fee is the only fallback; a failed read returns null.
 */
async function computeArcGasCostUsdc(gasLimit = 120_000n): Promise<number | null> {
  try {
    const client = getArcPublicClient()
    const gasPrice = await client.getGasPrice().catch(() => ARC_MIN_BASE_FEE_FLOOR)
    const effectiveFee = gasPrice > 0n ? gasPrice : ARC_MIN_BASE_FEE_FLOOR
    const costWei = gasLimit * effectiveFee
    return Number(parseFloat(formatUnits(costWei, 18)).toFixed(6))
  } catch (err) {
    console.warn('[aiServicesDataProvider] Arc L1 gas price unavailable:', err)
    return null
  }
}

/**
 * Generates live on-chain intelligence and actionable triggers for an AI service execution
 */
export async function generateLiveServiceData(
  service: x402Service,
  inputPayload: Record<string, any>
): Promise<GeneratedServiceData> {
  const now = Date.now()

  // ─────────────────────────────────────────────────────────────
  // 1. ARC CROSS-DEX ARBITRAGE SENTINEL
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-cross-dex-arbitrage-sentinel') {
    const pair = inputPayload.pair || 'USDC/EURC'
    const tradeSize = Number(inputPayload.tradeSizeUsdc) || 25000
    const minNetProfitPct = Number(inputPayload.minNetProfitPct) || 0.1

    // Fetch live market prices from real oracles (CoinGecko/Binance/Redis cache)
    const livePrices = await getLiveTokenPrices()
    const tokens = pair.split('/')
    const tokenA = normalizeTokenSymbol(tokens[0] || 'USDC')
    const tokenB = normalizeTokenSymbol(tokens[1] || 'EURC')

    // Unquoted tokens stay unknown: no made-up price is substituted for a missing oracle quote.
    const oraclePriceA = livePrices[tokenA]
    const oraclePriceB = livePrices[tokenB]
    const oracleMarketRate =
      oraclePriceA !== undefined && oraclePriceB !== undefined && oraclePriceB > 0
        ? tokenA === 'USDC'
          ? oraclePriceB
          : oraclePriceA / oraclePriceB
        : null

    // Fetch genuine Arc Testnet DEX reserves
    const reserves = await fetchStablePoolReserves()
    const poolRate =
      reserves && reserves.reserveB > 0n
        ? Number(formatUnits(reserves.reserveA, 6)) / Number(formatUnits(reserves.reserveB, 6))
        : null

    // Calculate dynamic gas on Arc L1 (USDC Native Gas)
    const gasUsdc = await computeArcGasCostUsdc(120_000n)

    // Every input to the spread is a real read. If one of them is missing, the answer says so
    // instead of quoting a spread, a confidence score or a profit that nobody measured.
    if (!reserves || oracleMarketRate === null || poolRate === null || gasUsdc === null) {
      const unavailable = [
        oracleMarketRate === null && 'external oracle price for the pair',
        poolRate === null && 'on-chain StableSwap pool reserves',
        gasUsdc === null && 'Arc L1 gas price',
      ].filter((value): value is string => typeof value === 'string')

      return {
        data: {
          status: 'UNAVAILABLE',
          timestamp: now,
          pair,
          unavailable,
          reason: `Spread not computed: could not read ${unavailable.join(', ')}.`,
          liveOraclePrices: { [tokenA]: oraclePriceA ?? null, [tokenB]: oraclePriceB ?? null },
          onChainReserves: reserves
            ? {
                pool: POOL_CONTRACTS.STABLE_SWAP_POOL,
                reserveUSDC: Number(formatUnits(reserves.reserveA, 6)),
                reserveEURC: Number(formatUnits(reserves.reserveB, 6)),
              }
            : null,
        },
        actionablePayload: {
          type: 'arbitrage',
          title: `Execute ${pair} Arbitrage`,
          badgeText: 'Spread unavailable — required on-chain read failed',
          details: {
            pair,
            tradeSizeUsdc: tradeSize,
            fromToken: tokenA,
            toToken: tokenB,
            poolAddress: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
          },
        },
      }
    }

    // Real mathematical spread between Arc Pool Rate and Oracle External Rate
    const rawSpread = Math.abs(oracleMarketRate - poolRate) / poolRate
    const spreadPct = Number((rawSpread * 100).toFixed(3))

    // Calculate gross and net profit based on genuine trade size and spread
    const grossProfit = Number((tradeSize * (spreadPct / 100)).toFixed(2))
    const netProfit = Number(Math.max(0, grossProfit - gasUsdc).toFixed(2))
    const netProfitPct = Number(((netProfit / tradeSize) * 100).toFixed(3))
    const isProfitable = netProfitPct >= minNetProfitPct

    const buyPrice = Number(Math.min(poolRate, oracleMarketRate).toFixed(4))
    const sellPrice = Number(Math.max(poolRate, oracleMarketRate).toFixed(4))

    const data = {
      status: isProfitable ? 'OPPORTUNITY_DETECTED' : 'SPREAD_BELOW_THRESHOLD',
      timestamp: now,
      pair,
      liveOraclePrices: {
        [tokenA]: oraclePriceA,
        [tokenB]: oraclePriceB,
      },
      bestRoute: {
        buyDex: 'Arcis StableSwap V3 Pool',
        buyPriceUsdc: buyPrice,
        sellDex: 'External Oracle / Gateway Bridge',
        sellPriceUsdc: sellPrice,
        grossSpreadPct: spreadPct,
        recommendedTradeSize: tradeSize,
        estimatedGasCostUsdc: gasUsdc,
        netProfitUsdc: netProfit,
        netProfitPct: netProfitPct,
      },
      onChainReserves: {
        pool: POOL_CONTRACTS.STABLE_SWAP_POOL,
        reserveUSDC: Number(formatUnits(reserves.reserveA, 6)),
        reserveEURC: Number(formatUnits(reserves.reserveB, 6)),
      },
      targetContracts: {
        stableSwapPool: POOL_CONTRACTS.STABLE_SWAP_POOL,
        router: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
      },
    }

    const actionablePayload: ActionableSignalPayload = {
      type: 'arbitrage',
      title: `Execute ${pair} Arbitrage`,
      badgeText: `+$${netProfit} USDC (${netProfitPct}%) Net Profit`,
      details: {
        pair,
        tradeSizeUsdc: tradeSize,
        buyDex: 'Arcis StableSwap V3 Pool',
        sellDex: 'Arcis Swap Router',
        spreadPct,
        estimatedProfitUsdc: netProfit,
        fromToken: tokenA,
        toToken: tokenB,
        poolAddress: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
      },
    }

    return { data, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 2. DEEP LIQUIDITY DEPTH & SLIPPAGE OPTIMIZER
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-deep-liquidity-slippage-optimizer') {
    const amount = Number(inputPayload.amount) || 50000
    const fromToken = (inputPayload.fromToken || 'USDC').toUpperCase()
    const toToken = (inputPayload.toToken || 'EURC').toUpperCase()

    // Query real DEX estimate using swapService and Curve StableSwap mathematics
    let expectedOutputNum: number | null = null
    let effectiveExecutionPrice: number | null = null
    let priceImpactPct: number | null = null

    try {
      const quote = await getSwapEstimate({
        fromChain: 'Arc_Testnet',
        toChain: 'Arc_Testnet',
        tokenIn: fromToken,
        tokenOut: toToken,
        amountIn: amount.toString(),
        sourceAdapter: null,
      })

      expectedOutputNum = parseFloat(quote.estimatedOutput)
      effectiveExecutionPrice = parseFloat(quote.rate)

      // Price impact against the live oracle benchmark; unknown when either side is unquoted
      const livePrices = await getLiveTokenPrices()
      const spotFrom = livePrices[normalizeTokenSymbol(fromToken)]
      const spotTo = livePrices[normalizeTokenSymbol(toToken)]
      const benchmarkRate =
        spotFrom !== undefined && spotTo !== undefined && spotTo > 0 ? spotFrom / spotTo : null
      priceImpactPct =
        benchmarkRate !== null && benchmarkRate > 0
          ? Number(((Math.abs(benchmarkRate - effectiveExecutionPrice) / benchmarkRate) * 100).toFixed(3))
          : null
    } catch (err) {
      console.warn('[aiServicesDataProvider] Live swap quote unavailable:', err)
    }

    // Read real pool reserves for depth estimation
    const reserves = await fetchStablePoolReserves()
    const totalReserveDepth = reserves
      ? Math.round(
          Number(formatUnits(reserves.reserveA, 6)) + Number(formatUnits(reserves.reserveB, 6))
        )
      : null

    // No quoted route and no computed price impact means there is no answer to give here.
    if (expectedOutputNum === null || effectiveExecutionPrice === null || priceImpactPct === null) {
      return {
        data: {
          status: 'UNAVAILABLE',
          inputAmount: `${amount} ${fromToken}`,
          unavailable: ['live DEX swap quote and/or its oracle benchmark'],
          reason: 'Route not optimised: the live quote or its oracle benchmark could not be read.',
          flashReserveDepthUsdc: totalReserveDepth,
        },
        actionablePayload: {
          type: 'swap',
          title: `Execute Optimized ${fromToken} ➔ ${toToken} Swap`,
          badgeText: 'Route quote unavailable — no fabricated estimate',
          details: {
            fromToken,
            toToken,
            amountIn: amount,
            poolAddress: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
          },
        },
      }
    }

    const data = {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: `${amount.toLocaleString()} ${fromToken}`,
      expectedOutput: `${expectedOutputNum.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${toToken}`,
      effectiveExecutionPrice,
      overallPriceImpactPct: priceImpactPct,
      flashReserveDepthUsdc: totalReserveDepth,
    }

    const actionablePayload: ActionableSignalPayload = {
      type: 'swap',
      title: `Execute Optimized ${fromToken} ➔ ${toToken} Swap`,
      badgeText: `Live route for ${amount.toLocaleString()} ${fromToken} at ${priceImpactPct}% price impact`,
      details: {
        fromToken,
        toToken,
        amountIn: amount,
        estimatedOut: expectedOutputNum,
        priceImpactPct,
        poolAddress: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
      },
    }

    return { data, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 3. FLASH-LOAN YIELD & LIQUIDATION RADAR
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-flash-loan-yield-radar') {
    const minReward = Number(inputPayload.minLiquidationRewardUsdc) || 100

    // Fetch real Arc Testnet YieldVault assets
    const vaultAssets = await fetchVaultTotalAssets()

    // Arcis has no on-chain liquidation source: it cannot enumerate under-collateralized
    // positions, so no opportunity, health factor, bonus or reward is invented here.
    const data = {
      status: 'UNAVAILABLE',
      requestedMinLiquidationRewardUsdc: minReward,
      onChainVaultLiquidityUsdc: vaultAssets === null ? null : Number(formatUnits(vaultAssets, 6)),
      activeOpportunitiesCount: null,
      opportunities: [],
      unavailable: ['liquidation opportunity feed'],
      reason:
        'No on-chain liquidation source is connected, so no liquidation opportunity or expected reward can be reported.',
    }

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title: 'Liquidation feed unavailable',
      badgeText: 'No liquidation source connected',
      details: {
        navTab: 'ai-services',
      },
    }

    return { data, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. ARC MEMPOOL & MEV SHIELD SIMULATOR
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-mempool-mev-shield') {
    const amount = Number(inputPayload.targetTxAmountUsdc) || 100000
    const slippageTolerancePct = Number(inputPayload.slippageTolerancePct) || 0.5

    // Read real pool reserves to measure the exposure the user's trade represents
    const reserves = await fetchStablePoolReserves()
    const poolReserveUsdc = reserves ? Number(formatUnits(reserves.reserveA, 6)) : null
    // Transactions larger than 5% of pool reserve are exposed to sandwich attacks.
    // The share is a real ratio of two real inputs, or unknown when the reserve read failed.
    const reserveSharePct =
      poolReserveUsdc !== null && poolReserveUsdc > 0
        ? Number(((amount / poolReserveUsdc) * 100).toFixed(2))
        : null

    // Arc L1 dynamic priority gas options
    const arcGasUsdc = await computeArcGasCostUsdc(120_000n)
    const suggestedSlippagePct = Number(slippageTolerancePct.toFixed(2))

    const data = {
      status: reserveSharePct === null ? 'UNAVAILABLE' : 'ANALYSIS_COMPLETE',
      vulnerabilityLevel:
        reserveSharePct === null ? null : reserveSharePct > 5.0 ? 'HIGH_IF_UNPROTECTED' : 'LOW_RISK',
      tradeReserveExposurePct: reserveSharePct,
      arcL1MempoolArchitecture: 'Deterministic FIFO / USDC-Native Gas Priority',
      recommendedShieldAction: {
        bundleType: 'Arc L1 Native Priority Shield (Instant Finality)',
        adjustedMaxSlippagePct: suggestedSlippagePct,
        estimatedGasCostUsdc: arcGasUsdc,
        relayerSubmissionUrl: 'https://rpc.testnet.arc.network',
      },
      ...(reserveSharePct === null
        ? {
            unavailable: ['on-chain pool reserve depth'],
            reason: 'Exposure not computed: the pool reserve read failed.',
          }
        : {}),
    }

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title: 'Apply Shielded Slippage & FIFO Priority',
      badgeText:
        reserveSharePct === null
          ? 'Exposure unavailable — pool reserve read failed'
          : `Trade is ${reserveSharePct}% of the USDC pool reserve`,
      details: {
        adjustedMaxSlippagePct: suggestedSlippagePct,
        navTab: 'swap',
      },
    }

    return { data, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. CROSS-CHAIN GATEWAY FLOW INDEXER
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-cross-chain-gateway-flow-indexer') {
    const requestedWindow = String(inputPayload.timeWindow || '1h')
    const timeWindow: GatewayFlowWindow =
      requestedWindow === '24h' || requestedWindow === '7d' ? requestedWindow : '1h'

    // Real read: Circle Gateway AttestationUsed / GatewayBurned logs on Arc L1.
    // `gatewayFlowIndexer` owns both the fetch and the payload mapping; when the read
    // yields nothing or fails, the figures stay unavailable with the time of the attempt.
    const flow = await readGatewayFlow(timeWindow)
    const data = buildGatewayFlowServiceData(flow)

    const actionablePayload: ActionableSignalPayload = {
      type: 'deposit',
      title: 'Manage Unified Cross-Chain Balance',
      badgeText:
        flow.netInflowUsdc === null
          ? `Gateway flow data ${flow.status === 'UNAVAILABLE' ? 'unavailable' : 'stale'}`
          : `Gateway net flow ${formatUsdcOrUnavailable(flow.netInflowUsdc)}`,
      details: {
        navTab: 'unified',
        targetChain: 'Arc Testnet',
      },
    }

    return { data, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. CUSTOM / COMMUNITY REGISTERED SERVICE FALLBACK
  // ─────────────────────────────────────────────────────────────
  return {
    data: {
      status: 'SUCCESS',
      timestamp: now,
      serviceId: service.id,
      serviceName: service.name,
      inputsReceived: inputPayload,
      executionResult: {
        message: 'Community service payload accepted and echoed back; no on-chain execution was performed.',
        echo: inputPayload,
      },
    },
    actionablePayload: {
      type: 'navigate',
      title: 'Explore Service Integration',
      badgeText: 'Service Executed',
      details: {
        navTab: 'ai-services',
      },
    },
  }
}
