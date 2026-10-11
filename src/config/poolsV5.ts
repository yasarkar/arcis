// StableSwapPoolV5 / ArcisSwapRouterV5 frontend bindings (additive — V3/V4 flows are untouched).
//
// Enable with:
//   VITE_POOL_V5_STABLE_SWAP=0x...   (StableSwapPoolV5)
//   VITE_POOL_V5_ROUTER=0x...        (ArcisSwapRouterV5)
//   VITE_POOL_V5_RATE_PROVIDER=0x... (optional; informational — the pool reads it on-chain)
//
// ABIs are generated from the Foundry build (`node scripts/gen-v5-abis.mjs`).
import {
  STABLE_SWAP_V5_ABI,
  ARCIS_SWAP_ROUTER_V5_ABI,
  MANUAL_RATE_PROVIDER_ABI,
} from './abis/v5.generated'

export { STABLE_SWAP_V5_ABI, ARCIS_SWAP_ROUTER_V5_ABI, MANUAL_RATE_PROVIDER_ABI }

const ZERO = '0x0000000000000000000000000000000000000000' as `0x${string}`

function readEnv(key: string): string | undefined {
  const fromProcess = typeof process !== 'undefined' && process.env ? process.env[key] : undefined
  if (fromProcess) return fromProcess
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const fromVite = (import.meta.env as Record<string, string | undefined>)[key]
    if (fromVite) return fromVite
  }
  return undefined
}

const addr = (v: string | undefined): `0x${string}` =>
  v && /^0x[a-fA-F0-9]{40}$/.test(v) ? (v as `0x${string}`) : ZERO

export const POOL_CONTRACTS_V5 = {
  STABLE_SWAP_POOL: addr(readEnv('VITE_POOL_V5_STABLE_SWAP')),
  ARCIS_SWAP_ROUTER: addr(readEnv('VITE_POOL_V5_ROUTER')),
  RATE_PROVIDER: addr(readEnv('VITE_POOL_V5_RATE_PROVIDER')),
}

/** V5 is active only when both the pool and the router are configured. */
export const POOL_VERSION_V5: boolean =
  POOL_CONTRACTS_V5.STABLE_SWAP_POOL !== ZERO && POOL_CONTRACTS_V5.ARCIS_SWAP_ROUTER !== ZERO

// ── On-chain constants mirrored from StableSwapPoolV5 (kept in sync by v5Abi.test.ts) ──────────
export const V5_MIN_A = 5n
export const V5_MAX_A = 200n
export const V5_MAX_TOTAL_FEE_BPS = 100n
export const V5_MINIMUM_LIQUIDITY = 10n ** 15n
/** Tokens are 6-dec; the pool's internal math and LP token use 18 decimals. */
export const V5_LP_DECIMALS = 18
export const V5_RATE_DECIMALS = 18

/** Default transaction deadline window. */
export const V5_DEFAULT_DEADLINE_SECS = 20 * 60

/** Unix-seconds deadline for pool/router calls. `nowMs` is injectable for tests. */
export function v5Deadline(secondsFromNow: number = V5_DEFAULT_DEADLINE_SECS, nowMs: number = Date.now()): bigint {
  if (!Number.isFinite(secondsFromNow) || secondsFromNow <= 0) {
    throw new Error('deadline window must be a positive number of seconds')
  }
  return BigInt(Math.floor(nowMs / 1000) + Math.floor(secondsFromNow))
}

// ── Call-argument builders (positional, matching the V5 ABI) ────────────────────────────────
export function v5SwapArgs(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  minOut: bigint,
  deadline: bigint = v5Deadline(),
) {
  return [tokenIn, tokenOut, amountIn, minOut, deadline] as const
}

export function v5AddLiquidityArgs(
  amountA: bigint,
  amountB: bigint,
  minLpShares: bigint,
  deadline: bigint = v5Deadline(),
) {
  return [amountA, amountB, minLpShares, deadline] as const
}

export function v5RemoveLiquidityArgs(
  lpAmount: bigint,
  minOutA: bigint,
  minOutB: bigint,
  deadline: bigint = v5Deadline(),
) {
  return [lpAmount, minOutA, minOutB, deadline] as const
}

export interface V5ZapParams {
  pool: `0x${string}`
  tokenIn: `0x${string}`
  tokenOut: `0x${string}`
  amountIn: bigint
  minSwapOut: bigint
  minLpShares: bigint
  treasury: `0x${string}`
  feeBps: bigint
  deadline: bigint
}

/** `zapIn` takes ONE tuple argument: `args: [v5ZapParams(...)]`. */
export function v5ZapParams(p: Omit<V5ZapParams, 'deadline'> & { deadline?: bigint }): V5ZapParams {
  return { ...p, deadline: p.deadline ?? v5Deadline() }
}

export function v5RouterSwapArgs(
  pool: `0x${string}`,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  minOut: bigint,
  treasury: `0x${string}`,
  feeBps: bigint,
  deadline: bigint = v5Deadline(),
) {
  return [pool, tokenIn, tokenOut, amountIn, minOut, treasury, feeBps, deadline] as const
}

/** Frontend reads: one multicall-friendly snapshot (never reverts on oracle failure). */
export const V5_POOL_STATE_FN = 'getPoolState' as const

/** Quote helpers exposed by the pool for exact-parity previews (no client-side curve math needed). */
export const V5_QUOTE_FNS = { swap: 'getAmountOut', addLiquidity: 'previewAddLiquidity' } as const

/** Pool revert reasons worth surfacing to users in plain language. */
export const V5_ERROR_MESSAGES: Record<string, string> = {
  DeadlineExpired: 'The transaction took too long. Please try again.',
  SlippageExceeded: 'Price moved beyond your slippage tolerance. Please retry.',
  RateUnavailable: 'The EUR/USD price feed is unavailable. Swaps and deposits are paused; withdrawals still work.',
  EnforcedPause: 'This pool is paused. Withdrawals remain available.',
  ZeroAmountOut: 'Amount is too small to produce any output.',
  InvalidReserves: 'Trade size exceeds the pool’s available liquidity.',
  UnexpectedTransferAmount: 'This token charges a transfer fee and is not supported.',
}
