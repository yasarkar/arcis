// src/services/x402/tradeExecutionAdvisor.ts
// Smart Trade & Execution Advisor for `arc-deep-liquidity-slippage-optimizer`.
//
// Combines live Arc L1 pool depth, direct vs 2-hop route comparison across the 6 deployed
// V4 pools, pure AMM curve price impact vs external oracle deviation, LP fee disclosure,
// reserve/sandwich exposure, real Batch-1 curve quoting, and 2-hop Step 2 handoff metadata.
// Every figure is derived from on-chain reserves, live swap quotes, live oracle prices, and
// measured Arc gas — never invented.

import { formatUnits, parseUnits, type Address } from 'viem'
import {
  CIRBTC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  EURC_CIRBTC_CONSTANT_PRODUCT_LP_FEE_BPS,
  EURC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS,
  POOL_CONTRACTS,
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_MAX_SLIPPAGE_BPS,
  POOL_MIN_SLIPPAGE_BPS,
  STABLE_SWAP_ABI,
  STABLE_SWAP_AMP,
  STABLE_SWAP_ANN_MULTIPLIER,
  STABLE_SWAP_LP_FEE_BPS,
  WETH_CONSTANT_PRODUCT_LP_FEE_BPS,
} from '../../config/poolsConfig.js'
import type { ActionableSignalPayload } from '../../types/marketplace.js'
import { swapMinimumUnits, swapPercentToBps } from '../../utils/swapSlippage.js'
import { estimateArcGasCostUsdc } from '../arcGasService.js'
import { getArcPublicClient, resilientReadContract } from '../rpc/index.js'
import { getSwapEstimate, resolveArcNativeRoute } from '../swapService.js'
import { getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService.js'

export const TRADE_EXECUTION_ADVISOR_SERVICE_ID = 'arc-deep-liquidity-slippage-optimizer'

const ARC_SWAP_TOKENS = ['USDC', 'EURC', 'WETH', 'cirBTC'] as const
const HIGH_SLIPPAGE_THRESHOLD_PCT = 1.0
const SEVERE_SLIPPAGE_THRESHOLD_PCT = 5.0
const HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT = 5.0
const MODERATE_RESERVE_EXPOSURE_THRESHOLD_PCT = 2.0
const TARGET_PER_BATCH_RESERVE_PCT = 2.5
const MAX_RECOMMENDED_BATCHES = 10
const SWAP_GAS_LIMIT = 120_000n

export const ADVISOR_MIN_SLIPPAGE_PCT = POOL_MIN_SLIPPAGE_BPS / 100
export const ADVISOR_MAX_SLIPPAGE_PCT = POOL_MAX_SLIPPAGE_BPS / 100
export const ADVISOR_DEFAULT_SLIPPAGE_PCT = POOL_DEFAULT_SLIPPAGE_BPS / 100

const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  EURC: 6,
  cirBTC: 8,
  WETH: 18,
}

export type TradeExecutionVerdictCode = 'EXECUTE' | 'CAUTION_SPLIT' | 'DO_NOT_EXECUTE'

export interface TradeExecutionVerdict {
  code: TradeExecutionVerdictCode
  label: string
  tone: 'success' | 'cancelled' | 'error'
  reason: string
}

/**
 * Single deterministic Go / Caution / Do-Not-Execute decision rule for Smart Trade & Execution Advisor.
 * Evaluates AMM curve impact, external oracle mispricing, pool reserve depth, and batch viability.
 */
export function resolveTradeExecutionVerdict(params: {
  ammPriceImpactPct?: number | null
  signedPriceImpactPct?: number | null
  overallPriceImpactPct?: number | null
  tradeReserveExposurePct?: number | null
  recommendedBatchCount?: number | null
  perBatchAmmPriceImpactPct?: number | null
  exceedsCappedBatchDepth?: boolean
}): TradeExecutionVerdict {
  const amm = typeof params.ammPriceImpactPct === 'number' && Number.isFinite(params.ammPriceImpactPct)
    ? params.ammPriceImpactPct
    : null
  const signedOracle =
    typeof params.signedPriceImpactPct === 'number' && Number.isFinite(params.signedPriceImpactPct)
      ? params.signedPriceImpactPct
      : null
  const adverseOracle =
    signedOracle !== null
      ? Math.max(0, signedOracle)
      : typeof params.overallPriceImpactPct === 'number' && Number.isFinite(params.overallPriceImpactPct)
        ? Math.max(0, params.overallPriceImpactPct)
        : null
  const reserve =
    typeof params.tradeReserveExposurePct === 'number' && Number.isFinite(params.tradeReserveExposurePct)
      ? params.tradeReserveExposurePct
      : null
  const batches =
    typeof params.recommendedBatchCount === 'number' && params.recommendedBatchCount > 1
      ? Math.round(params.recommendedBatchCount)
      : 1
  const perBatchAmm =
    typeof params.perBatchAmmPriceImpactPct === 'number' && Number.isFinite(params.perBatchAmmPriceImpactPct)
      ? params.perBatchAmmPriceImpactPct
      : null

  const exceedsCap =
    Boolean(params.exceedsCappedBatchDepth) ||
    (batches >= MAX_RECOMMENDED_BATCHES &&
      reserve !== null &&
      reserve / batches > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT)

  // Baseline pool spot mispricing vs oracle (excludes curve impact of this order)
  const baselineOracleGapPct =
    adverseOracle !== null && amm !== null ? Math.max(0, adverseOracle - amm) : null

  // 1. DO NOT EXECUTE: severe unmitigated loss, pool exhausted beyond batch cap, or badly mispriced pool
  if (exceedsCap) {
    return {
      code: 'DO_NOT_EXECUTE',
      label: 'Do Not Execute',
      tone: 'error',
      reason: `Order uses ${reserve !== null ? `${reserve.toFixed(1)}%` : 'excessive share'} of pool depth — even ${MAX_RECOMMENDED_BATCHES} batches exceed safe depth. Reduce trade size.`,
    }
  }
  if (baselineOracleGapPct !== null && baselineOracleGapPct >= SEVERE_SLIPPAGE_THRESHOLD_PCT) {
    return {
      code: 'DO_NOT_EXECUTE',
      label: 'Do Not Execute',
      tone: 'error',
      reason: `Pool spot price trails external oracle by ~${baselineOracleGapPct.toFixed(1)}% — unfavorable execution rate even if split.`,
    }
  }
  if (batches > 1 && perBatchAmm !== null && perBatchAmm >= SEVERE_SLIPPAGE_THRESHOLD_PCT) {
    return {
      code: 'DO_NOT_EXECUTE',
      label: 'Do Not Execute',
      tone: 'error',
      reason: `Even Batch 1 incurs ${perBatchAmm.toFixed(1)}% AMM curve impact — reduce trade size before executing.`,
    }
  }
  if (
    batches === 1 &&
    ((amm !== null && amm >= SEVERE_SLIPPAGE_THRESHOLD_PCT) ||
      (adverseOracle !== null && adverseOracle >= SEVERE_SLIPPAGE_THRESHOLD_PCT))
  ) {
    const worst = Math.max(amm ?? 0, adverseOracle ?? 0)
    return {
      code: 'DO_NOT_EXECUTE',
      label: 'Do Not Execute',
      tone: 'error',
      reason: `Severe ${worst.toFixed(1)}% price impact detected — avoid executing at this size/price.`,
    }
  }

  // 2. CAUTION / SPLIT: viable with batching or elevated 1%–5% slippage/reserve caution
  if (batches > 1) {
    return {
      code: 'CAUTION_SPLIT',
      label: 'Caution · Split Trade',
      tone: 'cancelled',
      reason: `Exceeds ${HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT}% pool depth — do not swap all at once; split into ${batches} spaced batches.`,
    }
  }
  if (
    (amm !== null && amm >= HIGH_SLIPPAGE_THRESHOLD_PCT) ||
    (adverseOracle !== null && adverseOracle >= HIGH_SLIPPAGE_THRESHOLD_PCT) ||
    (reserve !== null && reserve > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT)
  ) {
    const worst = Math.max(amm ?? 0, adverseOracle ?? 0)
    return {
      code: 'CAUTION_SPLIT',
      label: 'Proceed with Caution',
      tone: 'cancelled',
      reason: `Elevated ${worst.toFixed(2)}% price impact — verify Min. Guaranteed Output before confirming.`,
    }
  }

  // 3. SAFE TO EXECUTE: low impact, healthy pool depth, fair/favorable pricing
  return {
    code: 'EXECUTE',
    label: 'Safe to Execute',
    tone: 'success',
    reason: 'Low AMM impact and healthy pool depth — safe to execute in a single swap.',
  }
}

