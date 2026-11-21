// src/services/x402/tradeExecutionAdvisor.ts
// Smart Trade & Execution Advisor for `arc-deep-liquidity-slippage-optimizer`.
//
// Combines live Arc L1 pool depth, direct vs 2-hop route comparison across the 6 deployed
// V4 pools, reserve/sandwich exposure (merged from the former MEV Shield service), and
// deterministic batch-split sizing. Every figure is derived from on-chain reserves, live
// swap quotes, live oracle prices, and measured Arc gas — never invented.

import { formatUnits, type Address } from 'viem'
import { POOL_CONTRACTS, STABLE_SWAP_ABI } from '../../config/poolsConfig.js'
import type { ActionableSignalPayload } from '../../types/marketplace.js'
import { estimateArcGasCostUsdc } from '../arcGasService.js'
import { getArcPublicClient, resilientReadContract } from '../rpc/index.js'
import { getSwapEstimate, resolveArcNativeRoute } from '../swapService.js'
import { getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService.js'

export const TRADE_EXECUTION_ADVISOR_SERVICE_ID = 'arc-deep-liquidity-slippage-optimizer'

const ARC_SWAP_TOKENS = ['USDC', 'EURC', 'WETH', 'cirBTC'] as const
const HIGH_SLIPPAGE_THRESHOLD_PCT = 1.0
const HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT = 5.0
const MODERATE_RESERVE_EXPOSURE_THRESHOLD_PCT = 2.0
const TARGET_PER_BATCH_RESERVE_PCT = 2.5
const MAX_RECOMMENDED_BATCHES = 10
const SWAP_GAS_LIMIT = 120_000n

export interface TradePoolMeta {
  address: Address
  dexName: string
  decA: number
  decB: number
  symbolA: string
  symbolB: string
}

export interface EvaluatedTradeRoute {
  path: string
  hops: 1 | 2
  intermediateToken: string | null
  expectedOutput: number
  effectiveExecutionPrice: number
  priceImpactPct: number | null
  recommended: boolean
}

export interface TradeExecutionSizing {
  recommendedBatchCount: number
  perBatchInputAmount: number
  estimatedTotalGasUsdc: number | null
  suggestedMaxSlippagePct: number
  advisoryOnly: true
  note: string
}

function canonicalTokenSymbol(raw: string): string {
  const norm = normalizeTokenSymbol(raw)
  if (norm === 'CIRBTC' || norm === 'BTC' || norm === 'WBTC') return 'cirBTC'
  if (norm === 'WETH' || norm === 'ETH') return 'WETH'
  if (norm === 'EURC') return 'EURC'
  if (norm === 'USDC') return 'USDC'
  return norm
}

export function resolveTradePoolMeta(tokenA: string, tokenB: string): TradePoolMeta | null {
  const a = canonicalTokenSymbol(tokenA)
  const b = canonicalTokenSymbol(tokenB)
  const pairKey = [a, b].sort().join('/')

  const zero = '0x0000000000000000000000000000000000000000'

  if (pairKey === 'EURC/USDC') {
    return {
      address: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
      dexName: 'Arcis StableSwap V3 Pool',
      decA: 6,
      decB: 6,
      symbolA: 'USDC',
      symbolB: 'EURC',
    }
  }
  if (pairKey === 'USDC/cirBTC') {
    return {
      address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL as Address,
      dexName: 'Arcis Constant Product Pool (cirBTC)',
      decA: 6,
      decB: 8,
      symbolA: 'USDC',
      symbolB: 'cirBTC',
    }
  }
  if (pairKey === 'USDC/WETH' && POOL_CONTRACTS.WETH_POOL !== zero) {
    return {
      address: POOL_CONTRACTS.WETH_POOL as Address,
      dexName: 'Arcis WETH Pool',
      decA: 6,
      decB: 18,
      symbolA: 'USDC',
      symbolB: 'WETH',
    }
  }
  if (pairKey === 'EURC/WETH' && POOL_CONTRACTS.EURC_WETH_POOL !== zero) {
    return {
      address: POOL_CONTRACTS.EURC_WETH_POOL as Address,
      dexName: 'Arcis EURC/WETH Pool',
      decA: 6,
      decB: 18,
      symbolA: 'EURC',
      symbolB: 'WETH',
    }
  }
  if (pairKey === 'EURC/cirBTC' && POOL_CONTRACTS.EURC_CIRBTC_POOL !== zero) {
    return {
      address: POOL_CONTRACTS.EURC_CIRBTC_POOL as Address,
      dexName: 'Arcis EURC/cirBTC Pool',
      decA: 6,
      decB: 8,
      symbolA: 'EURC',
      symbolB: 'cirBTC',
    }
  }
  if (pairKey === 'WETH/cirBTC' && POOL_CONTRACTS.CIRBTC_WETH_POOL !== zero) {
    return {
      address: POOL_CONTRACTS.CIRBTC_WETH_POOL as Address,
      dexName: 'Arcis cirBTC/WETH Pool',
      decA: 8,
      decB: 18,
      symbolA: 'cirBTC',
      symbolB: 'WETH',
    }
  }
  return null
}

async function readPoolReserves(poolAddress: Address): Promise<{ reserveA: bigint; reserveB: bigint } | null> {
  try {
    const client = getArcPublicClient()
    const [rA, rB] = await Promise.all([
      resilientReadContract(client, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'reserveA',
      }),
      resilientReadContract(client, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'reserveB',
      }),
    ])
    return { reserveA: rA as bigint, reserveB: rB as bigint }
  } catch {
    return null
  }
}

