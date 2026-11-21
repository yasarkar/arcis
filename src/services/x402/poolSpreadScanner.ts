// src/services/x402/poolSpreadScanner.ts
// All-Pools Spread & Mispricing Scanner for `arc-cross-dex-arbitrage-sentinel`.
//
// Scans either ALL 6 deployed Arc Testnet V4 pools in parallel (`pair: 'ALL_POOLS'`) or a
// single requested pair, comparing each pool's live on-chain reserve ratio against live
// external market oracle rates and deducting measured Arc USDC gas costs.

import { formatUnits, type Address } from 'viem'
import { POOL_CONTRACTS, STABLE_SWAP_ABI } from '../../config/poolsConfig.js'
import { estimateArcGasCostUsdc } from '../arcGasService.js'
import { getArcPublicClient, resilientReadContract } from '../rpc/index.js'
import { getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService.js'
import { resolveTradePoolMeta, type TradePoolMeta } from './tradeExecutionAdvisor.js'

export const POOL_SPREAD_SCANNER_SERVICE_ID = 'arc-cross-dex-arbitrage-sentinel'

export const ALL_ARC_POOL_PAIRS = [
  'USDC/EURC',
  'USDC/WETH',
  'USDC/cirBTC',
  'EURC/WETH',
  'EURC/cirBTC',
  'cirBTC/WETH',
] as const

export type ArcPoolPair = (typeof ALL_ARC_POOL_PAIRS)[number]

export interface ScannedPoolSpread {
  pair: string
  dexName: string
  poolAddress: Address
  quoteUnit: string
  poolRate: number
  oracleRate: number
  grossSpreadPct: number
  grossProfitUsdc: number
  estimatedGasCostUsdc: number
  netProfitUsdc: number
  netProfitPct: number
  meetsThreshold: boolean
  directionHint: string
  reserves: Record<string, number>
}

const GAS_LIMIT = 120_000n

function oraclePriceOf(prices: Record<string, number>, symbol: string): number | null {
  const direct = prices[symbol] ?? prices[symbol.toUpperCase()] ?? prices[normalizeTokenSymbol(symbol)]
  return typeof direct === 'number' && Number.isFinite(direct) && direct > 0 ? direct : null
}

async function readReserves(poolAddress: Address): Promise<{ reserveA: bigint; reserveB: bigint } | null> {
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
  } catch (err) {
    console.warn(`[poolSpreadScanner] On-chain reserves unavailable for ${poolAddress}:`, err)
    return null
  }
}

function buildReserveSnapshot(meta: TradePoolMeta, reserves: { reserveA: bigint; reserveB: bigint }) {
  const amountA = Number(formatUnits(reserves.reserveA, meta.decA))
  const amountB = Number(formatUnits(reserves.reserveB, meta.decB))
  return {
    amountA,
    amountB,
    record: {
      [meta.symbolA]: Number(amountA.toFixed(6)),
      [meta.symbolB]: Number(amountB.toFixed(6)),
    },
    legacyRecord: {
      pool: meta.address,
      ...(meta.symbolA === 'USDC' ? { reserveUSDC: amountA } : { [`reserve${meta.symbolA}`]: amountA }),
      ...(meta.symbolB === 'EURC'
        ? { reserveEURC: amountB }
        : meta.symbolB === 'cirBTC'
          ? { reserveCirBTC: amountB }
          : meta.symbolB === 'WETH'
            ? { reserveWETH: amountB }
            : { [`reserve${meta.symbolB}`]: amountB }),
    },
  }
}

