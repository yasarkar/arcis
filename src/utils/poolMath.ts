// src/utils/poolMath.ts
// Pure integer / BigInt math for AMM pools on Arcis.
// Mirrors the on-chain Curve Stableswap invariant from StableSwapPoolV3.sol
// and the Constant Product invariant from ConstantProductPoolV3.sol.

// Pool invariants (A, LP fees) come from the single source of truth in poolsConfig so the
// frontend can never drift from the deployed contracts (audit #14).
import { formatUnits, parseUnits } from 'viem'
import {
  STABLE_SWAP_AMP,
  STABLE_SWAP_ANN_MULTIPLIER,
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
} from '../config/poolsConfig'

/**
 * Computes the Curve Stableswap invariant D for a 2-token pool.
 * @param x Token A reserve (6 decimals for USDC)
 * @param y Token B reserve (6 decimals for EURC)
 * @param amp Amplification coefficient (default 100)
 */
export function getStableSwapD(x: bigint, y: bigint, amp: bigint = STABLE_SWAP_AMP): bigint {
  const s = x + y
  if (s === 0n) return 0n

  let prevD = 0n
  let d = s
  const Ann = amp * STABLE_SWAP_ANN_MULTIPLIER // n=2 -> Ann = A * n**n

  for (let i = 0; i < 255; i++) {
    let dP = d
    dP = (dP * d) / (x * 2n)
    dP = (dP * d) / (y * 2n)
    prevD = d
    d = ((Ann * s + dP * 2n) * d) / ((Ann - 1n) * d + 3n * dP)
    if (d > prevD) {
      if (d - prevD <= 1n) return d
    } else {
      if (prevD - d <= 1n) return d
    }
  }
  return d
}

/**
 * Solves for the balance of the output token given the invariant D and new input reserve.
 * @param x Balance of token In after adding amountIn (after fee)
 * @param d Invariant D
 * @param amp Amplification coefficient (default 100)
 */
export function getStableSwapY(x: bigint, d: bigint, amp: bigint = STABLE_SWAP_AMP): bigint {
  const Ann = amp * STABLE_SWAP_ANN_MULTIPLIER
  let c = (d * d) / (x * 2n)
  c = (c * d) / (Ann * 2n)
  const b = x + d / Ann
  let yPrev = 0n
  let y = d

  for (let i = 0; i < 255; i++) {
    yPrev = y
    y = (y * y + c) / (2n * y + b - d)
    if (y > yPrev) {
      if (y - yPrev <= 1n) return y
    } else {
      if (yPrev - y <= 1n) return y
    }
  }
  return y
}

/**
 * Calculates expected output for a StableSwap pool using exact Curve math.
 * @param amountIn Input token amount in raw integer units
 * @param reserveIn Current reserve of input token
 * @param reserveOut Current reserve of output token
 * @param feeBps Swap fee in basis points (default: deployed StableSwap 12 bps = 0.12%)
 * @param amp Amplification coefficient (default: deployed A = 100)
 */
export function calculateStableSwapExpectedOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint = STABLE_SWAP_LP_FEE_BPS,
  amp: bigint = STABLE_SWAP_AMP
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const fee = (amountIn * feeBps) / 10000n
  const amountInAfterFee = amountIn - fee
  const d = getStableSwapD(reserveIn, reserveOut, amp)
  const y = getStableSwapY(reserveIn + amountInAfterFee, d, amp)
  if (y >= reserveOut) return 0n
  return reserveOut - y
}

/**
 * Calculates expected output for a Constant Product AMM pool (x * y = k).
 * @param amountIn Input token amount in raw integer units
 * @param reserveIn Current reserve of input token
 * @param reserveOut Current reserve of output token
 * @param feeBps Swap fee in basis points (default: deployed CP fee 25 bps = 0.25%)
 */
export function calculateConstantProductExpectedOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint = CONSTANT_PRODUCT_LP_FEE_BPS
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const fee = (amountIn * feeBps) / 10000n
  const amountInAfterFee = amountIn - fee
  return (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)
}

/**
 * Accurately calculates pool share percentage based on minted LP tokens and total LP supply after mint.
 * @param lpMintedRaw The amount of LP tokens minted to the user (in raw units)
 * @param totalLpAfter The total supply of LP tokens after the mint (in raw units)
 * @returns Formatted percentage (number with up to 3 decimal places). Returns 0 if totalLpAfter is 0 or unseeded.
 */
export function calculatePoolShare(lpMintedRaw: bigint, totalLpAfter: bigint): number {
  if (lpMintedRaw <= 0n || totalLpAfter <= 0n) return 0
  if (lpMintedRaw >= totalLpAfter) return 100
  const scaled = (lpMintedRaw * 100_000n) / totalLpAfter
  return Number(scaled) / 1000
}