function oraclePriceOf(prices: Record<string, number>, symbol: string): number | null {
  const direct = prices[symbol] ?? prices[symbol.toUpperCase()] ?? prices[normalizeTokenSymbol(symbol)]
  return typeof direct === 'number' && Number.isFinite(direct) && direct > 0 ? direct : null
}

const round6 = (n: number): number => Number(n.toFixed(6))

export async function analyzeTradeExecution(input: {
  fromToken?: string
  toToken?: string
  amount?: number
  slippageTolerancePct?: number
}): Promise<{ data: Record<string, any>; actionablePayload?: ActionableSignalPayload }> {
  const amount = Number(input.amount) || 50_000
  const fromCanonical = canonicalTokenSymbol(String(input.fromToken || 'USDC'))
  const toCanonical = canonicalTokenSymbol(String(input.toToken || 'EURC'))
  const fromQuery = fromCanonical.toUpperCase()
  const toQuery = toCanonical.toUpperCase()
  const rawSlip = Number(input.slippageTolerancePct)
  const slippageTolerancePct =
    Number.isFinite(rawSlip) && rawSlip >= 0.01 && rawSlip <= 5 ? Number(rawSlip.toFixed(2)) : 0.5

  if (fromQuery === toQuery || !Number.isFinite(amount) || amount <= 0) {
    return {
      data: {
        status: 'UNAVAILABLE',
        inputAmount: `${amount} ${fromCanonical}`,
        unavailable: ['distinct source and destination tokens with positive amount'],
        reason:
          fromQuery === toQuery
            ? `Cannot analyze a swap from ${fromCanonical} to ${toCanonical}: source and destination tokens must differ.`
            : 'A positive swap amount is required.',
        riskRegister: [
          {
            id: 'INVALID_TRADE_PARAMS',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Invalid Swap Parameters',
            finding: 'Source and destination tokens must differ and amount must be positive.',
            evidence: { fromToken: fromCanonical, toToken: toCanonical, amount },
            threshold: 'Distinct tokens and amount > 0 required.',
            remediation: 'Select two different tokens and enter a positive trade amount.',
          },
        ],
      },
    }
  }

  // 1. Live direct quote, oracle benchmark, Arc gas, and direct pool reserves
  const directRoute = resolveArcNativeRoute(fromQuery, toQuery)
  const directMeta = resolveTradePoolMeta(fromCanonical, toCanonical)

  let directOutputNum: number | null = null
  let directRate: number | null = null
  let livePrices: Record<string, number> = {}

  const [directQuoteResult, pricesResult, arcGasUsdc, directReserves] = await Promise.all([
    getSwapEstimate({
      fromChain: 'Arc_Testnet',
      toChain: 'Arc_Testnet',
      tokenIn: fromQuery,
      tokenOut: toQuery,
      amountIn: amount.toString(),
      sourceAdapter: null,
    }).catch((err) => {
      console.warn('[tradeExecutionAdvisor] Live direct swap quote unavailable:', err)
      return null
    }),
    getLiveTokenPrices().catch(() => ({} as Record<string, number>)),
    estimateArcGasCostUsdc(SWAP_GAS_LIMIT),
    directRoute ? readPoolReserves(directRoute.poolAddress) : Promise.resolve(null),
  ])

  livePrices = pricesResult || {}

  if (directQuoteResult) {
    const out = parseFloat(directQuoteResult.estimatedOutput)
    const rate = parseFloat(directQuoteResult.rate)
    if (Number.isFinite(out) && out > 0 && Number.isFinite(rate) && rate > 0) {
      directOutputNum = out
      directRate = rate
    }
  }

  const spotFrom = oraclePriceOf(livePrices, fromCanonical)
  const spotTo = oraclePriceOf(livePrices, toCanonical)
  const benchmarkRate = spotFrom !== null && spotTo !== null && spotTo > 0 ? spotFrom / spotTo : null

  const computeImpact = (effectiveRate: number): number | null =>
    benchmarkRate !== null && benchmarkRate > 0
      ? Number(((Math.abs(benchmarkRate - effectiveRate) / benchmarkRate) * 100).toFixed(3))
      : null

  const directImpactPct = directRate !== null ? computeImpact(directRate) : null

  // Legacy-compatible reserve depth fields for the direct pool
  const hasUsdcSide = fromQuery === 'USDC' || toQuery === 'USDC'
  let soldSideReserveTokens: number | null = null
  let soldSideReserveUsdc: number | null = null
  let flashReserveDepthUsdc: number | null = null
  const depthPool = directRoute ? directRoute.poolAddress : null

  if (directRoute && directReserves && directMeta) {
    const isFromA = canonicalTokenSymbol(directMeta.symbolA) === fromCanonical
    soldSideReserveTokens = Number(
      formatUnits(isFromA ? directReserves.reserveA : directReserves.reserveB, isFromA ? directMeta.decA : directMeta.decB)
    )
    if (fromCanonical === 'USDC') {
      soldSideReserveUsdc = round6(soldSideReserveTokens)
    } else if (spotFrom !== null) {
      soldSideReserveUsdc = round6(soldSideReserveTokens * spotFrom)
    }

    if (hasUsdcSide) {
      const usdcIsA = directMeta.symbolA === 'USDC'
      const usdcRaw = usdcIsA ? directReserves.reserveA : directReserves.reserveB
      flashReserveDepthUsdc = Math.round(Number(formatUnits(usdcRaw, 6)))
    } else if (soldSideReserveUsdc !== null) {
      flashReserveDepthUsdc = Math.round(soldSideReserveUsdc)
    }
  }

  // 2. Evaluate 2-hop candidate routes when both legs have distinct live Arc pools
  const candidateRoutes: EvaluatedTradeRoute[] = []
  if (directOutputNum !== null && directRate !== null) {
    candidateRoutes.push({
      path: `${fromCanonical} → ${toCanonical}`,
      hops: 1,
      intermediateToken: null,
      expectedOutput: round6(directOutputNum),
      effectiveExecutionPrice: round6(directRate),
      priceImpactPct: directImpactPct,
      recommended: false,
    })
  }

  const intermediateCandidates = ARC_SWAP_TOKENS.filter((mid) => {
    const midUp = mid.toUpperCase()
    if (midUp === fromQuery || midUp === toQuery) return false
    const leg1 = resolveArcNativeRoute(fromQuery, midUp)
    const leg2 = resolveArcNativeRoute(midUp, toQuery)
    return Boolean(leg1 && leg2 && leg1.poolAddress.toLowerCase() !== leg2.poolAddress.toLowerCase())
  })

  if (intermediateCandidates.length > 0 && directOutputNum !== null) {
    const twoHopResults = await Promise.all(
      intermediateCandidates.map(async (mid) => {
        try {
          const midUp = mid.toUpperCase()
          const leg1 = await getSwapEstimate({
            fromChain: 'Arc_Testnet',
            toChain: 'Arc_Testnet',
            tokenIn: fromQuery,
            tokenOut: midUp,
            amountIn: amount.toString(),
            sourceAdapter: null,
          })
          const leg1Out = parseFloat(leg1.estimatedOutput)
          if (!Number.isFinite(leg1Out) || leg1Out <= 0) return null

          const leg2 = await getSwapEstimate({
            fromChain: 'Arc_Testnet',
            toChain: 'Arc_Testnet',
            tokenIn: midUp,
            tokenOut: toQuery,
            amountIn: leg1Out.toString(),
            sourceAdapter: null,
          })
          const leg2Out = parseFloat(leg2.estimatedOutput)
          if (!Number.isFinite(leg2Out) || leg2Out <= 0) return null

          const effectiveRate = leg2Out / amount
          return {
            path: `${fromCanonical} → ${mid} → ${toCanonical}`,
            hops: 2 as const,
            intermediateToken: mid,
            expectedOutput: round6(leg2Out),
            effectiveExecutionPrice: round6(effectiveRate),
            priceImpactPct: computeImpact(effectiveRate),
            recommended: false,
          } satisfies EvaluatedTradeRoute
        } catch {
          return null
        }
      })
    )

    for (const r of twoHopResults) {
      if (r) candidateRoutes.push(r)
    }
  }

  // No quoted route or no computed price impact means there is no answer to give here.
  if (candidateRoutes.length === 0 || directImpactPct === null) {
    return {
      data: {
        status: 'UNAVAILABLE',
        inputAmount: `${amount} ${fromCanonical}`,
        unavailable: ['live DEX swap quote and/or its oracle benchmark'],
        reason: 'Route not optimised: the live quote or its oracle benchmark could not be read.',
        flashReserveDepthUsdc,
        depthPool,
        riskRegister: [
          {
            id: 'SLIPPAGE_QUOTE_UNAVAILABLE',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Swap Execution Quote Unavailable',
            finding: 'The live DEX quote or oracle benchmark could not be retrieved from the network.',
            evidence: { fromToken: fromCanonical, toToken: toCanonical, amount },
            threshold: 'Live swap router and oracle benchmark required.',
            remediation: 'Verify network connectivity and ensure pool liquidity is deployed.',
          },
        ],
      },
    }
  }

  // Pick the highest real output across direct + 2-hop candidates
  candidateRoutes.sort((a, b) => b.expectedOutput - a.expectedOutput)
  const bestRoute = candidateRoutes[0]
  bestRoute.recommended = true

  const directEntry = candidateRoutes.find((r) => r.hops === 1) ?? bestRoute
  const twoHopOutputGainPct =
    bestRoute.hops === 2 && directEntry.expectedOutput > 0
      ? Number((((bestRoute.expectedOutput - directEntry.expectedOutput) / directEntry.expectedOutput) * 100).toFixed(3))
      : 0

  // 3. Reserve depth & sandwich / MEV exposure (on the sold side of the direct pool)
  const tradeReserveExposurePct =
    soldSideReserveTokens !== null && soldSideReserveTokens > 0
      ? Number(((amount / soldSideReserveTokens) * 100).toFixed(2))
      : null

  const sandwichRiskLevel: 'HIGH' | 'MODERATE' | 'LOW' | null =
    tradeReserveExposurePct === null
      ? null
      : tradeReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT
        ? 'HIGH'
        : tradeReserveExposurePct > MODERATE_RESERVE_EXPOSURE_THRESHOLD_PCT
          ? 'MODERATE'
          : 'LOW'

  // 4. Deterministic batch-split sizing (arithmetic on real reserve share + real Arc gas)
  const recommendedBatchCount =
    tradeReserveExposurePct !== null && tradeReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT
      ? Math.min(MAX_RECOMMENDED_BATCHES, Math.max(2, Math.ceil(tradeReserveExposurePct / TARGET_PER_BATCH_RESERVE_PCT)))
      : 1

  const perBatchInputAmount = round6(amount / recommendedBatchCount)
  const estimatedTotalGasUsdc =
    arcGasUsdc !== null ? round6(arcGasUsdc * recommendedBatchCount * bestRoute.hops) : null

  const executionSizing: TradeExecutionSizing = {
    recommendedBatchCount,
    perBatchInputAmount,
    estimatedTotalGasUsdc,
    suggestedMaxSlippagePct: slippageTolerancePct,
    advisoryOnly: true,
    note:
      recommendedBatchCount > 1
        ? `Order is ${tradeReserveExposurePct}% of the sold-side reserve. Splitting into ${recommendedBatchCount} batches of ${perBatchInputAmount.toLocaleString()} ${fromCanonical} keeps each swap under ~${TARGET_PER_BATCH_RESERVE_PCT}% of pool depth. Advisory only — no bundle or private relay is submitted.`
        : 'Single-transaction execution fits within standard pool reserve depth on Arc L1 FIFO ordering. Advisory only — no bundle or private relay is submitted.',
  }

  // 5. Risk Register findings
  const effectiveImpactPct = bestRoute.priceImpactPct ?? directImpactPct
  const isHighImpact = effectiveImpactPct >= HIGH_SLIPPAGE_THRESHOLD_PCT
  const riskRegister: Array<Record<string, any>> = [
    {
      id: isHighImpact ? 'HIGH_SLIPPAGE_RISK' : 'OPTIMAL_SLIPPAGE_ROUTE',
      category: isHighImpact ? 'EXECUTION_RISK' : 'OPPORTUNITY',
      severity: isHighImpact ? 'MEDIUM' : 'INFO',
      title: isHighImpact
        ? `Elevated Price Impact (${effectiveImpactPct}%)`
        : `Optimized Swap Route (${effectiveImpactPct}% impact)`,
      finding: isHighImpact
        ? `Swapping ${amount.toLocaleString()} ${fromCanonical} via ${bestRoute.path} causes ${effectiveImpactPct}% price impact against the oracle benchmark.`
        : `Best measured route is ${bestRoute.path} (${amount.toLocaleString()} ${fromCanonical} → ${bestRoute.expectedOutput.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toCanonical}) with ${effectiveImpactPct}% price impact.`,
      evidence: {
        fromToken: fromCanonical,
        toToken: toCanonical,
        amount,
        recommendedPath: bestRoute.path,
        expectedOutput: bestRoute.expectedOutput,
        effectiveExecutionPrice: bestRoute.effectiveExecutionPrice,
        priceImpactPct: effectiveImpactPct,
        flashReserveDepthUsdc,
      },
      threshold: `Price impact evaluated against ${HIGH_SLIPPAGE_THRESHOLD_PCT.toFixed(1)}% threshold.`,
      remediation: isHighImpact
        ? `Split into ${recommendedBatchCount > 1 ? recommendedBatchCount : 2} smaller swaps or tighten slippage tolerance to ${slippageTolerancePct}%.`
        : 'Execute swap through Arcis DEX Router at the verified rate.',
    },
  ]

  if (tradeReserveExposurePct !== null) {
    const isHighReserveExposure = tradeReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT
    riskRegister.push({
      id: isHighReserveExposure ? 'HIGH_RESERVE_SANDWICH_EXPOSURE' : 'LOW_RESERVE_EXPOSURE',
      category: 'EXECUTION_RISK',
      severity: isHighReserveExposure ? 'HIGH' : sandwichRiskLevel === 'MODERATE' ? 'MEDIUM' : 'LOW',
      title: isHighReserveExposure
        ? `High Pool Reserve Exposure (${tradeReserveExposurePct}% of ${fromCanonical} reserve)`
        : `Low Pool Reserve Exposure (${tradeReserveExposurePct}% of ${fromCanonical} reserve)`,
      finding: isHighReserveExposure
        ? `Trade size drains ${tradeReserveExposurePct}% of the direct pool's ${fromCanonical} reserve, exceeding the ${HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT}% sandwich/impact caution line.`
        : `Trade size represents ${tradeReserveExposurePct}% of the direct pool's ${fromCanonical} reserve; low price-movement exposure.`,
      evidence: {
        fromToken: fromCanonical,
        soldSideReserveTokens: soldSideReserveTokens !== null ? round6(soldSideReserveTokens) : null,
        poolReserveUsdc: soldSideReserveUsdc,
        tradeReserveExposurePct,
        recommendedBatchCount,
        suggestedMaxSlippagePct: slippageTolerancePct,
      },
      threshold: `Trade size > ${HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT.toFixed(1)}% of sold-side pool reserve triggers split-sizing caution.`,
      remediation: isHighReserveExposure
        ? `Split into ${recommendedBatchCount} batches of ${perBatchInputAmount.toLocaleString()} ${fromCanonical} and keep slippage <= ${slippageTolerancePct}%.`
        : 'Single-order execution is within healthy pool depth limits.',
    })
  }

  if (bestRoute.hops === 2 && twoHopOutputGainPct > 0) {
    riskRegister.push({
      id: 'TWO_HOP_ROUTE_ADVANTAGE',
      category: 'OPPORTUNITY',
      severity: 'INFO',
      title: `2-Hop Route Beats Direct Pool by +${twoHopOutputGainPct}%`,
      finding: `Routing via ${bestRoute.path} yields ${bestRoute.expectedOutput.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toCanonical} vs ${directEntry.expectedOutput.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toCanonical} on the direct pool.`,
      evidence: {
        recommendedPath: bestRoute.path,
        twoHopOutput: bestRoute.expectedOutput,
        directOutput: directEntry.expectedOutput,
        twoHopOutputGainPct,
      },
      threshold: '2-hop output strictly exceeds direct pool output.',
      remediation: `Consider executing two sequential swaps via ${bestRoute.intermediateToken} to capture the higher net output.`,
    })
  }

  const data = {
    status: 'ROUTE_OPTIMIZED',
    inputAmount: `${amount.toLocaleString()} ${fromCanonical}`,
    expectedOutput: `${bestRoute.expectedOutput.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${toCanonical}`,
    recommendedPath: bestRoute.path,
    recommendedHops: bestRoute.hops,
    effectiveExecutionPrice: bestRoute.effectiveExecutionPrice,
    overallPriceImpactPct: effectiveImpactPct,
    twoHopOutputGainPct,
    tradeReserveExposurePct,
    sandwichRiskLevel,
    poolReserveUsdc: soldSideReserveUsdc,
    flashReserveDepthUsdc,
    depthPool,
    estimatedGasCostUsdc: estimatedTotalGasUsdc,
    routeComparison: candidateRoutes,
    executionSizing,
    riskRegister,
  }

  const actionablePayload: ActionableSignalPayload | undefined = directRoute
    ? {
        type: 'swap',
        title: `Swap ${amount.toLocaleString()} ${fromCanonical} → ${toCanonical}`,
        badgeText: `${effectiveImpactPct}% Impact · ${bestRoute.path}`,
        details: {
          amountIn: amount,
          fromToken: fromCanonical,
          toToken: toCanonical,
          estimatedOut: bestRoute.expectedOutput,
          priceImpactPct: effectiveImpactPct,
          poolAddress: directRoute.poolAddress,
          optimalPool: directMeta?.dexName || 'Arcis DEX Router',
          buttonLabel: recommendedBatchCount > 1 ? 'Review Swap on Arc' : 'Execute Swap on Arc',
        },
      }
    : undefined

  return { data, actionablePayload }
}
