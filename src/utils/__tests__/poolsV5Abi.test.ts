import { describe, it, expect } from 'vitest'
import { encodeFunctionData, decodeFunctionData } from 'viem'
import {
  STABLE_SWAP_V5_ABI,
  ARCIS_SWAP_ROUTER_V5_ABI,
  V5_MIN_A,
  V5_MAX_A,
  V5_MAX_TOTAL_FEE_BPS,
  V5_MINIMUM_LIQUIDITY,
  v5Deadline,
  v5SwapArgs,
  v5AddLiquidityArgs,
  v5RemoveLiquidityArgs,
  v5RouterSwapArgs,
  v5ZapParams,
} from '../../config/poolsV5'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const A = '0x3600000000000000000000000000000000000000' as const
const B = '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const
const POOL = '0x1111111111111111111111111111111111111111' as const

const names = (abi: readonly { type: string; name?: string }[], type: string) =>
  abi.filter((i) => i.type === type).map((i) => i.name)

describe('StableSwapPoolV5 ABI', () => {
  it('exposes the deadline-aware entrypoints', () => {
    const fn = (n: string) =>
      STABLE_SWAP_V5_ABI.find((i) => i.type === 'function' && i.name === n) as unknown as { inputs: { name: string }[] }
    expect(fn('swap').inputs.map((i) => i.name)).toEqual(['tokenIn', 'tokenOut', 'amountIn', 'minOut', 'deadline'])
    expect(fn('addLiquidity').inputs.map((i) => i.name)).toEqual(['amountAIn', 'amountBIn', 'minLpShares', 'deadline'])
    expect(fn('removeLiquidity').inputs.map((i) => i.name)).toEqual(['lpAmount', 'minOutA', 'minOutB', 'deadline'])
  })

  it('exposes the frontend views and no V4-only harvest/fee-reserve API', () => {
    const fns = names(STABLE_SWAP_V5_ABI, 'function')
    for (const n of [
      'getPoolState', 'getAmountOut', 'previewAddLiquidity', 'getVirtualPrice', 'getRate',
      'volume24hA', 'volume24hB', 'unclaimedFeeA', 'unclaimedFeeB', 'totalLp', 'reserveA', 'reserveB',
    ]) {
      expect(fns).toContain(n)
    }
    expect(fns).not.toContain('harvest')
    expect(fns).not.toContain('pendingFees')
  })

  it('swap calldata round-trips with minOut and deadline in the right slots', () => {
    const deadline = v5Deadline(600, 1_700_000_000_000)
    expect(deadline).toBe(1_700_000_600n)
    const data = encodeFunctionData({
      abi: STABLE_SWAP_V5_ABI,
      functionName: 'swap',
      args: v5SwapArgs(A, B, 1_000_000n, 990_000n, deadline),
    })
    const decoded = decodeFunctionData({ abi: STABLE_SWAP_V5_ABI, data })
    expect(decoded.args?.[3]).toBe(990_000n)
    expect(decoded.args?.[4]).toBe(deadline)
  })

  it('add/remove liquidity calldata carries the deadline', () => {
    const deadline = 1_700_000_600n
    const add = decodeFunctionData({
      abi: STABLE_SWAP_V5_ABI,
      data: encodeFunctionData({
        abi: STABLE_SWAP_V5_ABI,
        functionName: 'addLiquidity',
        args: v5AddLiquidityArgs(1n, 2n, 3n, deadline),
      }),
    })
    expect(add.args?.[3]).toBe(deadline)
    const rem = decodeFunctionData({
      abi: STABLE_SWAP_V5_ABI,
      data: encodeFunctionData({
        abi: STABLE_SWAP_V5_ABI,
        functionName: 'removeLiquidity',
        args: v5RemoveLiquidityArgs(1n, 2n, 3n, deadline),
      }),
    })
    expect(rem.args?.[3]).toBe(deadline)
  })

  it('rejects non-positive deadline windows', () => {
    expect(() => v5Deadline(0)).toThrow()
    expect(() => v5Deadline(-5)).toThrow()
    expect(() => v5Deadline(Number.NaN)).toThrow()
  })
})

describe('ArcisSwapRouterV5 ABI', () => {
  it('swapWithFee carries the deadline', () => {
    const deadline = 1_700_000_600n
    const data = encodeFunctionData({
      abi: ARCIS_SWAP_ROUTER_V5_ABI,
      functionName: 'swapWithFee',
      args: v5RouterSwapArgs(POOL, A, B, 1_000_000n, 1n, POOL, 30n, deadline),
    })
    const decoded = decodeFunctionData({ abi: ARCIS_SWAP_ROUTER_V5_ABI, data })
    expect(decoded.args?.[7]).toBe(deadline)
  })

  it('zapIn takes a single ZapParams tuple', () => {
    const params = v5ZapParams({
      pool: POOL,
      tokenIn: A,
      tokenOut: B,
      amountIn: 5_000_000n,
      minSwapOut: 1n,
      minLpShares: 1n,
      treasury: POOL,
      feeBps: 0n,
      deadline: 1_700_000_600n,
    })
    const data = encodeFunctionData({ abi: ARCIS_SWAP_ROUTER_V5_ABI, functionName: 'zapIn', args: [params] })
    const decoded = decodeFunctionData({ abi: ARCIS_SWAP_ROUTER_V5_ABI, data })
    expect(decoded.args?.[0]).toMatchObject({ amountIn: 5_000_000n, deadline: 1_700_000_600n })
  })
})

const solPath = resolve(__dirname, '../../../contracts/src/v5/StableSwapPoolV5.sol')
describe.skipIf(!existsSync(solPath))('V5 constants stay in sync with the Solidity source', () => {
  const src = existsSync(solPath) ? readFileSync(solPath, 'utf8') : ''
  const num = (name: string) => {
    const m = src.match(new RegExp(`constant ${name} = ([0-9_e.]+)`))
    expect(m, `constant ${name} not found`).not.toBeNull()
    return m![1].replace(/_/g, '')
  }
  it('A bounds, fee cap, minimum liquidity', () => {
    expect(BigInt(num('MIN_A'))).toBe(V5_MIN_A)
    expect(BigInt(num('MAX_A'))).toBe(V5_MAX_A)
    expect(BigInt(num('MAX_TOTAL_FEE_BPS'))).toBe(V5_MAX_TOTAL_FEE_BPS)
    expect(BigInt(Number(num('MINIMUM_LIQUIDITY')))).toBe(V5_MINIMUM_LIQUIDITY)
  })
})