export interface TradePoolMeta {
  address: Address
  dexName: string
  decA: number
  decB: number
  symbolA: string
  symbolB: string
  isStable: boolean
  feeBps: number
}

export interface EvaluatedTradeRoute {
  path: string
  hops: 1 | 2
  intermediateToken: string | null
  expectedOutput: number
  minGuaranteedOutput: string | null
  effectiveExecutionPrice: number
  /** Pure AMM pool curve price impact (%), measured from live on-chain reserves excluding LP fee. */
  ammPriceImpactPct: number | null
  /** Compounded pool LP swap fee (%) across route hops. */
  poolFeePct: number | null
  /** Adverse deviation against external oracle benchmark (%). */
  priceImpactPct: number | null
  /** Signed deviation vs external oracle (+ = worse than oracle, - = better than oracle). */
  signedPriceImpactPct: number | null
  estimatedGasUsdc: number | null
  netOutputUsdc: number | null
  leg1Output?: number
  recommended: boolean
}

export interface TradeExecutionSizing {
  recommendedBatchCount: number
  perBatchInputAmount: number
  /** Real AMM quote for Batch 1 (accounts for curve non-linearity when batching). */
  perBatchExpectedOutput: number | null
  /** AMM curve price impact (%) for a single Batch-1 sized swap vs full order. */
  perBatchAmmPriceImpactPct: number | null
  /** AMM curve price impact (%) if the full order is executed in one transaction. */
  singleSwapAmmPriceImpactPct: number | null
  estimatedTotalGasUsdc: number | null
  suggestedMaxSlippagePct: number
  slippageClampedFromPct?: number
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
      dexName: 'Arcis StableSwap V4 Pool',
      decA: 6,
      decB: 6,
      symbolA: 'USDC',
      symbolB: 'EURC',
      isStable: true,
      feeBps: Number(STABLE_SWAP_LP_FEE_BPS),
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
      isStable: false,
      feeBps: Number(CONSTANT_PRODUCT_LP_FEE_BPS),
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
      isStable: false,
      feeBps: Number(WETH_CONSTANT_PRODUCT_LP_FEE_BPS),
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
      isStable: false,
      feeBps: Number(EURC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS),
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
      isStable: false,
      feeBps: Number(EURC_CIRBTC_CONSTANT_PRODUCT_LP_FEE_BPS),
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
      isStable: false,
      feeBps: Number(CIRBTC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS),
    }
  }
  return null
}

/** Curve StableSwap invariant D (mirrors StableSwapPoolV4 & swapService). */
function getCurveD(x: bigint, y: bigint, A: bigint = STABLE_SWAP_AMP): bigint {
  const s = x + y
  if (s === 0n) return 0n
  let d = s
  const Ann = A * STABLE_SWAP_ANN_MULTIPLIER
  for (let i = 0; i < 255; i++) {
    let dP = d
    dP = (dP * d) / (x * 2n)
    dP = (dP * d) / (y * 2n)
    const dPrev = d
    const num = (Ann * s + dP * 2n) * d
    const den = (Ann - 1n) * d + dP * 3n
    d = num / den
    if (d > dPrev ? d - dPrev <= 1n : dPrev - d <= 1n) return d
  }
  return d
}

/** Curve StableSwap invariant y given new x and D (mirrors StableSwapPoolV4 & swapService). */
function getCurveY(x: bigint, d: bigint, A: bigint = STABLE_SWAP_AMP): bigint {
  const Ann = A * STABLE_SWAP_ANN_MULTIPLIER
  let c = d
  c = (c * d) / (x * 2n)
  c = (c * d) / (Ann * 2n)
  const b = x + d / Ann
  let y = d
  for (let i = 0; i < 255; i++) {
    const yPrev = y
    y = (y * y + c) / (2n * y + b - d)
    if (y > yPrev ? y - yPrev <= 1n : yPrev - y <= 1n) return y
  }
  return y
}

/**
 * Pure AMM curve price impact (%) for a single leg, measured directly from live pool reserves
 * (excludes LP fee so curve slippage and LP fee are disclosed separately).
 */