/**
 * Calculates the vault shares to redeem corresponding to a target USD profit.
 * @param profitUsd The claimable profit in USD (e.g. 5.50)
 * @param totalAssets Total assets held by the ERC-4626 vault (raw uint256, 6 decimals)
 * @param totalSupply Total shares of the ERC-4626 vault (raw uint256, 6 decimals)
 * @param userShares Total shares owned by the user (raw uint256)
 */
export function calculateVaultClaimShares(
  profitUsd: number,
  totalAssets: bigint,
  totalSupply: bigint,
  userShares: bigint
): bigint {
  if (profitUsd <= 0 || totalAssets <= 0n || totalSupply <= 0n || userShares <= 0n) return 0n
  const profitAssets = BigInt(Math.floor(profitUsd * 1e6))
  const sharesNeeded = (profitAssets * totalSupply) / totalAssets
  return sharesNeeded > userShares ? userShares : sharesNeeded
}

/**
 * Calculates the LP tokens to withdraw corresponding to a target USD profit.
 * @param profitUsd The claimable fee profit in USD
 * @param userStakedUsd The user's total staked value in USD
 * @param userLpRaw The user's total LP balance (raw 18 decimals)
 */
export function calculateLpClaimAmount(
  profitUsd: number,
  userStakedUsd: number,
  userLpRaw: bigint
): bigint {
  if (profitUsd <= 0 || userStakedUsd <= 0 || userLpRaw <= 0n) return 0n
  if (profitUsd >= userStakedUsd) return userLpRaw

  // Convert USD amounts to micro-units (6 decimals) for exact BigInt arithmetic
  const profitMicros = BigInt(Math.round(profitUsd * 1_000_000))
  const stakedMicros = BigInt(Math.round(userStakedUsd * 1_000_000))
  if (stakedMicros === 0n) return 0n

  const lpToRedeem = (userLpRaw * profitMicros) / stakedMicros
  return lpToRedeem > userLpRaw ? userLpRaw : lpToRedeem
}

/**
 * Price impact of a trade as a percentage, EXCLUDING the pool fee.
 * Compares the fee-less execution price against the pre-trade mid price so the value
 * shown to the user is the genuine market impact of their size — never a hard-coded number.
 * Returns 0 when the impact cannot be derived from live reserves.
 */
export function calculatePriceImpactPct(
  amountIn: number,
  reserveIn: number,
  reserveOut: number,
  isStablePool: boolean,
  amp: bigint = STABLE_SWAP_AMP
): number {
  if (!Number.isFinite(amountIn) || amountIn <= 0) return 0
  if (!Number.isFinite(reserveIn) || reserveIn <= 0) return 0
  if (!Number.isFinite(reserveOut) || reserveOut <= 0) return 0

  const midPrice = reserveOut / reserveIn
  if (!Number.isFinite(midPrice) || midPrice <= 0) return 0

  let noFeeOut = 0
  if (isStablePool) {
    try {
      const inBig = parseUnits(amountIn.toFixed(6), 6)
      const reserveInBig = parseUnits(reserveIn.toFixed(6), 6)
      const reserveOutBig = parseUnits(reserveOut.toFixed(6), 6)
      noFeeOut = parseFloat(
        formatUnits(calculateStableSwapExpectedOut(inBig, reserveInBig, reserveOutBig, 0n, amp), 6)
      )
    } catch {
      return 0
    }
  } else {
    noFeeOut = (reserveOut * amountIn) / (reserveIn + amountIn)
  }

  if (!Number.isFinite(noFeeOut) || noFeeOut <= 0) return 0
  const execPrice = noFeeOut / amountIn
  return Math.max(0, (1 - execPrice / midPrice) * 100)
}

/**
 * Calculates integer square root of a BigInt (Babylonian method), matching EVM Uniswap v2 / OpenZeppelin _sqrt.
 */
export function sqrtBigInt(y: bigint): bigint {
  if (y < 0n) throw new Error('Square root of negative number')
  if (y > 3n) {
    let z = y
    let x = y / 2n + 1n
    while (x < z) {
      z = x
      x = (y / x + x) / 2n
    }
    return z
  } else if (y !== 0n) {
    return 1n
  }
  return 0n
}

/**
 * Accurately calculates the underlying token amounts returned when burning a given amount of LP tokens.
 * Proportional share: outA = (reserveA * lpAmount) / totalLp, outB = (reserveB * lpAmount) / totalLp.
 */
