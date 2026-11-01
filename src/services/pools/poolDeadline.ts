import type { Address } from 'viem'
import { POOL_CONTRACTS } from '../../config/poolsConfig'

/**
 * V4 pools with audited MEV protection (EURC/cirBTC and cirBTC/WETH) only expose deadline-taking entry points:
 *   swap(tokenIn, tokenOut, amountIn, minOut, deadline)
 *   addLiquidity(amountAIn, amountBIn, minLpShares, deadline)
 * (they revert DeadlineExpired when block.timestamp > deadline). Older pools keep the
 * legacy 4-arg swap / 3-arg addLiquidity, so the deadline shapes are selected per pool here and
 * call sites stay on a single code path.
 */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Default time-to-live for a freshly built deadline: 20 minutes. */
export const DEFAULT_DEADLINE_TTL_SECONDS = 20 * 60

/** Upper bound on a TTL so a deadline can never degrade into a "far future" / max-uint value. */
export const MAX_DEADLINE_TTL_SECONDS = 24 * 60 * 60

/** True for deployed, non-zero V4 pools that require explicit deadlines (EURC/cirBTC and cirBTC/WETH). Case-insensitive. */
export function poolRequiresExplicitDeadline(poolAddress?: string | null): boolean {
  if (!poolAddress) return false
  const target = poolAddress.toLowerCase()
  if (target === ZERO_ADDRESS) return false

  const eurcCirBtc = String(POOL_CONTRACTS.EURC_CIRBTC_POOL || '').toLowerCase()
  if (eurcCirBtc && eurcCirBtc !== ZERO_ADDRESS && target === eurcCirBtc) return true

  const cirBtcWeth = String(POOL_CONTRACTS.CIRBTC_WETH_POOL || '').toLowerCase()
  if (cirBtcWeth && cirBtcWeth !== ZERO_ADDRESS && target === cirBtcWeth) return true

  return false
}

/**
 * Absolute unix-seconds deadline, computed from the wall clock at transaction-build time.
 * Call it right before encoding/sending (after any approval prompts), never once up front.
 */
export function buildDeadline(
  nowMs: number = Date.now(),
  ttlSeconds: number = DEFAULT_DEADLINE_TTL_SECONDS
): bigint {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new Error('Cannot build a transaction deadline from an invalid clock value.')
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_DEADLINE_TTL_SECONDS) {
    throw new Error('Transaction deadline TTL must be positive and no longer than 24 hours.')
  }
  return BigInt(Math.floor(nowMs / 1000) + Math.floor(ttlSeconds))
}

// ── Pool: swap ───────────────────────────────────────────────────────────────

export type PoolSwapCall = {
  functionName: 'swap'
  args:
    | readonly [Address, Address, bigint, bigint]
    | readonly [Address, Address, bigint, bigint, bigint]
}

/** {functionName,args} for viem encode/estimate/write against STABLE_SWAP_ABI. */
export function buildPoolSwapCall(
  poolAddress: string,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  minOut: bigint,
  nowMs?: number
): PoolSwapCall {
  if (poolRequiresExplicitDeadline(poolAddress)) {
    return { functionName: 'swap', args: [tokenIn, tokenOut, amountIn, minOut, buildDeadline(nowMs)] }
  }
  return { functionName: 'swap', args: [tokenIn, tokenOut, amountIn, minOut] }
}

/** {abiFunctionSignature,abiParameters} for the Circle UCW contract-execution challenge. */
export function buildPoolSwapUcwCall(
  poolAddress: string,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  minOut: bigint,
  nowMs?: number
): { abiFunctionSignature: string; abiParameters: string[] } {
  const base = [tokenIn, tokenOut, amountIn.toString(), minOut.toString()]
  if (poolRequiresExplicitDeadline(poolAddress)) {
    return {
      abiFunctionSignature: 'swap(address,address,uint256,uint256,uint256)',
      abiParameters: [...base, buildDeadline(nowMs).toString()],
    }
  }
  return { abiFunctionSignature: 'swap(address,address,uint256,uint256)', abiParameters: base }
}

// ── Pool: addLiquidity ───────────────────────────────────────────────────────

export type PoolAddLiquidityCall = {
  functionName: 'addLiquidity'
  args: readonly [bigint, bigint, bigint] | readonly [bigint, bigint, bigint, bigint]
}

export function buildPoolAddLiquidityCall(
  poolAddress: string,
  amountA: bigint,
  amountB: bigint,
  minLpShares: bigint,
  nowMs?: number
): PoolAddLiquidityCall {
  if (poolRequiresExplicitDeadline(poolAddress)) {
    return { functionName: 'addLiquidity', args: [amountA, amountB, minLpShares, buildDeadline(nowMs)] }
  }
  return { functionName: 'addLiquidity', args: [amountA, amountB, minLpShares] }
}

export function buildPoolAddLiquidityUcwCall(
  poolAddress: string,
  amountA: bigint,
  amountB: bigint,
  minLpShares: bigint,
  nowMs?: number
): { abiFunctionSignature: string; abiParameters: string[] } {
  const base = [amountA.toString(), amountB.toString(), minLpShares.toString()]
  if (poolRequiresExplicitDeadline(poolAddress)) {
    return {
      abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256,uint256)',
      abiParameters: [...base, buildDeadline(nowMs).toString()],
    }
  }
  return { abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256)', abiParameters: base }
}

// ── Router: swapWithFee / swapWithFeeAndDeadline ─────────────────────────────

export interface RouterSwapParams {
  pool: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minOut: bigint
  treasury: Address
  feeBps: bigint
}

export type RouterSwapCall =
  | {
      functionName: 'swapWithFee'
      args: readonly [Address, Address, Address, bigint, bigint, Address, bigint]
    }
  | {
      functionName: 'swapWithFeeAndDeadline'
      args: readonly [Address, Address, Address, bigint, bigint, Address, bigint, bigint]
    }

/**
 * Router swap call. `swapWithFeeAndDeadline` is used only when the target pool needs an explicit
 * deadline; every other pool keeps the legacy `swapWithFee`.
 */
export function buildRouterSwapCall(p: RouterSwapParams, nowMs?: number): RouterSwapCall {
  const base = [p.pool, p.tokenIn, p.tokenOut, p.amountIn, p.minOut, p.treasury, p.feeBps] as const
  if (poolRequiresExplicitDeadline(p.pool)) {
    return { functionName: 'swapWithFeeAndDeadline', args: [...base, buildDeadline(nowMs)] }
  }
  return { functionName: 'swapWithFee', args: base }
}

export function buildRouterSwapUcwCall(
  p: RouterSwapParams,
  nowMs?: number
): { abiFunctionSignature: string; abiParameters: string[] } {
  const base = [
    p.pool,
    p.tokenIn,
    p.tokenOut,
    p.amountIn.toString(),
    p.minOut.toString(),
    p.treasury,
    p.feeBps.toString(),
  ]
  if (poolRequiresExplicitDeadline(p.pool)) {
    return {
      abiFunctionSignature:
        'swapWithFeeAndDeadline(address,address,address,uint256,uint256,address,uint256,uint256)',
      abiParameters: [...base, buildDeadline(nowMs).toString()],
    }
  }
  return {
    abiFunctionSignature: 'swapWithFee(address,address,address,uint256,uint256,address,uint256)',
    abiParameters: base,
  }
}
