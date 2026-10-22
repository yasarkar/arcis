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
import { getSwapEstimate, resolveArcNativeRoute } from './swapService'
import { getArcPublicClient, resilientReadContract } from './rpc'
import { estimateArcGasCostUsdc } from './arcGasService'
import { readVaultAnalytics } from './x402/vaultAnalytics'
import { readPortfolioRisk } from './x402/portfolioRisk'
import { scoutGatewayRoutes, type RouteScoutUrgency } from './x402/gatewayRouteScout'
import { analyzePortfolioWithLlm } from './x402/agentAnalyst'
import { readVaultYieldReport } from './x402/vaultYieldReport'
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

interface ArbitragePoolMeta {
  address: Address
  dexName: string
  decA: number
  decB: number
  symbolA: string
  symbolB: string
}

/**
 * Resolves the Arc Testnet pool that actually holds the pair. Symbols always follow the
 * on-chain ordering of the pool (symbolA is the contract's tokenA), so a reversed input
 * cannot re-label a reserve.
 */
function resolveDexPoolMeta(tokenA: string, tokenB: string): ArbitragePoolMeta | null {
  const normA = normalizeTokenSymbol(tokenA)
  const normB = normalizeTokenSymbol(tokenB)

  if ((normA === 'USDC' && normB === 'EURC') || (normA === 'EURC' && normB === 'USDC')) {
    return {
      address: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
      dexName: 'Arcis StableSwap V3 Pool',
      decA: 6,
      decB: 6,
      symbolA: 'USDC',
      symbolB: 'EURC',
    }
  }

  if (
    (normA === 'USDC' && (normB === 'CIRBTC' || normB === 'BTC' || normB === 'WBTC')) ||
    ((normA === 'CIRBTC' || normA === 'BTC' || normA === 'WBTC') && normB === 'USDC')
  ) {
    return {
      address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL as Address,
      dexName: 'Arcis Constant Product Pool (cirBTC)',
      decA: 6,
      decB: 8,
      symbolA: 'USDC',
      symbolB: 'cirBTC',
    }
  }

  if (
    (normA === 'USDC' && normB === 'WETH') ||
    (normA === 'WETH' && normB === 'USDC')
  ) {
    const wethPool = POOL_CONTRACTS.WETH_POOL
    if (!wethPool || wethPool === '0x0000000000000000000000000000000000000000') return null
    return {
      address: wethPool as Address,
      dexName: 'Arcis WETH Pool',
      decA: 6,
      decB: 18,
      symbolA: 'USDC',
      symbolB: 'WETH',
    }
  }

  // EURC / WETH: ConstantProductPoolEurcWethV4 stores EURC as tokenA (6 decimals) and
  // WETH as tokenB (18 decimals). This pool has no USDC side, so its depth has to be
  // valued in USDC before it can be compared with a USDC-notional trade.
  if (
    (normA === 'EURC' && normB === 'WETH') ||
    (normA === 'WETH' && normB === 'EURC')
  ) {
    const eurcWethPool = POOL_CONTRACTS.EURC_WETH_POOL
    if (!eurcWethPool || eurcWethPool === '0x0000000000000000000000000000000000000000') return null
    return {
      address: eurcWethPool as Address,
      dexName: 'Arcis EURC/WETH Pool',
      decA: 6,
      decB: 18,
      symbolA: 'EURC',
      symbolB: 'WETH',
    }
  }

  return null
}

/**
 * Pool resolution for the arbitrage sentinel, which prices a USDC-notional spread: only
 * pools with a USDC side are in scope there. MEV Shield accepts any resolved pool.
 */
function resolveArbitragePoolMeta(tokenA: string, tokenB: string): ArbitragePoolMeta | null {
  const meta = resolveDexPoolMeta(tokenA, tokenB)
  return meta && (meta.symbolA === 'USDC' || meta.symbolB === 'USDC') ? meta : null
}

interface PoolDepthUsdc {
  /** USDC value of the reserve the exposure is measured against; null when unpriceable. */
  reserveUsdc: number | null
  /**
   * 'usdc-side'     — the trade sells USDC, so the pool's own USDC reserve is the depth.
   * 'token-in-side' — the trade sells another token (EURC, WETH, cirBTC), so that token's
   *                   reserve is valued in USDC: it is the side the trade drains.
   */
  basis: 'usdc-side' | 'token-in-side'
  /** USD prices used for the valuation, keyed by pool symbol; empty when USDC is sold. */
  prices: Record<string, number>
  /** Symbols with no usable price; non-empty means reserveUsdc is null. */
  missingPrices: string[]
}

