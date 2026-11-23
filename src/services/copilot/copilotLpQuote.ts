// src/services/copilot/copilotLpQuote.ts
// Live on-chain LP pool quote & safety guardrail engine for Ask Arco.
// Reads real reserves/paused state from Arc Testnet pools and computes exact auto-matched
// dual amounts, expected LP output, slippage-guarded minLpShares, pool share %, and donation risk.

import { formatUnits, parseUnits, zeroAddress } from 'viem'
import {
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  STABLE_SWAP_AMP,
  poolMinLpShares,
  poolSlippageBps,
  type PoolConfig,
} from '../../config/poolsConfig.js'
import { ARC_GAS_LIMITS, type SpeedTier } from '../../config/feeTiers.js'
import {
  analyzeDualDepositBalance,
  calculateConstantProductExpectedOut,
  calculatePoolShare,
  calculateStableSwapExpectedOut,
  DUAL_DEPOSIT_DONATION_BLOCK_PCT,
  getStableSwapD,
} from '../../utils/poolMath.js'
import { numberToExactDecimal } from '../../utils/copilotAmount.js'
import { getResilientPublicClient } from '../rpc/index.js'
import { calculateArcGasCostFromFee, getDynamicArcGasOptions } from '../arcGasService.js'

export interface LpQuoteInput {
  pool: PoolConfig
  mode: 'zap' | 'dual'
  amountA?: number
  amountB?: number
  amountADecimal?: string
  amountBDecimal?: string
  autoMatchCounter?: boolean
  anchorSide?: 'A' | 'B'
  slippageBps?: number
  speedTier?: SpeedTier
}

export interface LpQuoteSuccess {
  ok: true
  quote: {
    amountA: number
    amountB?: number
    amountADecimal: string
    amountBDecimal?: string
    estimatedCounterOut?: string
    estimatedLpOut: string
    minLpShares: string
    minLpSharesRaw: string
    poolSharePct: number
    donationPct: number
    slippageBps: number
    estimatedFeeUsdc?: string
    feeEstimateSource?: string
    reserveARaw: bigint
    reserveBRaw: bigint
    totalLpRaw: bigint
  }
}

export interface LpQuoteFailure {
  ok: false
  error: string
}

export type LpQuoteResult = LpQuoteSuccess | LpQuoteFailure

function isPoolConstantProduct(pool: PoolConfig): boolean {
  return (
    pool.id === 'usdc-cirbtc-pool' ||
    pool.id === 'usdc-weth-pool' ||
    pool.id === 'eurc-weth-pool' ||
    pool.id === 'eurc-cirbtc-pool' ||
    pool.id === 'cirbtc-weth-pool' ||
    Boolean(pool.tags?.includes('Constant Product'))
  )
}

function poolFeeBps(pool: PoolConfig): bigint {
  if (typeof pool.feeTierPercent === 'number' && pool.feeTierPercent > 0) {
    return BigInt(Math.round(pool.feeTierPercent * 100))
  }
  if (pool.id === 'usdc-eurc-stable-pool') return 12n
  if (pool.id === 'usdc-cirbtc-pool' || pool.id === 'eurc-cirbtc-pool') return 25n
  return 30n
}

/** Formats a bigint token amount into a lossless, clean decimal string capped at safe JS precision. */
function formatMatchedTokenAmount(units: bigint, decimals: number): { amount: number; decimal: string } | null {
  if (units <= 0n) return null
  const full = formatUnits(units, decimals)
  const [whole, frac = ''] = full.split('.')
  // Keep up to 8 decimals (or token's own decimals if smaller) so JS Number round-trips cleanly.
  const maxFrac = Math.min(decimals, decimals >= 18 ? 8 : decimals)
  const clippedFrac = frac.slice(0, maxFrac).replace(/0+$/, '')
  const decimal = clippedFrac ? `${whole}.${clippedFrac}` : whole
  const amount = Number(decimal)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const exact = numberToExactDecimal(amount)
  if (!exact) return null
  return { amount, decimal: exact }
}

