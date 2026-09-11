// src/utils/poolMath.ts
// Pure integer / BigInt math for AMM pools on Arcis.
// Mirrors the on-chain Curve Stableswap invariant from StableSwapPoolV3.sol
// and the Constant Product invariant from ConstantProductPoolV3.sol.

/**
 * Computes the Curve Stableswap invariant D for a 2-token pool.
 * @param x Token A reserve (6 decimals for USDC)
 * @param y Token B reserve (6 decimals for EURC)
 * @param amp Amplification coefficient (default 100)
 */
export function getStableSwapD(x: bigint, y: bigint, amp: bigint = 100n): bigint {
  const s = x + y
  if (s === 0n) return 0n

  let prevD = 0n
  let d = s
  const Ann = amp * 4n // n=2 -> Ann = A * 4

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
export function getStableSwapY(x: bigint, d: bigint, amp: bigint = 100n): bigint {
  const Ann = amp * 4n
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
 * @param feeBps Swap fee in basis points (e.g. 12n for 0.12%)
 * @param amp Amplification coefficient (default 100n)
 */
export function calculateStableSwapExpectedOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint = 12n,
  amp: bigint = 100n
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
 * @param feeBps Swap fee in basis points (e.g. 25n for 0.25%)
 */
export function calculateConstantProductExpectedOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeBps: bigint = 25n
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