/**
 * Expresses, in USDC, the reserve of the token the trade sells into the pool.
 *
 * The sold side is the side the trade drains, so it is the depth the exposure has to be
 * measured against: a WETH sale into USDC/WETH moves the WETH reserve, and a EURC sale into
 * EURC/WETH moves the EURC reserve. USDC needs no price (it is the numeraire); any other
 * token is valued with its live oracle price, and a missing price leaves the depth unknown
 * instead of substituting a default one.
 */
function valuePoolDepthInUsdc(
  meta: ArbitragePoolMeta,
  reserves: { reserveA: bigint; reserveB: bigint },
  livePrices: Record<string, number>,
  soldSymbol: string
): PoolDepthUsdc {
  const isTokenA = soldSymbol === meta.symbolA
  const soldAmount = Number(
    formatUnits(isTokenA ? reserves.reserveA : reserves.reserveB, isTokenA ? meta.decA : meta.decB)
  )

  if (soldSymbol === 'USDC') {
    return { reserveUsdc: soldAmount, basis: 'usdc-side', prices: {}, missingPrices: [] }
  }

  const price = livePrices[soldSymbol]
  if (price === undefined || !(price > 0)) {
    return { reserveUsdc: null, basis: 'token-in-side', prices: {}, missingPrices: [soldSymbol] }
  }

  return {
    reserveUsdc: soldAmount * price,
    basis: 'token-in-side',
    prices: { [soldSymbol]: price },
    missingPrices: [],
  }
}

