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

  if (
    (normA === 'EURC' && normB === 'CIRBTC') ||
    (normA === 'CIRBTC' && normB === 'EURC')
  ) {
    const eurcCirBtcPool = POOL_CONTRACTS.EURC_CIRBTC_POOL
    if (!eurcCirBtcPool || eurcCirBtcPool === '0x0000000000000000000000000000000000000000') return null
    return {
      address: eurcCirBtcPool as Address,
      dexName: 'Arcis EURC/cirBTC Pool',
      decA: 6,
      decB: 8,
      symbolA: 'EURC',
      symbolB: 'cirBTC',
    }
  }

  if (
    (normA === 'CIRBTC' && normB === 'WETH') ||
    (normA === 'WETH' && normB === 'CIRBTC')
  ) {
    const cirBtcWethPool = POOL_CONTRACTS.CIRBTC_WETH_POOL
    if (!cirBtcWethPool || cirBtcWethPool === '0x0000000000000000000000000000000000000000') return null
    return {
      address: cirBtcWethPool as Address,
      dexName: 'Arcis cirBTC/WETH Pool',
      decA: 8,
      decB: 18,
      symbolA: 'cirBTC',
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
          riskRegister: [
            {
              id: 'ARBITRAGE_READ_UNAVAILABLE',
              category: 'DATA_QUALITY',
              severity: 'HIGH',
              title: 'Pool Unavailable on Arc DEX',
              finding: `No active DEX liquidity pool exists on Arc Testnet for pair ${pair}.`,
              evidence: { pair },
              threshold: 'A deployed pool contract is required.',
              remediation: 'Select a pair with an active Arc L1 DEX pool.',
            },
          ],
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
          riskRegister: [
            {
              id: 'ARBITRAGE_READ_UNAVAILABLE',
              category: 'DATA_QUALITY',
              severity: 'HIGH',
              title: 'Arbitrage Read Unavailable',
              finding: `Could not read ${unavailable.join(', ')}.`,
              evidence: { pair, unavailable },
              threshold: 'Reserves, oracle rates, and gas price must return.',
              remediation: 'Retry the query once nodes and oracle feeds respond.',
            },
          ],
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

    const riskRegister = [
      isProfitable
        ? {
            id: 'ARBITRAGE_OPPORTUNITY',
            category: 'OPPORTUNITY',
            severity: 'INFO',
            title: `Cross-DEX Arbitrage Spread (${spreadPct}%)`,
            finding: `Discovered a ${spreadPct}% price discrepancy on ${pair} generating est. $${netProfit} USDC net profit (${netProfitPct}%) after $${gasUsdc} USDC gas.`,
            evidence: {
              pair,
              spreadPct,
              netProfitUsdc: netProfit,
              netProfitPct,
              grossProfitUsdc: grossProfit,
              gasUsdc,
              buyPrice,
              sellPrice,
            },
            threshold: `Net profit >= ${minNetProfitPct}% minimum hurdle rate.`,
            remediation: 'Execute swap on Arc DEX to capture spread divergence.',
          }
        : {
            id: 'SPREAD_BELOW_THRESHOLD',
            category: 'MARKET_STRUCTURE',
            severity: 'LOW',
            title: 'Arbitrage Spread Below Hurdle Rate',
            finding: `The measured ${spreadPct}% spread yields $${netProfit} USDC net profit (${netProfitPct}%), which is below the ${minNetProfitPct}% profit threshold.`,
            evidence: { pair, spreadPct, netProfitUsdc: netProfit, minNetProfitPct },
            threshold: `Net profit must exceed ${minNetProfitPct}%.`,
            remediation: 'Monitor the pair until price divergence widens beyond transaction fee hurdles.',
          },
    ]

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
      riskRegister,
    }

    return { data }
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
          riskRegister: [
            {
              id: 'SLIPPAGE_QUOTE_UNAVAILABLE',
              category: 'DATA_QUALITY',
              severity: 'HIGH',
              title: 'Swap Slippage Route Unavailable',
              finding: 'The live DEX quote or oracle benchmark could not be retrieved from the network.',
              evidence: { fromToken, toToken, amount },
              threshold: 'Live swap router and oracle benchmark required.',
              remediation: 'Verify network connectivity and ensure pool liquidity is deployed.',
            },
          ],
        },
      }
    }

    const isHighImpact = priceImpactPct >= 1.0
    const riskRegister = [
      {
        id: isHighImpact ? 'HIGH_SLIPPAGE_RISK' : 'OPTIMAL_SLIPPAGE_ROUTE',
        category: isHighImpact ? 'EXECUTION_RISK' : 'OPPORTUNITY',
        severity: isHighImpact ? 'MEDIUM' : 'INFO',
        title: isHighImpact
          ? `Elevated Price Impact (${priceImpactPct}%)`
          : `Optimized Swap Route (${priceImpactPct}% impact)`,
        finding: isHighImpact
          ? `Swapping ${amount.toLocaleString()} ${fromToken} causes ${priceImpactPct}% price impact against the benchmark rate.`
          : `Optimal route identified for ${amount.toLocaleString()} ${fromToken} ➔ ${expectedOutputNum.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${toToken} with low ${priceImpactPct}% price impact.`,
        evidence: {
          fromToken,
          toToken,
          amount,
          expectedOutputNum,
          effectiveExecutionPrice,
          priceImpactPct,
          totalReserveDepth,
        },
        threshold: 'Price impact evaluated against 1.0% institutional threshold.',
        remediation: isHighImpact
          ? 'Consider splitting your trade into smaller batches to reduce market impact.'
          : 'Execute swap through Arcis DEX Router at the verified rate.',
      },
    ]

    const data = {
      status: 'ROUTE_OPTIMIZED',
      inputAmount: `${amount.toLocaleString()} ${fromToken}`,
      expectedOutput: `${expectedOutputNum.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${toToken}`,
      effectiveExecutionPrice,
      overallPriceImpactPct: priceImpactPct,
      flashReserveDepthUsdc: totalReserveDepth,
      depthPool,
      riskRegister,
    }

    return { data }
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
      riskRegister: [
        {
          id: 'FLASH_LOAN_UNAVAILABLE',
          category: 'DATA_QUALITY',
          severity: 'INFO',
          title: 'No Liquidation Feed Connected',
          finding:
            'Arcis connects to verified on-chain accounting; no liquidation feed exists on Arc Testnet, so no liquidation opportunity is reported.',
          evidence: { minReward },
          threshold: 'Connected lending protocol liquidation engine required.',
          remediation: 'Monitor Arc ecosystem deployment updates for lending integration.',
        },
      ],
    }

    return { data }
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

    const isMevHighRisk = reserveSharePct !== null && reserveSharePct > 5.0
    const riskRegister = [
      reserveSharePct === null
        ? {
            id: 'MEV_ANALYSIS_UNAVAILABLE',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'MEV Exposure Analysis Unavailable',
            finding: unmeasuredReason || 'Could not measure pool reserves or oracle valuation.',
            evidence: { pair, tokenIn, unavailable },
            threshold: 'Requires readable on-chain reserves and active oracle rates.',
            remediation: 'Verify pair selection and retry query.',
          }
        : {
            id: isMevHighRisk ? 'MEV_SANDWICH_EXPOSURE' : 'LOW_MEV_RISK',
            category: 'EXECUTION_RISK',
            severity: isMevHighRisk ? 'HIGH' : 'LOW',
            title: isMevHighRisk
              ? `Mempool Sandwich Attack Risk (${reserveSharePct}% Reserve)`
              : `Minimal MEV Exposure (${reserveSharePct}%)`,
            finding: isMevHighRisk
              ? `Trade size represents ${reserveSharePct}% of the ${pair} pool's ${tokenIn} reserve. Orders exceeding 5% reserve depth face elevated sandwich attack vectors.`
              : `Trade size is only ${reserveSharePct}% of pool reserve depth; low vulnerability to front-running on Arc.`,
            evidence: {
              pair,
              tokenIn,
              tradeReserveExposurePct: reserveSharePct,
              suggestedSlippagePct,
              arcGasUsdc,
            },
            threshold: 'Trade size > 5.0% of pool reserve depth triggers sandwich alert.',
            remediation: isMevHighRisk
              ? `Tighten max slippage to ${suggestedSlippagePct}% or utilize small batch execution.`
              : 'Order can proceed safely under standard FIFO mempool parameters.',
          },
    ]

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
      riskRegister,
    }

    return { data }
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

    return { data }
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

    const riskRegister: any[] = []
    if (quote.status === 'UNAVAILABLE') {
      riskRegister.push({
        id: 'ROUTE_UNAVAILABLE',
        category: 'DATA_QUALITY',
        severity: 'HIGH',
        title: 'Bridge Route Quote Unavailable',
        finding: quote.reason || 'The requested destination chain cannot be quoted on live bridge rails.',
        evidence: { destinationChain, amountUsdc, unavailable: quote.unavailable },
        threshold: 'Valid destination domain and live pricing required.',
        remediation: 'Select a supported Circle Gateway or CCTP chain on Arc Testnet.',
      })
    } else if (quote.recommendedRail) {
      const railName = quote.recommendedRail === 'gateway' ? 'Circle Gateway' : 'CCTP'
      riskRegister.push({
        id: 'ROUTE_RECOMMENDATION',
        category: 'MARKET_STRUCTURE',
        severity: 'INFO',
        title: `${railName} Optimal Route`,
        finding:
          quote.savingsUsdc !== null && quote.savingsUsdc > 0
            ? `${railName} saves ${quote.savingsUsdc} USDC compared to alternative rails for transferring ${quote.amountUsdc} USDC to ${destinationChain}.`
            : `${railName} is the verified route for transferring ${quote.amountUsdc} USDC to ${destinationChain}.`,
        evidence: {
          recommendedRail: quote.recommendedRail,
          savingsUsdc: quote.savingsUsdc,
          amountUsdc: quote.amountUsdc,
          destinationChain,
          gatewayFeeUsdc: quote.gateway.totalCostUsdc,
          cctpFeeUsdc: quote.cctp.totalCostUsdc,
        },
        threshold: 'Direct comparison between Gateway 0.005% transfer fee and CCTP forwarder quote.',
        remediation: `Bridge transfer via ${railName} directly to ${destinationChain}.`,
      })
    } else if (quote.status === 'PARTIAL') {
      riskRegister.push({
        id: 'ROUTE_PARTIAL',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        title: 'Single Rail Quoted',
        finding: 'Only one bridge rail returned pricing; cross-rail comparison is withheld to prevent false precision.',
        evidence: { destinationChain, amountUsdc, gatewayAvailable: quote.gateway.available, cctpAvailable: quote.cctp.available },
        threshold: 'Both rails must return before savings are claimed.',
        remediation: 'Review individual rail fee before initiating bridge transfer.',
      })
    }

    return { data: { ...quote, riskRegister } }
  }

  // ─────────────────────────────────────────────────────────────
  // 7. YIELD VAULT ANALYTICS
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-yield-vault-analytics') {
    const analytics = await readVaultAnalytics({ windowDays: inputPayload.windowDays })

    return { data: analytics }
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
  // 9. VAULT YIELD REPORT (llm, Reporting & Tax)
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-vault-yield-tax-report') {
    const address = String(inputPayload.address || '').trim()
    const report = await readVaultYieldReport({ address })

    return { data: report }
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