export function calculateLpTokensToAssets(params: {
  lpAmountRaw?: bigint
  lpTokensToBurn?: bigint
  totalLpRaw?: bigint
  totalLpSupply?: bigint
  reserveARaw?: bigint
  reserveA?: bigint
  reserveBRaw?: bigint
  reserveB?: bigint
}): {
  amountAOut: bigint
  amountBOut: bigint
  amountA: bigint
  amountB: bigint
} {
  const lp = params.lpTokensToBurn ?? params.lpAmountRaw ?? 0n
  const total = params.totalLpSupply ?? params.totalLpRaw ?? 0n
  const resA = params.reserveA ?? params.reserveARaw ?? 0n
  const resB = params.reserveB ?? params.reserveBRaw ?? 0n

  if (lp <= 0n || total <= 0n) {
    return { amountAOut: 0n, amountBOut: 0n, amountA: 0n, amountB: 0n }
  }
  const effectiveLp = lp > total ? total : lp
  const a = (resA * effectiveLp) / total
  const b = (resB * effectiveLp) / total
  return { amountAOut: a, amountBOut: b, amountA: a, amountB: b }
}

/**
 * Estimates the LP shares minted for a two-sided deposit using the pool's own invariant
 * (exact Curve D-delta for the stable pair, min(proportional) for x*y=k).
 * Also handles initial pool seeding when totalLp == 0, locking MINIMUM_LIQUIDITY (1000)
 * to 0x...dEaD matching ConstantProductPoolV4.sol and StableSwapPoolV4.sol.
 * Returns null when the estimate cannot be derived from live reserves / total LP supply.
 */
export function estimateLpSharesForDeposit(params: {
  poolId: string
  amountA: number
  amountB: number
  reserveA: number
  reserveB: number
  totalLp: number
  amp?: bigint
  allowInitialSeed?: boolean
}): { shares: number; totalLpAfter: number } | null {
  const { poolId, amountA, amountB, reserveA, reserveB, totalLp, allowInitialSeed = false } = params
  const amp = params.amp ?? STABLE_SWAP_AMP
  if (!(amountA > 0) || !(amountB > 0)) return null

  // ── Zero-liquidity initial pool seeding (Uniswap v2 / Curve dead shares model) ──
  if (totalLp <= 0 || reserveA <= 0 || reserveB <= 0) {
    if (!allowInitialSeed) return null
    const MINIMUM_LIQUIDITY = 1000n
    if (poolId === 'usdc-eurc-stable-pool') {
      try {
        const rawA = parseUnits(amountA.toFixed(6), 6)
        const rawB = parseUnits(amountB.toFixed(6), 6)
        const d0 = getStableSwapD(rawA, rawB, amp)
        const initialLp = d0 * 1_000_000_000_000n // scale 6-decimal D to 18-decimal LP tokens
        if (initialLp <= MINIMUM_LIQUIDITY) return null
        const userLp = initialLp - MINIMUM_LIQUIDITY
        const shares = parseFloat(formatUnits(userLp, 18))
        const totalLpAfter = parseFloat(formatUnits(initialLp, 18))
        if (!(shares > 0)) return null
        return { shares, totalLpAfter }
      } catch {
        return null
      }
    } else if (poolId === 'usdc-weth-pool' || poolId === 'eurc-weth-pool') {
      try {
        const rawA = parseUnits(amountA.toFixed(6), 6)
        const rawB = parseUnits(amountB.toFixed(6), 18)
        const rawSqrt = sqrtBigInt(rawA * rawB)
        const initialLp = rawSqrt * 1_000_000n // scale 12-decimal product sqrt to 18-decimal LP tokens
        if (initialLp <= MINIMUM_LIQUIDITY) return null
        const userLp = initialLp - MINIMUM_LIQUIDITY
        const shares = parseFloat(formatUnits(userLp, 18))
        const totalLpAfter = parseFloat(formatUnits(initialLp, 18))
        if (!(shares > 0)) return null
        return { shares, totalLpAfter }
      } catch {
        return null
      }
    } else {
      try {
        const rawA = parseUnits(amountA.toFixed(6), 6)
        const rawB = parseUnits(amountB.toFixed(8), 8)
        const rawSqrt = sqrtBigInt(rawA * rawB)
        const initialLp = rawSqrt * 100_000_000_000n // scale 7-decimal product sqrt to 18-decimal LP tokens
        if (initialLp <= MINIMUM_LIQUIDITY) return null
        const userLp = initialLp - MINIMUM_LIQUIDITY
        const shares = parseFloat(formatUnits(userLp, 18))
        const totalLpAfter = parseFloat(formatUnits(initialLp, 18))
        if (!(shares > 0)) return null
        return { shares, totalLpAfter }
      } catch {
        return null
      }
    }
  }

  if (poolId === 'usdc-eurc-stable-pool') {
    try {
      const d0 = getStableSwapD(parseUnits(reserveA.toFixed(6), 6), parseUnits(reserveB.toFixed(6), 6), amp)
      const d1 = getStableSwapD(
        parseUnits((reserveA + amountA).toFixed(6), 6),
        parseUnits((reserveB + amountB).toFixed(6), 6),
        amp
      )
      if (d0 <= 0n || d1 <= d0) return null
      const totalLpRaw = parseUnits(totalLp.toFixed(18), 18)
      const shares = parseFloat(formatUnits(((d1 - d0) * totalLpRaw) / d0, 18))
      if (!(shares > 0)) return null
      return { shares, totalLpAfter: totalLp + shares }
    } catch {
      return null
    }
  }

  const lpA = (amountA * totalLp) / reserveA
  const lpB = (amountB * totalLp) / reserveB
  const shares = Math.min(lpA, lpB)
  if (!(shares > 0)) return null
  return { shares, totalLpAfter: totalLp + shares }
}