/** Pure expected LP shares calculator matching StableSwapPoolV3 / ConstantProductPoolV3 invariants. */
export function computeExpectedLpShares(
  pool: PoolConfig,
  reserveA: bigint,
  reserveB: bigint,
  totalLp: bigint,
  amountA: bigint,
  amountB: bigint
): bigint {
  if (amountA <= 0n || amountB <= 0n) return 0n
  if (totalLp <= 0n || reserveA <= 0n || reserveB <= 0n) return 0n

  if (isPoolConstantProduct(pool)) {
    const lpA = (amountA * totalLp) / reserveA
    const lpB = (amountB * totalLp) / reserveB
    return lpA < lpB ? lpA : lpB
  }

  // StableSwap exact D invariant
  const d0 = getStableSwapD(reserveA, reserveB, STABLE_SWAP_AMP)
  const d1 = getStableSwapD(reserveA + amountA, reserveB + amountB, STABLE_SWAP_AMP)
  if (d1 > d0 && d0 > 0n) {
    return ((d1 - d0) * totalLp) / d0
  }
  return (amountA * totalLp) / reserveA
}

/**
 * Fetches live reserves and paused status from Arc Testnet for the given LP pool
 * and calculates a slippage-guarded quote for either 1-Click Zap or Dual-Asset deposit.
 */