async function fetchPairReserves(poolAddress: Address): Promise<{ reserveA: bigint; reserveB: bigint } | null> {
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
    return { reserveA: rA, reserveB: rB }
  } catch (err) {
    console.warn(`[aiServicesDataProvider] On-chain pool reserves unavailable for ${poolAddress}:`, err)
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

    const tokens = pair.split('/')
    const tokenA = normalizeTokenSymbol(tokens[0] || 'USDC')
    const tokenB = normalizeTokenSymbol(tokens[1] || 'EURC')

    const poolMeta = resolveArbitragePoolMeta(tokenA, tokenB)
    if (!poolMeta) {
      return {
        data: {
          status: 'UNAVAILABLE',
          timestamp: now,
          pair,
          unavailable: ['active Arc L1 DEX pool for requested pair'],
          reason: `Spread not computed: no active DEX liquidity pool exists on Arc Testnet for pair ${pair}.`,
          liveOraclePrices: {},
          onChainReserves: null,
        },
        actionablePayload: {
          type: 'arbitrage',
          title: `Execute ${pair} Arbitrage`,
          badgeText: 'Pair unavailable on Arc L1 DEX',
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

    // Fetch live market prices from real oracles (CoinGecko/Binance/Redis cache)
    const livePrices = await getLiveTokenPrices()

    // Unquoted tokens stay unknown: no made-up price is substituted for a missing oracle quote.
    const oraclePriceA = livePrices[tokenA]
    const oraclePriceB = livePrices[tokenB]
    const oracleMarketRate =
      oraclePriceA !== undefined && oraclePriceB !== undefined && oraclePriceB > 0
        ? tokenA === 'USDC'
          ? oraclePriceB
          : oraclePriceA / oraclePriceB
        : null

    // Fetch genuine Arc Testnet DEX reserves for this pool
    const reserves =
      poolMeta.address === POOL_CONTRACTS.STABLE_SWAP_POOL
        ? await fetchStablePoolReserves()
        : await fetchPairReserves(poolMeta.address)

    const poolRate =
      reserves && reserves.reserveB > 0n
        ? Number(formatUnits(reserves.reserveA, poolMeta.decA)) /
          Number(formatUnits(reserves.reserveB, poolMeta.decB))
        : null

    // Calculate dynamic gas on Arc L1 (USDC Native Gas)
    const gasUsdc = await estimateArcGasCostUsdc(120_000n)

    // Every input to the spread is a real read. If one of them is missing, the answer says so
    // instead of quoting a spread, a confidence score or a profit that nobody measured.
    if (!reserves || oracleMarketRate === null || poolRate === null || gasUsdc === null) {
      const unavailable = [
        oracleMarketRate === null && 'external oracle price for the pair',
        poolRate === null &&
          (poolMeta.symbolB === 'EURC'
            ? 'on-chain StableSwap pool reserves'
            : 'on-chain DEX pool reserves'),
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
                pool: poolMeta.address,
                reserveUSDC: Number(formatUnits(reserves.reserveA, poolMeta.decA)),
                ...(poolMeta.symbolB === 'EURC'
                  ? { reserveEURC: Number(formatUnits(reserves.reserveB, poolMeta.decB)) }
                  : poolMeta.symbolB === 'cirBTC'
                    ? { reserveCirBTC: Number(formatUnits(reserves.reserveB, poolMeta.decB)) }
                    : { reserveWETH: Number(formatUnits(reserves.reserveB, poolMeta.decB)) }),
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
        buyDex: poolMeta.dexName,
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
        pool: poolMeta.address,
        reserveUSDC: Number(formatUnits(reserves.reserveA, poolMeta.decA)),
        ...(poolMeta.symbolB === 'EURC'
          ? { reserveEURC: Number(formatUnits(reserves.reserveB, poolMeta.decB)) }
          : poolMeta.symbolB === 'cirBTC'
            ? { reserveCirBTC: Number(formatUnits(reserves.reserveB, poolMeta.decB)) }
            : { reserveWETH: Number(formatUnits(reserves.reserveB, poolMeta.decB)) }),
      },
      targetContracts: {
        pool: poolMeta.address,
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
        buyDex: poolMeta.dexName,
        sellDex: 'External Oracle / Gateway Bridge',
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

    // Read the reserves of the pool the quote was actually taken from. Reporting the
    // StableSwap pool's depth for a USDC/WETH or USDC/cirBTC request would describe a
    // different market, so a pair without a resolvable pool gets no depth figure.
    const route = resolveArcNativeRoute(fromToken, toToken)
    const routeReserves = route ? await fetchPairReserves(route.poolAddress) : null
    const hasUsdcSide = fromToken === 'USDC' || toToken === 'USDC'
    const totalReserveDepth =
      routeReserves && hasUsdcSide ? Math.round(Number(formatUnits(routeReserves.reserveA, 6))) : null
    const depthPool = route ? route.poolAddress : null

    // No quoted route and no computed price impact means there is no answer to give here.
    if (expectedOutputNum === null || effectiveExecutionPrice === null || priceImpactPct === null) {
      return {
        data: {
          status: 'UNAVAILABLE',
          inputAmount: `${amount} ${fromToken}`,
          unavailable: ['live DEX swap quote and/or its oracle benchmark'],
          reason: 'Route not optimised: the live quote or its oracle benchmark could not be read.',
          flashReserveDepthUsdc: totalReserveDepth,
          depthPool,
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
      depthPool,
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
    const requestedPair = String(inputPayload.pair || 'USDC/EURC')
    const [legA, legB] = requestedPair.split('/')
    const poolMeta = resolveDexPoolMeta(legA || 'USDC', legB || 'EURC')
    // Echo the pair that was actually measured, so a malformed input cannot claim one
    // market while the exposure came from another.
    const pair = poolMeta ? `${poolMeta.symbolA}/${poolMeta.symbolB}` : requestedPair

    // Direction: the token the trade sells into the pool. 'pair-first' — the form's default and
    // the meaning of an absent field — is the pair's first leg, i.e. the order the caller wrote
    // the pair in: EURC/WETH sells EURC, USDC/WETH sells USDC.
    const rawTokenIn = inputPayload.tokenIn ? String(inputPayload.tokenIn) : 'pair-first'
    const trimmedTokenIn = rawTokenIn.trim().toLowerCase()
    const autoDirection = trimmedTokenIn === 'pair-first' || trimmedTokenIn === ''
    const requestedTokenIn = normalizeTokenSymbol(autoDirection ? legA || 'USDC' : rawTokenIn)
    const tokenInSide = poolMeta
      ? [poolMeta.symbolA, poolMeta.symbolB].find(
          (symbol) => normalizeTokenSymbol(symbol) === requestedTokenIn
        ) ?? null
      : null
    // Echo the pool's own casing ("cirBTC") so the response lines up with `poolReserves`.
    const tokenIn = tokenInSide ?? requestedTokenIn
    const tokenOut =
      poolMeta && tokenInSide
        ? tokenInSide === poolMeta.symbolA
          ? poolMeta.symbolB
          : poolMeta.symbolA
        : null

    // Read the reserve of the pool this trade would actually move. A USDC/WETH trade
    // measured against the StableSwap reserve would describe a different market.
    const reserves = poolMeta ? await fetchPairReserves(poolMeta.address) : null
    // Selling anything but USDC needs that token's live price to express its reserve in USDC.
    const needsUsdcValuation = tokenInSide !== null && tokenInSide !== 'USDC'
    const livePrices = needsUsdcValuation && reserves ? await getLiveTokenPrices() : {}
    const depth =
      poolMeta && reserves && tokenInSide
        ? valuePoolDepthInUsdc(poolMeta, reserves, livePrices, tokenInSide)
        : null
    const poolReserves =
      poolMeta && reserves
        ? {
            [poolMeta.symbolA]: Number(formatUnits(reserves.reserveA, poolMeta.decA)),
            [poolMeta.symbolB]: Number(formatUnits(reserves.reserveB, poolMeta.decB)),
          }
        : null

    const poolReserveUsdc = depth ? depth.reserveUsdc : null
    // Transactions larger than 5% of the sold side's USDC value are exposed to sandwich attacks.
    // The share is a real ratio of two real inputs, or unknown when a read failed.
    const reserveSharePct =
      poolReserveUsdc !== null && poolReserveUsdc > 0
        ? Number(((amount / poolReserveUsdc) * 100).toFixed(2))
        : null

    // Arc L1 dynamic priority gas options
    const arcGasUsdc = await estimateArcGasCostUsdc(120_000n)
    const suggestedSlippagePct = Number(slippageTolerancePct.toFixed(2))

    const missingPrices = depth ? depth.missingPrices : []
    const unavailable: string[] = []
    if (!poolMeta) unavailable.push('active Arc L1 DEX pool for requested pair')
    else if (!tokenInSide) unavailable.push(`tokenIn ${requestedTokenIn} as a side of the ${pair} pool`)
    else if (!reserves) unavailable.push('on-chain pool reserve depth')
    else if (missingPrices.length > 0) {
      unavailable.push(`oracle price for ${missingPrices.join(' and ')} to value the pool in USDC`)
    } else if (reserveSharePct === null) unavailable.push('a non-empty pool reserve')

    const unmeasuredReason = !poolMeta
      ? `Exposure not computed: no active DEX liquidity pool exists on Arc Testnet for pair ${pair}.`
      : !tokenInSide
        ? `Exposure not computed: tokenIn ${requestedTokenIn} is not part of the ${pair} pool (expected ${poolMeta.symbolA} or ${poolMeta.symbolB}).`
        : !reserves
          ? 'Exposure not computed: the pool reserve read failed.'
          : missingPrices.length > 0
            ? `Exposure not computed: the ${pair} pool's ${tokenIn} reserve could not be valued in USDC (missing ${missingPrices.join(' and ')} oracle price).`
            : reserveSharePct === null
              ? `Exposure not computed: the ${pair} pool holds no measurable ${tokenIn} reserve.`
              : null

    const data = {
      status: reserveSharePct === null ? 'UNAVAILABLE' : 'ANALYSIS_COMPLETE',
      pair,
      tokenIn,
      tokenOut,
      poolAddress: poolMeta?.address ?? null,
      poolReserveUsdc,
      poolReserves,
      poolReserveBasis: depth ? depth.basis : null,
      vulnerabilityLevel:
        reserveSharePct === null ? null : reserveSharePct > 5.0 ? 'HIGH_IF_UNPROTECTED' : 'LOW_RISK',
      tradeReserveExposurePct: reserveSharePct,
      arcL1MempoolArchitecture: 'Deterministic FIFO / USDC-Native Gas Priority',
      recommendedShieldAction: {
        bundleType: 'Advisory only — no bundle is submitted',
        advisoryOnly: true,
        adjustedMaxSlippagePct: suggestedSlippagePct,
        estimatedGasCostUsdc: arcGasUsdc,
      },
      ...(depth && depth.basis === 'token-in-side' && Object.keys(depth.prices).length > 0
        ? { usdcValuationPrices: depth.prices }
        : {}),
      ...(unmeasuredReason ? { unavailable, reason: unmeasuredReason } : {}),
    }

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title: 'Apply Shielded Slippage & FIFO Priority',
      badgeText:
        reserveSharePct === null
          ? 'Exposure unavailable — no measurable pool reserve for this trade'
          : depth?.basis === 'token-in-side'
            ? `Trade is ${reserveSharePct}% of the ${pair} pool's ${tokenIn} reserve, valued in USDC`
            : `Trade is ${reserveSharePct}% of the ${pair} pool's ${tokenIn} reserve`,
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
  // 6. GATEWAY FEE & ROUTE SCOUT
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-gateway-fee-route-scout') {
    const amountUsdc = Number(inputPayload.amountUsdc)
    const destinationChain = String(inputPayload.destinationChain || 'Ethereum_Sepolia')
    const urgency: RouteScoutUrgency = inputPayload.urgency === 'fast' ? 'fast' : 'standard'

    // Circle Gateway's fee and Circle's CCTP fee quote, compared for this exact route.
    // `gatewayRouteScout` owns both quotes and leaves a rail null when its source fails.
    const quote = await scoutGatewayRoutes({ amountUsdc, destinationChain, urgency })

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title:
        quote.recommendedRail === 'gateway'
          ? 'Bridge via Circle Gateway'
          : quote.recommendedRail === 'cctp'
            ? 'Bridge via CCTP'
            : 'Route quote unavailable',
      badgeText:
        quote.savingsUsdc === null
          ? `Route ${quote.status === 'UNAVAILABLE' ? 'unavailable' : 'partially quoted'} — see unavailable reasons`
          : `${quote.recommendedRail === 'gateway' ? 'Gateway' : 'CCTP'} saves ${quote.savingsUsdc} USDC`,
      details: {
        navTab: 'bridge',
        targetChain: destinationChain,
        recommendedRail: quote.recommendedRail ?? undefined,
      },
    }

    return { data: quote, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 7. YIELD VAULT ANALYTICS
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-yield-vault-analytics') {
    const analytics = await readVaultAnalytics({ windowDays: inputPayload.windowDays })

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title: analytics.status === 'VAULT_READ' ? 'Open USDC Yield Vault' : 'Vault analytics unavailable',
      badgeText:
        analytics.sharePriceUsdc === null
          ? `Vault ${analytics.status === 'VAULT_EMPTY' ? 'has no shares outstanding' : 'read unavailable'}`
          : `1 share = ${analytics.sharePriceUsdc} USDC`,
      details: {
        navTab: 'pools',
        vaultAddress: analytics.vaultAddress,
      },
    }

    return { data: analytics, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 8. PORTFOLIO RISK & EXPOSURE
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-portfolio-risk-exposure') {
    const address = String(inputPayload.address || '').trim()
    const includeGatewayBalance = inputPayload.includeGatewayBalance === true

    const risk = await readPortfolioRisk({ address, includeGatewayBalance })

    return { data: risk }
  }

  // ─────────────────────────────────────────────────────────────
  // 9. ON-CHAIN PORTFOLIO ANALYST (llm)
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-onchain-portfolio-analyst') {
    const address = String(inputPayload.address || '').trim()
    const analysis = await analyzePortfolioWithLlm({
      address,
      includeGatewayBalance: inputPayload.includeGatewayBalance === true,
    })

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title:
        analysis.status === 'UNAVAILABLE'
          ? 'Portfolio narrative unavailable'
          : 'Review the measured portfolio',
      badgeText:
        analysis.narrative === null
          ? 'Narrative unavailable — measured facts are still shown when readable'
          : analysis.status === 'PARTIAL'
            ? 'Partially measured portfolio — gaps are stated in the narrative'
            : 'Measured facts narrated without model-generated figures',
      details: {
        navTab: 'unified',
        targetChain: 'Arc Testnet',
      },
    }

    return { data: analysis, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 10. VAULT YIELD REPORT (llm, Reporting & Tax)
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-vault-yield-tax-report') {
    const address = String(inputPayload.address || '').trim()
    const report = await readVaultYieldReport({ address })

    const actionablePayload: ActionableSignalPayload = {
      type: 'navigate',
      title:
        report.status === 'NO_POSITION'
          ? 'No vault position to report'
          : report.status === 'UNAVAILABLE'
            ? 'Vault report unavailable'
            : 'Open the USDC Yield Vault',
      badgeText:
        report.status === 'NO_POSITION'
          ? 'This address holds no vault shares'
          : report.status === 'UNAVAILABLE'
            ? 'A required vault read failed; no narrative was generated'
            : 'Principal, redeemable value and pending yield measured on-chain',
      details: {
        navTab: 'pools',
        vaultAddress: report.vaultAddress,
      },
    }

    return { data: report, actionablePayload }
  }

  // ─────────────────────────────────────────────────────────────
  // 11. CUSTOM / COMMUNITY REGISTERED SERVICE FALLBACK
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