export async function scanArcPoolSpreads(input: {
  pair?: string
  tradeSizeUsdc?: number
  minNetProfitPct?: number
}): Promise<{ data: Record<string, any> }> {
  const now = Date.now()
  const rawPair = String(input.pair || 'ALL_POOLS').trim()
  const isAllPools = rawPair.toUpperCase() === 'ALL_POOLS' || rawPair.toUpperCase() === 'ALL'
  const tradeSize = Number(input.tradeSizeUsdc) || 25_000
  const minNetProfitPct =
    input.minNetProfitPct !== undefined && Number.isFinite(Number(input.minNetProfitPct))
      ? Number(input.minNetProfitPct)
      : 0.1

  // Resolve target pools
  let targetMetas: TradePoolMeta[] = []
  if (isAllPools) {
    targetMetas = ALL_ARC_POOL_PAIRS.map((p) => {
      const [a, b] = p.split('/')
      return resolveTradePoolMeta(a, b)
    }).filter((m): m is TradePoolMeta => m !== null)
  } else {
    const [rawA, rawB] = rawPair.split('/')
    const meta = rawA && rawB ? resolveTradePoolMeta(rawA, rawB) : null
    if (!meta) {
      return {
        data: {
          status: 'UNAVAILABLE',
          timestamp: now,
          pair: rawPair,
          unavailable: ['active Arc L1 DEX pool for requested pair'],
          reason: `Spread not computed: no active DEX liquidity pool exists on Arc Testnet for pair ${rawPair}.`,
          liveOraclePrices: {},
          onChainReserves: null,
          scannedPools: [],
          riskRegister: [
            {
              id: 'ARBITRAGE_READ_UNAVAILABLE',
              category: 'DATA_QUALITY',
              severity: 'HIGH',
              title: 'Pool Unavailable on Arc DEX',
              finding: `No active DEX liquidity pool exists on Arc Testnet for pair ${rawPair}.`,
              evidence: { pair: rawPair },
              threshold: 'A deployed Arc L1 pool contract is required.',
              remediation: 'Select ALL_POOLS or one of the 6 active Arc Testnet pools.',
            },
          ],
        },
      }
    }
    targetMetas = [meta]
  }

  // Fetch oracle prices, Arc gas, and all target pool reserves in parallel
  const [livePrices, gasUsdc, reserveResults] = await Promise.all([
    getLiveTokenPrices().catch(() => ({} as Record<string, number>)),
    estimateArcGasCostUsdc(GAS_LIMIT),
    Promise.all(targetMetas.map(async (meta) => ({ meta, reserves: await readReserves(meta.address) }))),
  ])

  const scannedPools: ScannedPoolSpread[] = []
  const unavailablePools: Array<{ pair: string; missing: string[] }> = []
  let firstLegacyReserves: Record<string, any> | null = null

  for (const { meta, reserves } of reserveResults) {
    const pairLabel = `${meta.symbolA}/${meta.symbolB}`
    const priceA = oraclePriceOf(livePrices, meta.symbolA)
    const priceB = oraclePriceOf(livePrices, meta.symbolB)
    const oracleMarketRate = priceA !== null && priceB !== null ? priceB / priceA : null

    const snap = reserves ? buildReserveSnapshot(meta, reserves) : null
    if (!firstLegacyReserves && snap) {
      firstLegacyReserves = snap.legacyRecord
    }

    const poolRate = snap && snap.amountB > 0 ? snap.amountA / snap.amountB : null

    if (!reserves || poolRate === null || oracleMarketRate === null || gasUsdc === null) {
      const missing: string[] = []
      if (oracleMarketRate === null) missing.push('external oracle price for the pair')
      if (poolRate === null) {
        missing.push(
          meta.address === POOL_CONTRACTS.STABLE_SWAP_POOL
            ? 'on-chain StableSwap pool reserves'
            : 'on-chain DEX pool reserves'
        )
      }
      if (gasUsdc === null) missing.push('Arc L1 gas price')
      unavailablePools.push({ pair: pairLabel, missing })
      continue
    }

    const rawSpread = Math.abs(oracleMarketRate - poolRate) / poolRate
    const spreadPct = Number((rawSpread * 100).toFixed(3))
    const grossProfit = Number((tradeSize * (spreadPct / 100)).toFixed(2))
    const netProfit = Number(Math.max(0, grossProfit - gasUsdc).toFixed(2))
    const netProfitPct = Number(((netProfit / tradeSize) * 100).toFixed(3))
    const meetsThreshold = netProfitPct >= minNetProfitPct

    const directionHint =
      poolRate < oracleMarketRate
        ? `${meta.symbolB} trades below external oracle on ${meta.dexName}`
        : `${meta.symbolB} trades above external oracle on ${meta.dexName}`

    scannedPools.push({
      pair: pairLabel,
      dexName: meta.dexName,
      poolAddress: meta.address,
      quoteUnit: `${meta.symbolA} per ${meta.symbolB}`,
      poolRate: Number(poolRate.toFixed(6)),
      oracleRate: Number(oracleMarketRate.toFixed(6)),
      grossSpreadPct: spreadPct,
      grossProfitUsdc: grossProfit,
      estimatedGasCostUsdc: gasUsdc,
      netProfitUsdc: netProfit,
      netProfitPct,
      meetsThreshold,
      directionHint,
      reserves: snap!.record,
    })
  }

  // If no pool could be measured at all, fail closed with UNAVAILABLE
  if (scannedPools.length === 0) {
    const firstMissing = unavailablePools[0]?.missing ?? ['on-chain pool reserves or oracle rates']
    const requestedTokens = isAllPools
      ? ['USDC', 'EURC', 'WETH', 'cirBTC']
      : [targetMetas[0].symbolA, targetMetas[0].symbolB]
    const oracleSnapshot: Record<string, number | null> = {}
    for (const sym of requestedTokens) {
      oracleSnapshot[sym] = oraclePriceOf(livePrices, sym)
    }

    return {
      data: {
        status: 'UNAVAILABLE',
        timestamp: now,
        pair: isAllPools ? 'ALL_POOLS' : `${targetMetas[0].symbolA}/${targetMetas[0].symbolB}`,
        poolsScannedCount: targetMetas.length,
        poolsMeasuredCount: 0,
        unavailable: firstMissing,
        unavailablePools,
        reason: `Spread not computed: could not read ${firstMissing.join(', ')}.`,
        liveOraclePrices: oracleSnapshot,
        onChainReserves: firstLegacyReserves,
        scannedPools: [],
        riskRegister: [
          {
            id: 'ARBITRAGE_READ_UNAVAILABLE',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Pool Spread Read Unavailable',
            finding: `Could not read ${firstMissing.join(', ')}.`,
            evidence: { pair: rawPair, unavailable: firstMissing },
            threshold: 'Reserves, oracle rates, and gas price must return.',
            remediation: 'Retry the query once Arc RPC nodes and oracle feeds respond.',
          },
        ],
      },
    }
  }

  // Sort by highest net profit %, then gross spread %
  scannedPools.sort((a, b) => {
    if (b.netProfitPct !== a.netProfitPct) return b.netProfitPct - a.netProfitPct
    return b.grossSpreadPct - a.grossSpreadPct
  })

  const top = scannedPools[0]
  const opportunitiesCount = scannedPools.filter((p) => p.meetsThreshold).length
  const anyProfitable = opportunitiesCount > 0

  const buyPrice = Number(Math.min(top.poolRate, top.oracleRate).toFixed(4))
  const sellPrice = Number(Math.max(top.poolRate, top.oracleRate).toFixed(4))

  const topResult = reserveResults.find((r) => r.meta.address === top.poolAddress)
  const topLegacyReserves =
    topResult && topResult.reserves ? buildReserveSnapshot(topResult.meta, topResult.reserves).legacyRecord : null

  const liveOracleSummary: Record<string, number> = {}
  const oracleSymbols = isAllPools
    ? ['USDC', 'EURC', 'WETH', 'cirBTC']
    : [targetMetas[0].symbolA, targetMetas[0].symbolB]
  for (const sym of oracleSymbols) {
    const p = oraclePriceOf(livePrices, sym)
    if (p !== null) liveOracleSummary[sym] = p
  }

  const riskRegister: Array<Record<string, any>> = [
    anyProfitable
      ? {
          id: 'ARBITRAGE_OPPORTUNITY',
          category: 'OPPORTUNITY',
          severity: 'INFO',
          title: isAllPools
            ? `${opportunitiesCount}/${scannedPools.length} Pools Above Hurdle (Top: ${top.pair} · ${top.grossSpreadPct}%)`
            : `Pool Price Divergence (${top.pair} · ${top.grossSpreadPct}%)`,
          finding: `Largest spread is on ${top.pair} (${top.grossSpreadPct}% vs external oracle), yielding an estimated $${top.netProfitUsdc} USDC net difference (${top.netProfitPct}%) after $${top.estimatedGasCostUsdc} USDC Arc gas.`,
          evidence: {
            pair: top.pair,
            poolsMeasuredCount: scannedPools.length,
            opportunitiesCount,
            spreadPct: top.grossSpreadPct,
            netProfitUsdc: top.netProfitUsdc,
            netProfitPct: top.netProfitPct,
            grossProfitUsdc: top.grossProfitUsdc,
            gasUsdc: top.estimatedGasCostUsdc,
            buyPrice,
            sellPrice,
          },
          threshold: `Net difference >= ${minNetProfitPct}% minimum hurdle rate.`,
          remediation: `Review live quote in Swap for ${top.pair}. External oracle is a price reference, not an automated second execution venue.`,
        }
      : {
          id: 'SPREAD_BELOW_THRESHOLD',
          category: 'MARKET_STRUCTURE',
          severity: 'LOW',
          title: isAllPools
            ? `All ${scannedPools.length} Pools Within ${minNetProfitPct}% Threshold`
            : 'Pool Spread Below Hurdle Rate',
          finding: `Largest measured spread is ${top.grossSpreadPct}% on ${top.pair} ($${top.netProfitUsdc} USDC / ${top.netProfitPct}%), below the ${minNetProfitPct}% threshold.`,
          evidence: {
            pair: top.pair,
            poolsMeasuredCount: scannedPools.length,
            spreadPct: top.grossSpreadPct,
            netProfitUsdc: top.netProfitUsdc,
            minNetProfitPct,
          },
          threshold: `Net difference must exceed ${minNetProfitPct}%.`,
          remediation: 'Pools are closely aligned with external market prices; monitor until divergence widens.',
        },
  ]

  if (unavailablePools.length > 0) {
    riskRegister.push({
      id: 'PARTIAL_POOL_COVERAGE',
      category: 'DATA_QUALITY',
      severity: 'LOW',
      title: `${unavailablePools.length} Pool(s) Could Not Be Measured`,
      finding: `Skipped ${unavailablePools.map((p) => p.pair).join(', ')} because reserves or oracle prices did not return.`,
      evidence: {
        measuredPools: scannedPools.length,
        skippedPools: unavailablePools.length,
      },
      threshold: 'All requested pools must return reserves and oracle prices for full coverage.',
      remediation: 'Re-run once all Arc RPC pool reads and oracle feeds recover.',
    })
  }

  return {
    data: {
      status: anyProfitable ? 'OPPORTUNITY_DETECTED' : 'SPREAD_BELOW_THRESHOLD',
      timestamp: now,
      pair: isAllPools ? 'ALL_POOLS' : top.pair,
      bestPair: top.pair,
      poolsScannedCount: targetMetas.length,
      poolsMeasuredCount: scannedPools.length,
      opportunitiesCount,
      liveOraclePrices: liveOracleSummary,
      bestRoute: {
        pair: top.pair,
        quoteUnit: top.quoteUnit,
        buyDex: top.dexName,
        buyPriceUsdc: buyPrice,
        sellDex: 'External Market Oracle (Reference)',
        sellPriceUsdc: sellPrice,
        grossSpreadPct: top.grossSpreadPct,
        recommendedTradeSize: tradeSize,
        estimatedGasCostUsdc: top.estimatedGasCostUsdc,
        netProfitUsdc: top.netProfitUsdc,
        netProfitPct: top.netProfitPct,
      },
      scannedPools,
      ...(unavailablePools.length > 0 ? { unavailablePools } : {}),
      onChainReserves: topLegacyReserves,
      targetContracts: {
        pool: top.poolAddress,
        stableSwapPool: POOL_CONTRACTS.STABLE_SWAP_POOL,
        router: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
      },
      riskRegister,
    },
  }
}