export function computePoolAmmPriceImpactPct(params: {
  meta: TradePoolMeta
  fromToken: string
  amountIn: number
  reserveA: bigint
  reserveB: bigint
}): number | null {
  const { meta, fromToken, amountIn, reserveA, reserveB } = params
  if (reserveA <= 0n || reserveB <= 0n || !Number.isFinite(amountIn) || amountIn <= 0) return null

  const isFromA = canonicalTokenSymbol(meta.symbolA) === canonicalTokenSymbol(fromToken)
  const decIn = isFromA ? meta.decA : meta.decB
  const decOut = isFromA ? meta.decB : meta.decA
  const reserveIn = isFromA ? reserveA : reserveB
  const reserveOut = isFromA ? reserveB : reserveA

  const feeFactor = 1 - meta.feeBps / 10_000
  const amountInAfterFeeFloat = amountIn * feeFactor
  if (!Number.isFinite(amountInAfterFeeFloat) || amountInAfterFeeFloat <= 0) return null

  if (!meta.isStable) {
    const reserveInFloat = Number(formatUnits(reserveIn, decIn))
    if (!Number.isFinite(reserveInFloat) || reserveInFloat <= 0) return null
    // Constant-product exact curve impact: dx_net / (x + dx_net)
    const impactPct = (amountInAfterFeeFloat / (reserveInFloat + amountInAfterFeeFloat)) * 100
    return Number(Math.max(0, impactPct).toFixed(3))
  }

  // StableSwap (A = 100): measure marginal spot rate with a tiny probe and compare to actual trade curve output.
  try {
    const dxUnits = parseUnits(amountInAfterFeeFloat.toFixed(decIn), decIn)
    if (dxUnits <= 0n) return 0
    const d = getCurveD(reserveIn, reserveOut)
    if (d <= 0n) return null

    const epsUnits = reserveIn > 1_000_000n ? reserveIn / 1_000_000n : 1n
    const yEps = getCurveY(reserveIn + epsUnits, d)
    const dyEps = reserveOut > yEps ? reserveOut - yEps : 0n
    if (dyEps <= 0n) return null

    const yTrade = getCurveY(reserveIn + dxUnits, d)
    const dyTrade = reserveOut > yTrade ? reserveOut - yTrade : 0n
    if (dyTrade <= 0n) return null

    const spotRate = Number(formatUnits(dyEps, decOut)) / Number(formatUnits(epsUnits, decIn))
    const execRate = Number(formatUnits(dyTrade, decOut)) / Number(formatUnits(dxUnits, decIn))
    if (!Number.isFinite(spotRate) || spotRate <= 0 || !Number.isFinite(execRate)) return null

    const impactPct = Math.max(0, ((spotRate - execRate) / spotRate) * 100)
    return Number(impactPct.toFixed(3))
  } catch {
    return null
  }
}

function combinePercentageCosts(leg1Pct: number | null, leg2Pct: number | null): number | null {
  if (leg1Pct === null || leg2Pct === null) return null
  const combined = (1 - (1 - leg1Pct / 100) * (1 - leg2Pct / 100)) * 100
  return Number(Math.max(0, combined).toFixed(3))
}