export async function getCopilotLpQuote(input: LpQuoteInput): Promise<LpQuoteResult> {
  const { pool, mode } = input
  const poolAddress = pool.contractAddress
  if (!poolAddress || poolAddress.toLowerCase() === zeroAddress) {
    return {
      ok: false,
      error: `<strong>Pool unavailable.</strong>\n\nThe <strong>${pool.name}</strong> pool is not deployed on Arc Testnet yet.`,
    }
  }

  const tokenA = pool.tokens[0]
  const tokenB = pool.tokens[1]
  const decA = tokenA.decimals
  const decB = tokenB.decimals

  const rawSlipBps =
    typeof input.slippageBps === 'number' && Number.isFinite(input.slippageBps) && input.slippageBps > 0
      ? poolSlippageBps(input.slippageBps / 100)
      : POOL_DEFAULT_SLIPPAGE_BPS

  const client = getResilientPublicClient('Arc_Testnet')

  let reserveA = 0n
  let reserveB = 0n
  let totalLp = 0n
  let isPaused = false

  try {
    const [rA, rB, tLp, paused] = await Promise.all([
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
    ])
    reserveA = rA
    reserveB = rB
    totalLp = tLp
    isPaused = Boolean(paused)
  } catch (err) {
    console.warn('[copilotLpQuote] Failed to read live pool state on Arc Testnet:', err)
    return {
      ok: false,
      error: `<strong>Pool quote unavailable.</strong>\n\nCould not read live reserves for <strong>${pool.name}</strong> on Arc Testnet. Please try again in a moment.`,
    }
  }

  if (isPaused) {
    return {
      ok: false,
      error: `<strong>Pool paused.</strong>\n\nThe <strong>${pool.name}</strong> pool is currently paused on-chain and cannot accept new liquidity.`,
    }
  }

  // Estimate live Arc gas fee (Zap executes swap + addLiquidity; Dual executes addLiquidity)
  const gasLimit = mode === 'zap' ? ARC_GAS_LIMITS.contractInteraction * 2n : ARC_GAS_LIMITS.contractInteraction
  let estimatedFeeUsdc: string | undefined
  let feeEstimateSource: string | undefined
  try {
    const gas = await getDynamicArcGasOptions(undefined, input.speedTier || 'fast', gasLimit)
    estimatedFeeUsdc = calculateArcGasCostFromFee(gasLimit, gas.maxFeePerGas)
    feeEstimateSource = gas.source
  } catch {
    // Non-fatal: fee row gracefully shows fallback/unavailable
  }

  if (mode === 'zap') {
    if (!pool.supportsZap || tokenA.symbol !== 'USDC') {
      return {
        ok: false,
        error: `<strong>1-Click Zap is not supported for ${pool.name}.</strong>\n\nPlease use Dual-Asset deposit with both <strong>${tokenA.symbol}</strong> and <strong>${tokenB.symbol}</strong>.`,
      }
    }
    if (reserveA <= 0n || reserveB <= 0n || totalLp <= 0n) {
      return {
        ok: false,
        error: `<strong>1-Click Zap unavailable.</strong>\n\nThe <strong>${pool.name}</strong> pool currently has zero reserves on Arc Testnet. 1-Click Zap requires active liquidity to swap 50% into ${tokenB.symbol}.`,
      }
    }

    const amountADec = input.amountADecimal || (input.amountA ? numberToExactDecimal(input.amountA) : null)
    if (!amountADec || !input.amountA || input.amountA <= 0) {
      return { ok: false, error: '<strong>Valid USDC amount required.</strong>\n\nPlease provide a positive USDC amount for 1-Click Zap.' }
    }

    const usdcUnits = parseUnits(amountADec, decA)
    const halfUsdc = usdcUnits / 2n
    const remainingUsdc = usdcUnits - halfUsdc
    if (halfUsdc <= 0n || remainingUsdc <= 0n) {
      return { ok: false, error: '<strong>Amount too small for 1-Click Zap.</strong>\n\nPlease provide a larger USDC amount.' }
    }

    const feeBps = poolFeeBps(pool)
    const expectedCounterOut = isPoolConstantProduct(pool)
      ? calculateConstantProductExpectedOut(halfUsdc, reserveA, reserveB, feeBps)
      : calculateStableSwapExpectedOut(halfUsdc, reserveA, reserveB, feeBps, STABLE_SWAP_AMP)

    if (expectedCounterOut <= 0n || expectedCounterOut >= reserveB) {
      return {
        ok: false,
        error: `<strong>Insufficient pool liquidity for Zap.</strong>\n\nThe ${pool.name} pool does not have enough ${tokenB.symbol} liquidity for a ${amountADec} USDC Zap.`,
      }
    }

    const postSwapReserveA = reserveA + halfUsdc
    const postSwapReserveB = reserveB - expectedCounterOut
    const expectedLp = computeExpectedLpShares(pool, postSwapReserveA, postSwapReserveB, totalLp, remainingUsdc, expectedCounterOut)
    const minLpRaw = POOL_VERSION_V4 ? poolMinLpShares(expectedLp, rawSlipBps) : 0n
    if (POOL_VERSION_V4 && minLpRaw <= 0n) {
      return {
        ok: false,
        error: `<strong>Unable to compute slippage guard.</strong>\n\nCould not derive a safe minimum LP output for <strong>${pool.name}</strong>. Please try a slightly larger amount.`,
      }
    }

    const poolSharePct = calculatePoolShare(expectedLp, totalLp + expectedLp)
    const formattedCounter = formatMatchedTokenAmount(expectedCounterOut, decB)

    return {
      ok: true,
      quote: {
        amountA: input.amountA,
        amountADecimal: amountADec,
        estimatedCounterOut: formattedCounter?.decimal,
        estimatedLpOut: Number(formatUnits(expectedLp, 18)).toFixed(6),
        minLpShares: Number(formatUnits(minLpRaw, 18)).toFixed(6),
        minLpSharesRaw: minLpRaw.toString(),
        poolSharePct,
        donationPct: 0,
        slippageBps: rawSlipBps,
        estimatedFeeUsdc,
        feeEstimateSource,
        reserveARaw: reserveA,
        reserveBRaw: reserveB,
        totalLpRaw: totalLp,
      },
    }
  }

  // Dual-Asset LP mode
  let finalAmountA = input.amountA
  let finalAmountB = input.amountB
  let finalDecA = input.amountADecimal || (finalAmountA ? numberToExactDecimal(finalAmountA) ?? undefined : undefined)
  let finalDecB = input.amountBDecimal || (finalAmountB ? numberToExactDecimal(finalAmountB) ?? undefined : undefined)

  if (input.autoMatchCounter || !finalDecA || !finalDecB) {
    if (reserveA <= 0n || reserveB <= 0n) {
      return {
        ok: false,
        error: `<strong>Both amounts required.</strong>\n\nThe <strong>${pool.name}</strong> pool has no live reserves yet, so please specify both ${tokenA.symbol} and ${tokenB.symbol} amounts explicitly.`,
      }
    }

    if (input.anchorSide === 'B' && finalDecB) {
      const bUnits = parseUnits(finalDecB, decB)
      const matchedAUnits = (bUnits * reserveA) / reserveB
      const matchedA = formatMatchedTokenAmount(matchedAUnits, decA)
      if (!matchedA) {
        return {
          ok: false,
          error: `<strong>Amount too small to match pool ratio.</strong>\n\nPlease enter a slightly larger ${tokenB.symbol} amount.`,
        }
      }
      finalAmountA = matchedA.amount
      finalDecA = matchedA.decimal
    } else if (finalDecA) {
      const aUnits = parseUnits(finalDecA, decA)
      const matchedBUnits = (aUnits * reserveB) / reserveA
      const matchedB = formatMatchedTokenAmount(matchedBUnits, decB)
      if (!matchedB) {
        return {
          ok: false,
          error: `<strong>Amount too small to match pool ratio.</strong>\n\nPlease enter a slightly larger ${tokenA.symbol} amount.`,
        }
      }
      finalAmountB = matchedB.amount
      finalDecB = matchedB.decimal
    } else {
      return {
        ok: false,
        error: `<strong>Valid amounts required.</strong>\n\nPlease provide amounts for ${tokenA.symbol} and ${tokenB.symbol}.`,
      }
    }
  }

  const amountAUnits = parseUnits(finalDecA!, decA)
  const amountBUnits = parseUnits(finalDecB!, decB)

  // Donation / ratio imbalance guard matching PoolDepositTab & poolDepositService
  let donationPct = 0
  if (reserveA > 0n && reserveB > 0n && totalLp > 0n) {
    const reserveANum = Number(formatUnits(reserveA, decA))
    const reserveBNum = Number(formatUnits(reserveB, decB))
    const totalLpNum = Number(formatUnits(totalLp, 18))
    const balance = analyzeDualDepositBalance({
      poolId: pool.id,
      amountA: finalAmountA!,
      amountB: finalAmountB!,
      reserveA: reserveANum,
      reserveB: reserveBNum,
      totalLp: totalLpNum,
      amp: STABLE_SWAP_AMP,
    })
    if (balance) {
      donationPct = balance.donationPct
      if (balance.donationPct > DUAL_DEPOSIT_DONATION_BLOCK_PCT) {
        const idealBUnits = (amountAUnits * reserveB) / reserveA
        const idealB = formatMatchedTokenAmount(idealBUnits, decB)
        return {
          ok: false,
          error: `<strong>Unbalanced dual deposit blocked.</strong>\n\nAt the current <strong>${pool.name}</strong> pool ratio, about <strong>${balance.donationPct.toFixed(1)}%</strong> of your deposit would be donated to existing LPs instead of minting LP shares.${
            idealB
              ? ` For <strong>${finalDecA} ${tokenA.symbol}</strong>, try approximately <strong>${idealB.decimal} ${tokenB.symbol}</strong> (or specify only one token so I auto-match the pair).`
              : ''
          }`,
        }
      }
    }
  }

  const expectedLp = computeExpectedLpShares(pool, reserveA, reserveB, totalLp, amountAUnits, amountBUnits)
  const minLpRaw = POOL_VERSION_V4 && totalLp > 0n ? poolMinLpShares(expectedLp, rawSlipBps) : 0n
  if (POOL_VERSION_V4 && totalLp > 0n && minLpRaw <= 0n) {
    return {
      ok: false,
      error: `<strong>Unable to compute slippage guard.</strong>\n\nCould not derive a safe minimum LP output for <strong>${pool.name}</strong> from live reserves. Please try a slightly larger amount.`,
    }
  }

  const poolSharePct = totalLp > 0n ? calculatePoolShare(expectedLp, totalLp + expectedLp) : 100

  return {
    ok: true,
    quote: {
      amountA: finalAmountA!,
      amountB: finalAmountB!,
      amountADecimal: finalDecA!,
      amountBDecimal: finalDecB!,
      estimatedLpOut: Number(formatUnits(expectedLp, 18)).toFixed(6),
      minLpShares: Number(formatUnits(minLpRaw, 18)).toFixed(6),
      minLpSharesRaw: minLpRaw.toString(),
      poolSharePct,
      donationPct,
      slippageBps: rawSlipBps,
      estimatedFeeUsdc,
      feeEstimateSource,
      reserveARaw: reserveA,
      reserveBRaw: reserveB,
      totalLpRaw: totalLp,
    },
  }
}