// ── O2: Unbalanced dual-deposit donation analysis ─────────────────────────────
// Both V4 pool contracts credit only min(lpA, lpB) (ConstantProduct) or the Curve
// D-delta (StableSwap) while transferring BOTH full input amounts into the reserves.
// Any excess beyond the pool ratio is therefore kept by the pool and accrues to
// existing LPs as a donation. These helpers quantify that excess so the UI can warn
// and the deposit path can refuse accidental donations.

/** Warn threshold: donation share of the deposit value above which the UI shows a warning. */
export const DUAL_DEPOSIT_DONATION_WARN_PCT = 0.5
/** Block threshold: donation share above which a dual deposit is refused outright. */
export const DUAL_DEPOSIT_DONATION_BLOCK_PCT = 1

export interface DualDepositBalance {
  /** LP shares the pool would mint for the amounts as entered (pool-accurate minting math). */
  estimatedShares: number
  /** Deposit amounts trimmed to the pool ratio so nothing is donated (excess side kept intact). */
  optimizedAmountA: number
  optimizedAmountB: number
  /** Estimated value donated to existing LPs, in token-A units (A is the USDC side in every pool). */
  donationValueA: number
  /** Donation as a percentage of the total deposit value (token-A units). */
  donationPct: number
}

/**
 * Analyzes a two-sided deposit against live pool reserves and estimates how much of it
 * would be donated to existing LPs instead of minting LP shares.
 *
 * The donation is derived from the pool's own minting formula (min(lpA, lpB) for the
 * constant-product pool, exact Curve D-delta for the stable pair via
 * estimateLpSharesForDeposit): credited value = shareFraction × poolValueAfter, so the
 * uncredited remainder is exactly what existing LPs keep.
 *
 * Returns null when the estimate cannot be derived from live reserves / total LP supply.
 */
export function analyzeDualDepositBalance(params: {
  poolId: string
  amountA: number
  amountB: number
  reserveA: number
  reserveB: number
  totalLp: number
  amp?: bigint
}): DualDepositBalance | null {
  const { poolId, amountA, amountB, reserveA, reserveB, totalLp } = params
  if (![amountA, amountB, reserveA, reserveB, totalLp].every((v) => Number.isFinite(v) && v > 0)) {
    return null
  }

  const poolRateBPerA = reserveB / reserveA
  if (!Number.isFinite(poolRateBPerA) || poolRateBPerA <= 0) return null

  const preview = estimateLpSharesForDeposit({
    poolId,
    amountA,
    amountB,
    reserveA,
    reserveB,
    totalLp,
    amp: params.amp,
  })
  if (!preview || !(preview.shares > 0)) return null

  // Values in token-A units using the pool's own mid ratio.
  const depositValueA = amountA + amountB / poolRateBPerA
  const poolValueAfterA = reserveA + amountA + (reserveB + amountB) / poolRateBPerA
  const creditedValueA = (preview.shares / preview.totalLpAfter) * poolValueAfterA
  const donationValueA = Math.max(0, depositValueA - creditedValueA)
  const donationPct = depositValueA > 0 ? (donationValueA / depositValueA) * 100 : 0

  // Ratio-matched amounts: trim whichever side is in excess of the pool ratio.
  const balancedBForA = amountA * poolRateBPerA
  const balancedAForB = amountB / poolRateBPerA
  const optimizedAmountA = amountB / poolRateBPerA > amountA ? amountA : balancedAForB
  const optimizedAmountB = amountB / poolRateBPerA > amountA ? balancedBForA : amountB

  return {
    estimatedShares: preview.shares,
    optimizedAmountA,
    optimizedAmountB,
    donationValueA,
    donationPct,
  }
}

/**
 * Returns the ratio-matched deposit amounts that avoid donating any excess to existing
 * LPs (the larger side is trimmed down to the pool ratio). Null when inputs are invalid.
 */
export function optimizeDualDepositAmounts(params: {
  poolId: string
  amountA: number
  amountB: number
  reserveA: number
  reserveB: number
  totalLp: number
  amp?: bigint
}): { amountA: number; amountB: number } | null {
  const balance = analyzeDualDepositBalance(params)
  return balance ? { amountA: balance.optimizedAmountA, amountB: balance.optimizedAmountB } : null
}