function formatMinGuaranteedOutput(
  expectedOutput: number,
  tokenSymbol: string,
  slippagePct: number
): string | null {
  if (!Number.isFinite(expectedOutput) || expectedOutput <= 0) return null
  const decimals = TOKEN_DECIMALS[tokenSymbol] ?? 6
  try {
    const outUnits = parseUnits(expectedOutput.toFixed(decimals), decimals)
    if (outUnits <= 0n) return null
    const minUnits = swapMinimumUnits(outUnits, swapPercentToBps(slippagePct))
    if (minUnits <= 0n) return null
    const raw = formatUnits(minUnits, decimals)
    const num = Number(raw)
    if (!Number.isFinite(num)) return raw
    const displayDecimals = num >= 100 ? 2 : num >= 1 ? 4 : 6
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: displayDecimals })} ${tokenSymbol}`
  } catch {
    return null
  }
}

function formatTokenAmountDisplay(value: number, symbol: string): string {
  const displayDecimals = value >= 100 ? 4 : value >= 0.01 ? 4 : 6
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: displayDecimals })} ${symbol}`
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
  const amount = Number(input.amount) || 10
  const fromCanonical = canonicalTokenSymbol(String(input.fromToken || 'USDC'))
  const defaultTo = fromCanonical === 'WETH' ? 'USDC' : 'WETH'
  const toCanonical = canonicalTokenSymbol(String(input.toToken || defaultTo))
  const fromQuery = fromCanonical.toUpperCase()
  const toQuery = toCanonical.toUpperCase()

  const rawSlip = Number(input.slippageTolerancePct)
  let slippageTolerancePct = ADVISOR_DEFAULT_SLIPPAGE_PCT
  let slippageClampedFromPct: number | undefined
  if (Number.isFinite(rawSlip) && rawSlip > 0) {
    const clamped = Math.min(ADVISOR_MAX_SLIPPAGE_PCT, Math.max(ADVISOR_MIN_SLIPPAGE_PCT, rawSlip))
    slippageTolerancePct = Number(clamped.toFixed(2))
    if (Math.abs(rawSlip - slippageTolerancePct) > 0.001) {
      slippageClampedFromPct = Number(rawSlip.toFixed(2))
    }
  }

  if (fromQuery === toQuery || !Number.isFinite(amount) || amount <= 0) {
    return {
      data: {
        status: 'UNAVAILABLE',
        inputAmount: `${amount} ${fromCanonical}`,
        unavailable: ['distinct source and destination tokens with positive amount'],
        reason:
          fromQuery === toQuery
            ? `Please choose two different tokens — you cannot swap ${fromCanonical} for ${toCanonical}.`
            : 'Please enter a swap amount greater than zero.',
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

  // Per-request reserve snapshot cache so each unique pool is read at most once.
  const reserveCache = new Map<string, Promise<{ reserveA: bigint; reserveB: bigint } | null>>()
  const getPoolReservesCached = (poolAddress: Address) => {
    const key = poolAddress.toLowerCase()
    const existing = reserveCache.get(key)
    if (existing) return existing
    const promise = readPoolReserves(poolAddress)
    reserveCache.set(key, promise)
    return promise
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
    directRoute ? getPoolReservesCached(directRoute.poolAddress) : Promise.resolve(null),
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

  // Signed deviation against external oracle benchmark:
  // positive (+) = worse than oracle benchmark, negative (-) = favorable pool pricing vs oracle.
  const computeSignedImpact = (effectiveRate: number): number | null =>
    benchmarkRate !== null && benchmarkRate > 0
      ? Number((((benchmarkRate - effectiveRate) / benchmarkRate) * 100).toFixed(3))
      : null

  const toAdverseImpact = (signed: number | null): number | null =>
    signed === null ? null : Number(Math.max(0, signed).toFixed(3))

  const computeNetOutputUsdc = (expectedOut: number, hops: 1 | 2): number | null => {
    if (spotTo === null) return null
    const gasCost = arcGasUsdc !== null ? arcGasUsdc * hops : 0
    return round6(expectedOut * spotTo - gasCost)
  }

  const directSignedImpactPct = directRate !== null ? computeSignedImpact(directRate) : null
  const directImpactPct = toAdverseImpact(directSignedImpactPct)
  const directAmmImpactPct =
    directRoute && directReserves && directMeta
      ? computePoolAmmPriceImpactPct({
          meta: directMeta,
          fromToken: fromCanonical,
          amountIn: amount,
          reserveA: directReserves.reserveA,
          reserveB: directReserves.reserveB,
        })
      : null
  const directPoolFeePct = directRoute && directMeta ? Number((directMeta.feeBps / 100).toFixed(2)) : null

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
      minGuaranteedOutput: formatMinGuaranteedOutput(directOutputNum, toCanonical, slippageTolerancePct),
      effectiveExecutionPrice: round6(directRate),
      ammPriceImpactPct: directAmmImpactPct,
      poolFeePct: directPoolFeePct,
      priceImpactPct: directImpactPct,
      signedPriceImpactPct: directSignedImpactPct,
      estimatedGasUsdc: arcGasUsdc !== null ? round6(arcGasUsdc) : null,
      netOutputUsdc: computeNetOutputUsdc(directOutputNum, 1),
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

  if (intermediateCandidates.length > 0) {
    const twoHopResults = await Promise.all(
      intermediateCandidates.map(async (mid) => {
        try {
          const midUp = mid.toUpperCase()
          const leg1Route = resolveArcNativeRoute(fromQuery, midUp)
          const leg2Route = resolveArcNativeRoute(midUp, toQuery)
          const leg1Meta = resolveTradePoolMeta(fromCanonical, mid)
          const leg2Meta = resolveTradePoolMeta(mid, toCanonical)

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

          const [leg2, leg1Reserves, leg2Reserves] = await Promise.all([
            getSwapEstimate({
              fromChain: 'Arc_Testnet',
              toChain: 'Arc_Testnet',
              tokenIn: midUp,
              tokenOut: toQuery,
              amountIn: leg1Out.toString(),
              sourceAdapter: null,
            }),
            leg1Route ? getPoolReservesCached(leg1Route.poolAddress) : Promise.resolve(null),
            leg2Route ? getPoolReservesCached(leg2Route.poolAddress) : Promise.resolve(null),
          ])
          const leg2Out = parseFloat(leg2.estimatedOutput)
          if (!Number.isFinite(leg2Out) || leg2Out <= 0) return null

          const leg1AmmImpact =
            leg1Meta && leg1Reserves
              ? computePoolAmmPriceImpactPct({
                  meta: leg1Meta,
                  fromToken: fromCanonical,
                  amountIn: amount,
                  reserveA: leg1Reserves.reserveA,
                  reserveB: leg1Reserves.reserveB,
                })
              : null
          const leg2AmmImpact =
            leg2Meta && leg2Reserves
              ? computePoolAmmPriceImpactPct({
                  meta: leg2Meta,
                  fromToken: mid,
                  amountIn: leg1Out,
                  reserveA: leg2Reserves.reserveA,
                  reserveB: leg2Reserves.reserveB,
                })
              : null

          const combinedAmmImpact = combinePercentageCosts(leg1AmmImpact, leg2AmmImpact)
          const combinedFeePct =
            leg1Meta && leg2Meta
              ? combinePercentageCosts(leg1Meta.feeBps / 100, leg2Meta.feeBps / 100)
              : null

          const effectiveRate = leg2Out / amount
          const signedImpact = computeSignedImpact(effectiveRate)
          return {
            path: `${fromCanonical} → ${mid} → ${toCanonical}`,
            hops: 2 as const,
            intermediateToken: mid,
            expectedOutput: round6(leg2Out),
            minGuaranteedOutput: formatMinGuaranteedOutput(leg2Out, toCanonical, slippageTolerancePct),
            effectiveExecutionPrice: round6(effectiveRate),
            ammPriceImpactPct: combinedAmmImpact,
            poolFeePct: combinedFeePct,
            priceImpactPct: toAdverseImpact(signedImpact),
            signedPriceImpactPct: signedImpact,
            estimatedGasUsdc: arcGasUsdc !== null ? round6(arcGasUsdc * 2) : null,
            netOutputUsdc: computeNetOutputUsdc(leg2Out, 2),
            leg1Output: round6(leg1Out),
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

  // No quoted route means there is no on-chain execution quote to give here.
  // If live on-chain quotes exist but external oracle spot pricing is temporarily unreachable,
  // continue with on-chain AMM impact, reserve pressure, and output-based route ranking.
  if (candidateRoutes.length === 0) {
    return {
      data: {
        status: 'UNAVAILABLE',
        inputAmount: `${amount} ${fromCanonical}`,
        unavailable: ['live DEX swap quote'],
        reason: 'Could not calculate an optimal route right now because live Arc pool quotes are temporarily unavailable. No fee was charged.',
        flashReserveDepthUsdc,
        depthPool,
        riskRegister: [
          {
            id: 'SLIPPAGE_QUOTE_UNAVAILABLE',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Swap Execution Quote Unavailable',
            finding: 'Live Arc DEX pool quotes could not be retrieved from the network.',
            evidence: { fromToken: fromCanonical, toToken: toCanonical, amount },
            threshold: 'At least one live Arc pool swap quote required.',
            remediation: 'Verify network connectivity and ensure pool liquidity is deployed.',
          },
        ],
      },
    }
  }

  // Pick the highest gas-adjusted net value across direct + 2-hop candidates (fallback to raw output).
  candidateRoutes.sort((a, b) => {
    if (a.netOutputUsdc !== null && b.netOutputUsdc !== null) {
      return b.netOutputUsdc - a.netOutputUsdc
    }
    return b.expectedOutput - a.expectedOutput
  })
  const bestRoute = candidateRoutes[0]
  bestRoute.recommended = true

  const directEntry = candidateRoutes.find((r) => r.hops === 1) ?? bestRoute
  const twoHopOutputGainPct =
    bestRoute.hops === 2 && directEntry.expectedOutput > 0
      ? Number((((bestRoute.expectedOutput - directEntry.expectedOutput) / directEntry.expectedOutput) * 100).toFixed(3))
      : 0

  // 3. Reserve depth & execution pressure exposure.
  // For 2-hop routes, evaluate both legs and take the tighter bottleneck pool exposure and USD depth.
  const computeLegExposure = async (
    legFrom: string,
    legTo: string,
    legAmount: number
  ): Promise<{
    exposurePct: number
    soldReserveTokens: number
    soldReserveUsdc: number | null
    poolAddress: Address
    poolName: string
    token: string
  } | null> => {
    const legRoute = resolveArcNativeRoute(legFrom.toUpperCase(), legTo.toUpperCase())
    const legMeta = resolveTradePoolMeta(legFrom, legTo)
    if (!legRoute || !legMeta) return null
    const reserves = await getPoolReservesCached(legRoute.poolAddress)
    if (!reserves) return null
    const isLegFromA = canonicalTokenSymbol(legMeta.symbolA) === legFrom
    const soldReserveTokens = Number(
      formatUnits(isLegFromA ? reserves.reserveA : reserves.reserveB, isLegFromA ? legMeta.decA : legMeta.decB)
    )
    if (!Number.isFinite(soldReserveTokens) || soldReserveTokens <= 0) return null
    const legSpot = oraclePriceOf(livePrices, legFrom)
    const soldReserveUsdc =
      legFrom === 'USDC'
        ? round6(soldReserveTokens)
        : legSpot !== null
          ? round6(soldReserveTokens * legSpot)
          : null
    return {
      exposurePct: Number(((legAmount / soldReserveTokens) * 100).toFixed(2)),
      soldReserveTokens,
      soldReserveUsdc,
      poolAddress: legRoute.poolAddress,
      poolName: legMeta.dexName,
      token: legFrom,
    }
  }

  let tradeReserveExposurePct: number | null =
    soldSideReserveTokens !== null && soldSideReserveTokens > 0
      ? Number(((amount / soldSideReserveTokens) * 100).toFixed(2))
      : null
  let bottleneckToken = fromCanonical
  let bottleneckPool: Address | null = depthPool
  let bottleneckPoolName: string | null = directMeta?.dexName ?? null
  let bottleneckPoolReserveUsdc: number | null = soldSideReserveUsdc

  if (bestRoute.hops === 2 && bestRoute.intermediateToken && typeof bestRoute.leg1Output === 'number') {
    const [leg1Exp, leg2Exp] = await Promise.all([
      computeLegExposure(fromCanonical, bestRoute.intermediateToken, amount),
      computeLegExposure(bestRoute.intermediateToken, toCanonical, bestRoute.leg1Output),
    ])
    const legExposures = [leg1Exp, leg2Exp].filter(
      (e): e is NonNullable<typeof e> => e !== null
    )
    if (legExposures.length > 0) {
      const worstLeg = legExposures.reduce((a, b) => (b.exposurePct > a.exposurePct ? b : a))
      tradeReserveExposurePct = worstLeg.exposurePct
      bottleneckToken = worstLeg.token
      bottleneckPool = worstLeg.poolAddress
      bottleneckPoolName = worstLeg.poolName
      if (worstLeg.soldReserveUsdc !== null) {
        bottleneckPoolReserveUsdc = worstLeg.soldReserveUsdc
      }
    }
  }

  const sandwichRiskLevel: 'HIGH' | 'MODERATE' | 'LOW' | null =
    tradeReserveExposurePct === null
      ? null
      : tradeReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT
        ? 'HIGH'
        : tradeReserveExposurePct > MODERATE_RESERVE_EXPOSURE_THRESHOLD_PCT
          ? 'MODERATE'
          : 'LOW'

  // 4. Deterministic batch-split sizing + real AMM curve quote for Batch 1
  const recommendedBatchCount =
    tradeReserveExposurePct !== null && tradeReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT
      ? Math.min(MAX_RECOMMENDED_BATCHES, Math.max(2, Math.ceil(tradeReserveExposurePct / TARGET_PER_BATCH_RESERVE_PCT)))
      : 1

  const perBatchInputAmount = round6(amount / recommendedBatchCount)
  const perBatchReserveExposurePct =
    tradeReserveExposurePct !== null
      ? Number((tradeReserveExposurePct / recommendedBatchCount).toFixed(2))
      : null
  const estimatedTotalGasUsdc =
    arcGasUsdc !== null ? round6(arcGasUsdc * recommendedBatchCount * bestRoute.hops) : null

  const exceedsCappedBatchDepth =
    recommendedBatchCount >= MAX_RECOMMENDED_BATCHES &&
    perBatchReserveExposurePct !== null &&
    perBatchReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT

  // Quote Batch 1 directly against the live AMM curve so estimatedOut & minReceived are accurate
  // rather than linearly dividing the high-slippage full-order output.
  let batch1ExpectedOutput: number | null = null
  let batch1Leg1Output: number | null = null
  let perBatchAmmPriceImpactPct: number | null = bestRoute.ammPriceImpactPct

  if (recommendedBatchCount > 1) {
    if (bestRoute.hops === 2 && bestRoute.intermediateToken) {
      const mid = bestRoute.intermediateToken
      const midUp = mid.toUpperCase()
      try {
        const bLeg1 = await getSwapEstimate({
          fromChain: 'Arc_Testnet',
          toChain: 'Arc_Testnet',
          tokenIn: fromQuery,
          tokenOut: midUp,
          amountIn: perBatchInputAmount.toString(),
          sourceAdapter: null,
        })
        const bLeg1Out = parseFloat(bLeg1.estimatedOutput)
        const fullLeg1 = bestRoute.leg1Output
        if (Number.isFinite(bLeg1Out) && bLeg1Out > 0 && (fullLeg1 === undefined || bLeg1Out < fullLeg1)) {
          batch1Leg1Output = round6(bLeg1Out)
          const bLeg2 = await getSwapEstimate({
            fromChain: 'Arc_Testnet',
            toChain: 'Arc_Testnet',
            tokenIn: midUp,
            tokenOut: toQuery,
            amountIn: bLeg1Out.toString(),
            sourceAdapter: null,
          })
          const bLeg2Out = parseFloat(bLeg2.estimatedOutput)
          if (Number.isFinite(bLeg2Out) && bLeg2Out > 0 && bLeg2Out < bestRoute.expectedOutput) {
            batch1ExpectedOutput = round6(bLeg2Out)
          }

          const leg1Route = resolveArcNativeRoute(fromQuery, midUp)
          const leg2Route = resolveArcNativeRoute(midUp, toQuery)
          const leg1Meta = resolveTradePoolMeta(fromCanonical, mid)
          const leg2Meta = resolveTradePoolMeta(mid, toCanonical)
          const [l1Res, l2Res] = await Promise.all([
            leg1Route ? getPoolReservesCached(leg1Route.poolAddress) : Promise.resolve(null),
            leg2Route ? getPoolReservesCached(leg2Route.poolAddress) : Promise.resolve(null),
          ])
          const b1Imp =
            leg1Meta && l1Res
              ? computePoolAmmPriceImpactPct({
                  meta: leg1Meta,
                  fromToken: fromCanonical,
                  amountIn: perBatchInputAmount,
                  reserveA: l1Res.reserveA,
                  reserveB: l1Res.reserveB,
                })
              : null
          const b2Imp =
            leg2Meta && l2Res
              ? computePoolAmmPriceImpactPct({
                  meta: leg2Meta,
                  fromToken: mid,
                  amountIn: bLeg1Out,
                  reserveA: l2Res.reserveA,
                  reserveB: l2Res.reserveB,
                })
              : null
          perBatchAmmPriceImpactPct = combinePercentageCosts(b1Imp, b2Imp)
        }
      } catch {
        // Fall back to proportional estimate below if live Batch-1 quote fails.
      }
    } else {
      try {
        const bDirect = await getSwapEstimate({
          fromChain: 'Arc_Testnet',
          toChain: 'Arc_Testnet',
          tokenIn: fromQuery,
          tokenOut: toQuery,
          amountIn: perBatchInputAmount.toString(),
          sourceAdapter: null,
        })
        const bOut = parseFloat(bDirect.estimatedOutput)
        if (Number.isFinite(bOut) && bOut > 0 && bOut < bestRoute.expectedOutput) {
          batch1ExpectedOutput = round6(bOut)
        }
      } catch {
        // Fall back below.
      }
      if (directRoute && directReserves && directMeta) {
        perBatchAmmPriceImpactPct = computePoolAmmPriceImpactPct({
          meta: directMeta,
          fromToken: fromCanonical,
          amountIn: perBatchInputAmount,
          reserveA: directReserves.reserveA,
          reserveB: directReserves.reserveB,
        })
      }
    }
  } else {
    batch1ExpectedOutput = bestRoute.expectedOutput
    batch1Leg1Output = typeof bestRoute.leg1Output === 'number' ? bestRoute.leg1Output : null
  }

  const batchImpactNote =
    recommendedBatchCount > 1 &&
    perBatchAmmPriceImpactPct !== null &&
    bestRoute.ammPriceImpactPct !== null &&
    perBatchAmmPriceImpactPct < bestRoute.ammPriceImpactPct
      ? ` Per-swap AMM impact drops from ${bestRoute.ammPriceImpactPct}% to ~${perBatchAmmPriceImpactPct}% for Batch 1 (spacing batches over time lets arbitrage rebalance the pool; back-to-back swaps in the same block yield the same cumulative AMM curve output).`
      : recommendedBatchCount > 1
        ? ' Spacing batches over time (TWAP) lets arbitrage rebalance pool depth; back-to-back swaps in the same block yield the same cumulative AMM output.'
        : ''

  const executionSizing: TradeExecutionSizing = {
    recommendedBatchCount,
    perBatchInputAmount,
    perBatchExpectedOutput: batch1ExpectedOutput,
    perBatchAmmPriceImpactPct,
    singleSwapAmmPriceImpactPct: bestRoute.ammPriceImpactPct,
    estimatedTotalGasUsdc,
    suggestedMaxSlippagePct: slippageTolerancePct,
    ...(slippageClampedFromPct !== undefined ? { slippageClampedFromPct } : {}),
    advisoryOnly: true,
    note:
      recommendedBatchCount > 1
        ? exceedsCappedBatchDepth
          ? `Order is ${tradeReserveExposurePct}% of the ${bottleneckToken} pool reserve — exceeding current pool capacity. Even at the ${MAX_RECOMMENDED_BATCHES}-batch cap (${perBatchInputAmount.toLocaleString('en-US')} ${fromCanonical} each), every swap still uses ~${perBatchReserveExposurePct}% of pool depth; consider reducing total trade size.${batchImpactNote} Advisory only — no bundle or private relay is submitted.`
          : `Order is ${tradeReserveExposurePct}% of the ${bottleneckToken} pool reserve. Splitting into ${recommendedBatchCount} batches of ${perBatchInputAmount.toLocaleString('en-US')} ${fromCanonical} brings each swap to ~${perBatchReserveExposurePct}% of pool depth.${batchImpactNote} Advisory only — no bundle or private relay is submitted.`
        : 'Single-transaction execution fits within standard pool reserve depth on Arc L1 FIFO ordering. Advisory only — no bundle or private relay is submitted.',
  }

  // 5. Risk Register findings
  const effectiveSignedImpactPct = bestRoute.signedPriceImpactPct ?? directSignedImpactPct
  const effectiveImpactPct = bestRoute.priceImpactPct ?? directImpactPct ?? null
  const effectiveAmmImpactPct = bestRoute.ammPriceImpactPct
  const worstSlippageMetricPct =
    effectiveAmmImpactPct !== null && effectiveImpactPct !== null
      ? Math.max(effectiveImpactPct, effectiveAmmImpactPct)
      : effectiveAmmImpactPct ?? effectiveImpactPct ?? 0
  const isFavorablePricing =
    effectiveSignedImpactPct !== null &&
    effectiveSignedImpactPct < 0 &&
    (effectiveAmmImpactPct === null || effectiveAmmImpactPct < HIGH_SLIPPAGE_THRESHOLD_PCT)
  const isHighImpact = worstSlippageMetricPct >= HIGH_SLIPPAGE_THRESHOLD_PCT
  const isSevereImpact = worstSlippageMetricPct >= SEVERE_SLIPPAGE_THRESHOLD_PCT
  const ammExceededWhileOracleFavorable =
    effectiveSignedImpactPct !== null &&
    effectiveSignedImpactPct < 0 &&
    effectiveAmmImpactPct !== null &&
    effectiveAmmImpactPct >= HIGH_SLIPPAGE_THRESHOLD_PCT

  const riskRegister: Array<Record<string, any>> = [
    {
      id: isHighImpact ? 'HIGH_SLIPPAGE_RISK' : 'OPTIMAL_SLIPPAGE_ROUTE',
      category: isHighImpact ? 'EXECUTION_RISK' : 'OPPORTUNITY',
      severity: isSevereImpact ? 'HIGH' : isHighImpact ? 'MEDIUM' : 'INFO',
      title: isSevereImpact
        ? `Severe Price Impact (${worstSlippageMetricPct}%)`
        : isHighImpact
          ? `Elevated Price Impact (${worstSlippageMetricPct}%)`
          : isFavorablePricing && effectiveSignedImpactPct !== null
            ? `Favorable Pool Pricing (${Math.abs(effectiveSignedImpactPct)}% better than oracle)`
            : `Optimized Swap Route (${effectiveAmmImpactPct ?? effectiveImpactPct ?? 0}% impact)`,
      finding: ammExceededWhileOracleFavorable && effectiveSignedImpactPct !== null
        ? `Although the pool currently quotes ${Math.abs(effectiveSignedImpactPct)}% better than the external oracle, your ${amount.toLocaleString('en-US')} ${fromCanonical} order moves the AMM curve by ${effectiveAmmImpactPct}% (pure pool price impact).`
        : isHighImpact
          ? effectiveImpactPct !== null
            ? `Swapping ${amount.toLocaleString('en-US')} ${fromCanonical} via ${bestRoute.path} incurs ${effectiveImpactPct}% unfavorable deviation vs. oracle${effectiveAmmImpactPct !== null ? ` (${effectiveAmmImpactPct}% pure AMM curve impact)` : ''}.`
            : `Swapping ${amount.toLocaleString('en-US')} ${fromCanonical} via ${bestRoute.path} incurs ${effectiveAmmImpactPct ?? worstSlippageMetricPct}% pure AMM curve price impact.`
          : isFavorablePricing && effectiveSignedImpactPct !== null
            ? `Best measured route is ${bestRoute.path} (${amount.toLocaleString('en-US')} ${fromCanonical} → ${bestRoute.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${toCanonical}), pricing ${Math.abs(effectiveSignedImpactPct)}% better than the live oracle benchmark${effectiveAmmImpactPct !== null ? ` with ${effectiveAmmImpactPct}% AMM curve impact` : ''}.`
            : `Best measured route is ${bestRoute.path} (${amount.toLocaleString('en-US')} ${fromCanonical} → ${bestRoute.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${toCanonical}) with ${effectiveAmmImpactPct ?? effectiveImpactPct ?? 0}% price impact.`,
      evidence: {
        fromToken: fromCanonical,
        toToken: toCanonical,
        amount,
        recommendedPath: bestRoute.path,
        expectedOutput: bestRoute.expectedOutput,
        minGuaranteedOutput: bestRoute.minGuaranteedOutput,
        effectiveExecutionPrice: bestRoute.effectiveExecutionPrice,
        ammPriceImpactPct: effectiveAmmImpactPct,
        poolFeePct: bestRoute.poolFeePct,
        priceImpactPct: effectiveImpactPct,
        signedPriceImpactPct: effectiveSignedImpactPct,
        flashReserveDepthUsdc:
          bottleneckPoolReserveUsdc !== null ? Math.round(bottleneckPoolReserveUsdc) : flashReserveDepthUsdc,
      },
      threshold: `AMM curve impact or adverse oracle deviation >= ${HIGH_SLIPPAGE_THRESHOLD_PCT.toFixed(1)}% (MEDIUM) / >= ${SEVERE_SLIPPAGE_THRESHOLD_PCT.toFixed(1)}% (HIGH).`,
      remediation: isHighImpact
        ? exceedsCappedBatchDepth
          ? `Reduce trade size to fit current pool depth, or split into smaller tranches over time with slippage <= ${slippageTolerancePct}%.`
          : `Split into ${recommendedBatchCount > 1 ? recommendedBatchCount : 2} smaller swaps over time or tighten slippage tolerance to ${slippageTolerancePct}%.`
        : 'Execute swap through Arcis DEX Router at the verified rate.',
    },
  ]

  if (effectiveSignedImpactPct === null) {
    riskRegister.push({
      id: 'ORACLE_BENCHMARK_UNAVAILABLE',
      category: 'DATA_QUALITY',
      severity: 'INFO',
      title: 'External Oracle Spot Unavailable',
      finding: 'Route ranking and AMM curve price impact were computed directly from live Arc on-chain pool reserves; external oracle spot deviation is temporarily unavailable.',
      evidence: { fromToken: fromCanonical, toToken: toCanonical, ammPriceImpactPct: effectiveAmmImpactPct },
      threshold: 'External oracle price feed optional for on-chain AMM routing.',
      remediation: 'Rely on AMM Curve Impact and Min. Guaranteed Output when confirming the swap.',
    })
  }

  if (tradeReserveExposurePct !== null) {
    const isHighReserveExposure = tradeReserveExposurePct > HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT
    riskRegister.push({
      id: isHighReserveExposure ? 'HIGH_RESERVE_SANDWICH_EXPOSURE' : 'LOW_RESERVE_EXPOSURE',
      category: 'EXECUTION_RISK',
      severity: isHighReserveExposure ? 'HIGH' : sandwichRiskLevel === 'MODERATE' ? 'MEDIUM' : 'LOW',
      title: isHighReserveExposure
        ? `High Pool Reserve Pressure (${tradeReserveExposurePct}% of ${bottleneckToken} reserve)`
        : `Low Pool Reserve Pressure (${tradeReserveExposurePct}% of ${bottleneckToken} reserve)`,
      finding: isHighReserveExposure
        ? `Trade size drains ${tradeReserveExposurePct}% of the ${bestRoute.hops === 2 ? 'bottleneck' : 'direct'} pool's ${bottleneckToken} reserve, exceeding the ${HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT}% pool-depth caution line.`
        : `Trade size represents ${tradeReserveExposurePct}% of the ${bestRoute.hops === 2 ? 'bottleneck' : 'direct'} pool's ${bottleneckToken} reserve; low price-movement exposure.`,
      evidence: {
        fromToken: fromCanonical,
        bottleneckToken,
        bottleneckPool,
        soldSideReserveTokens: soldSideReserveTokens !== null ? round6(soldSideReserveTokens) : null,
        poolReserveUsdc: soldSideReserveUsdc,
        tradeReserveExposurePct,
        recommendedBatchCount,
        suggestedMaxSlippagePct: slippageTolerancePct,
      },
      threshold: `Trade size > ${HIGH_RESERVE_EXPOSURE_THRESHOLD_PCT.toFixed(1)}% of sold-side pool reserve triggers split-sizing caution.`,
      remediation: isHighReserveExposure
        ? `Split into ${recommendedBatchCount} batches of ${perBatchInputAmount.toLocaleString('en-US')} ${fromCanonical} and keep slippage <= ${slippageTolerancePct}%.`
        : 'Single-order execution is within healthy pool depth limits.',
    })
  }

  if (bestRoute.hops === 2 && twoHopOutputGainPct > 0) {
    riskRegister.push({
      id: 'TWO_HOP_ROUTE_ADVANTAGE',
      category: 'OPPORTUNITY',
      severity: 'INFO',
      title: `2-Hop Route Beats Direct Pool by +${twoHopOutputGainPct}%`,
      finding: `Routing via ${bestRoute.path} yields ${bestRoute.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${toCanonical} vs ${directEntry.expectedOutput.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${toCanonical} on the direct pool (net of extra gas).`,
      evidence: {
        recommendedPath: bestRoute.path,
        intermediateToken: bestRoute.intermediateToken,
        twoHopOutput: bestRoute.expectedOutput,
        directOutput: directEntry.expectedOutput,
        twoHopOutputGainPct,
        toToken: toCanonical,
      },
      threshold: '2-hop net output strictly exceeds direct pool net output after gas.',
      remediation: `Execute two sequential swaps via ${bestRoute.intermediateToken} using the guided 2-step execution card below.`,
    })
  }

  const effectivePoolReserveUsdc =
    bestRoute.hops === 2 && bottleneckPoolReserveUsdc !== null
      ? bottleneckPoolReserveUsdc
      : soldSideReserveUsdc
  const effectiveFlashReserveDepthUsdc =
    bestRoute.hops === 2 && bottleneckPoolReserveUsdc !== null
      ? Math.round(bottleneckPoolReserveUsdc)
      : flashReserveDepthUsdc

  const twoHopSteps =
    bestRoute.hops === 2 && bestRoute.intermediateToken && typeof bestRoute.leg1Output === 'number'
      ? {
          step1From: fromCanonical,
          step1To: bestRoute.intermediateToken,
          step1AmountIn: recommendedBatchCount > 1 ? perBatchInputAmount : amount,
          step1EstimatedOut:
            batch1Leg1Output !== null
              ? batch1Leg1Output
              : round6(bestRoute.leg1Output / recommendedBatchCount),
          step2From: bestRoute.intermediateToken,
          step2To: toCanonical,
          step2AmountIn:
            batch1Leg1Output !== null
              ? batch1Leg1Output
              : round6(bestRoute.leg1Output / recommendedBatchCount),
          step2EstimatedOut:
            batch1ExpectedOutput !== null
              ? batch1ExpectedOutput
              : round6(bestRoute.expectedOutput / recommendedBatchCount),
        }
      : undefined

  const executionVerdict = resolveTradeExecutionVerdict({
    ammPriceImpactPct: effectiveAmmImpactPct,
    signedPriceImpactPct: effectiveSignedImpactPct,
    overallPriceImpactPct: effectiveImpactPct,
    tradeReserveExposurePct,
    recommendedBatchCount,
    perBatchAmmPriceImpactPct,
    exceedsCappedBatchDepth,
  })

  const data = {
    status: 'ROUTE_OPTIMIZED',
    generatedAt: new Date().toISOString(),
    executionVerdict,
    fromToken: fromCanonical,
    toToken: toCanonical,
    inputAmount: `${amount.toLocaleString('en-US')} ${fromCanonical}`,
    expectedOutput: formatTokenAmountDisplay(bestRoute.expectedOutput, toCanonical),
    minGuaranteedOutput: bestRoute.minGuaranteedOutput,
    recommendedPath: bestRoute.path,
    recommendedHops: bestRoute.hops,
    recommendedPoolName: bestRoute.hops === 1 ? directMeta?.dexName ?? null : null,
    effectiveExecutionPrice: bestRoute.effectiveExecutionPrice,
    ammPriceImpactPct: effectiveAmmImpactPct,
    poolFeePct: bestRoute.poolFeePct,
    overallPriceImpactPct: effectiveImpactPct,
    signedPriceImpactPct: effectiveSignedImpactPct,
    twoHopOutputGainPct,
    ...(twoHopSteps ? { twoHopSteps } : {}),
    tradeReserveExposurePct,
    sandwichRiskLevel,
    poolReserveUsdc: effectivePoolReserveUsdc,
    flashReserveDepthUsdc: effectiveFlashReserveDepthUsdc,
    depthPool,
    bottleneckPool,
    bottleneckPoolName,
    estimatedGasCostUsdc: estimatedTotalGasUsdc,
    routeComparison: candidateRoutes.map(({ leg1Output: _leg1, ...rest }) => rest),
    executionSizing,
    riskRegister,
  }

  const executionAmountIn = recommendedBatchCount > 1 ? perBatchInputAmount : amount
  let actionablePayload: ActionableSignalPayload | undefined

  if (bestRoute.hops === 2 && bestRoute.intermediateToken) {
    const leg1Route = resolveArcNativeRoute(fromQuery, bestRoute.intermediateToken.toUpperCase())
    const leg1Meta = resolveTradePoolMeta(fromCanonical, bestRoute.intermediateToken)
    const leg2Route = resolveArcNativeRoute(bestRoute.intermediateToken.toUpperCase(), toQuery)
    const leg2Meta = resolveTradePoolMeta(bestRoute.intermediateToken, toCanonical)
    if (leg1Route) {
      const leg1EstimatedOut =
        batch1Leg1Output !== null
          ? batch1Leg1Output
          : typeof bestRoute.leg1Output === 'number'
            ? round6(bestRoute.leg1Output / recommendedBatchCount)
            : undefined
      const leg2EstimatedOut =
        batch1ExpectedOutput !== null
          ? batch1ExpectedOutput
          : round6(bestRoute.expectedOutput / recommendedBatchCount)
      actionablePayload = {
        type: 'swap',
        title: `Step 1 of 2: Swap ${executionAmountIn.toLocaleString('en-US')} ${fromCanonical} → ${bestRoute.intermediateToken}`,
        badgeText: `2-Hop Step 1 · ${bestRoute.path}`,
        details: {
          amountIn: executionAmountIn,
          totalAmountIn: amount,
          recommendedBatchCount,
          fromToken: fromCanonical,
          toToken: bestRoute.intermediateToken,
          estimatedOut: leg1EstimatedOut,
          priceImpactPct: effectiveAmmImpactPct ?? effectiveImpactPct ?? undefined,
          slippageTolerancePct,
          poolAddress: leg1Route.poolAddress,
          optimalPool: leg1Meta?.dexName || 'Arcis DEX Router',
          fullPath: bestRoute.path,
          step: 1,
          totalSteps: 2,
          ...(leg2Route
            ? {
                nextStep: {
                  step: 2,
                  totalSteps: 2,
                  fromToken: bestRoute.intermediateToken,
                  toToken: toCanonical,
                  estimatedIn: leg1EstimatedOut,
                  estimatedOut: leg2EstimatedOut,
                  poolAddress: leg2Route.poolAddress,
                  optimalPool: leg2Meta?.dexName || 'Arcis DEX Router',
                  slippageTolerancePct,
                  fullPath: bestRoute.path,
                },
              }
            : {}),
          buttonLabel:
            recommendedBatchCount > 1
              ? `Execute Batch 1 · Step 1/2 (${fromCanonical} → ${bestRoute.intermediateToken})`
              : `Execute Step 1/2 (${fromCanonical} → ${bestRoute.intermediateToken})`,
        },
      }
    }
  }

  if (!actionablePayload && directRoute) {
    const directBatchEstimatedOut =
      batch1ExpectedOutput !== null
        ? batch1ExpectedOutput
        : round6(bestRoute.expectedOutput / recommendedBatchCount)
    actionablePayload = {
      type: 'swap',
      title:
        recommendedBatchCount > 1
          ? `Batch 1/${recommendedBatchCount}: Swap ${executionAmountIn.toLocaleString('en-US')} ${fromCanonical} → ${toCanonical}`
          : `Swap ${amount.toLocaleString('en-US')} ${fromCanonical} → ${toCanonical}`,
      badgeText: `${effectiveAmmImpactPct ?? effectiveImpactPct ?? 0}% Impact · ${bestRoute.path}`,
      details: {
        amountIn: executionAmountIn,
        totalAmountIn: amount,
        recommendedBatchCount,
        fromToken: fromCanonical,
        toToken: toCanonical,
        estimatedOut: directBatchEstimatedOut,
        priceImpactPct: effectiveAmmImpactPct ?? effectiveImpactPct ?? undefined,
        slippageTolerancePct,
        poolAddress: directRoute.poolAddress,
        optimalPool: directMeta?.dexName || 'Arcis DEX Router',
        buttonLabel:
          recommendedBatchCount > 1
            ? `Swap Batch 1/${recommendedBatchCount} on Arc`
            : 'Execute Swap on Arc',
      },
    }
  }

  return { data, actionablePayload }
}
