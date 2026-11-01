import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionData, toFunctionSelector, zeroAddress, type Address } from 'viem'
import { ARCIS_SWAP_ROUTER_ABI, POOL_CONTRACTS, STABLE_SWAP_ABI } from '../../../config/poolsConfig'
import {
  DEFAULT_DEADLINE_TTL_SECONDS,
  buildDeadline,
  buildPoolAddLiquidityCall,
  buildPoolAddLiquidityUcwCall,
  buildPoolSwapCall,
  buildPoolSwapUcwCall,
  buildRouterSwapCall,
  buildRouterSwapUcwCall,
  poolRequiresExplicitDeadline,
} from '../poolDeadline'

const DEADLINE_POOL = '0xabcdef0123456789abcdef0123456789abcdef01' as Address
const OTHER_POOL = '0x4fB42dBbA5AD26723106bd56cA647dEb4a75Cd90' as Address
const TOKEN_IN = '0x1111111111111111111111111111111111111111' as Address
const TOKEN_OUT = '0x2222222222222222222222222222222222222222' as Address
const TREASURY = '0x3333333333333333333333333333333333333333' as Address
const NOW_MS = 1_800_000_000_123
const NOW_S = Math.floor(NOW_MS / 1000)

const mutablePools = POOL_CONTRACTS as { EURC_CIRBTC_POOL: `0x${string}`; CIRBTC_WETH_POOL: `0x${string}` }
const originalPool = POOL_CONTRACTS.EURC_CIRBTC_POOL
const originalCirBtcWeth = POOL_CONTRACTS.CIRBTC_WETH_POOL

beforeEach(() => {
  mutablePools.EURC_CIRBTC_POOL = DEADLINE_POOL
  mutablePools.CIRBTC_WETH_POOL = zeroAddress
})
afterEach(() => {
  mutablePools.EURC_CIRBTC_POOL = originalPool
  mutablePools.CIRBTC_WETH_POOL = originalCirBtcWeth
  vi.useRealTimers()
})

describe('poolRequiresExplicitDeadline', () => {
  it('is true only for the configured EURC/cirBTC and cirBTC/WETH pools, case-insensitively', () => {
    expect(poolRequiresExplicitDeadline(DEADLINE_POOL)).toBe(true)
    expect(poolRequiresExplicitDeadline(DEADLINE_POOL.toLowerCase())).toBe(true)
    expect(poolRequiresExplicitDeadline(`0x${DEADLINE_POOL.slice(2).toUpperCase()}`)).toBe(true)
    expect(poolRequiresExplicitDeadline(OTHER_POOL)).toBe(false)
    expect(poolRequiresExplicitDeadline(POOL_CONTRACTS.STABLE_SWAP_POOL)).toBe(false)
    expect(poolRequiresExplicitDeadline(undefined)).toBe(false)
    expect(poolRequiresExplicitDeadline('')).toBe(false)

    // cirBTC/WETH configured
    mutablePools.CIRBTC_WETH_POOL = '0x1234567890123456789012345678901234567890' as Address
    expect(poolRequiresExplicitDeadline('0x1234567890123456789012345678901234567890')).toBe(true)
  })

  it('returns false for the zero address even when the pool is not deployed (zero config)', () => {
    mutablePools.EURC_CIRBTC_POOL = zeroAddress
    mutablePools.CIRBTC_WETH_POOL = zeroAddress
    expect(poolRequiresExplicitDeadline(zeroAddress)).toBe(false)
    expect(poolRequiresExplicitDeadline(DEADLINE_POOL)).toBe(false)
  })
})

describe('buildDeadline', () => {
  it('is an absolute unix-seconds bigint about 20 minutes after the supplied clock', () => {
    const deadline = buildDeadline(NOW_MS)
    expect(typeof deadline).toBe('bigint')
    expect(deadline).toBe(BigInt(NOW_S + 20 * 60))
    expect(DEFAULT_DEADLINE_TTL_SECONDS).toBe(1200)
  })

  it('is computed from the clock at call time (never cached) and lies in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW_MS))
    const first = buildDeadline()
    expect(first).toBeGreaterThan(BigInt(NOW_S))
    vi.setSystemTime(new Date(NOW_MS + 5 * 60_000))
    const second = buildDeadline()
    expect(second - first).toBe(300n)
  })

  it('never produces a far-future or max value and rejects bad TTLs', () => {
    expect(buildDeadline(NOW_MS)).toBeLessThan(BigInt(NOW_S) + 3600n)
    expect(() => buildDeadline(NOW_MS, 0)).toThrow()
    expect(() => buildDeadline(NOW_MS, -5)).toThrow()
    expect(() => buildDeadline(NOW_MS, Number.POSITIVE_INFINITY)).toThrow()
    expect(() => buildDeadline(NOW_MS, 365 * 24 * 3600)).toThrow()
    expect(() => buildDeadline(Number.NaN)).toThrow()
  })
})

describe('pool swap shapes', () => {
  it('keeps the legacy 4-arg swap for non-deadline pools', () => {
    const call = buildPoolSwapCall(OTHER_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, NOW_MS)
    expect(call).toEqual({ functionName: 'swap', args: [TOKEN_IN, TOKEN_OUT, 100n, 90n] })
    expect(buildPoolSwapUcwCall(OTHER_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, NOW_MS)).toEqual({
      abiFunctionSignature: 'swap(address,address,uint256,uint256)',
      abiParameters: [TOKEN_IN, TOKEN_OUT, '100', '90'],
    })
  })

  it('uses the 5-arg swap with a fresh deadline for the EURC/cirBTC pool', () => {
    const expected = BigInt(NOW_S + 1200)
    expect(buildPoolSwapCall(DEADLINE_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, NOW_MS)).toEqual({
      functionName: 'swap',
      args: [TOKEN_IN, TOKEN_OUT, 100n, 90n, expected],
    })
    expect(buildPoolSwapUcwCall(DEADLINE_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, NOW_MS)).toEqual({
      abiFunctionSignature: 'swap(address,address,uint256,uint256,uint256)',
      abiParameters: [TOKEN_IN, TOKEN_OUT, '100', '90', expected.toString()],
    })
  })

  it('encodes distinct selectors for the two swap overloads via STABLE_SWAP_ABI', () => {
    const legacy = encodeFunctionData({
      abi: STABLE_SWAP_ABI,
      ...buildPoolSwapCall(OTHER_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, NOW_MS),
    })
    const withDeadline = encodeFunctionData({
      abi: STABLE_SWAP_ABI,
      ...buildPoolSwapCall(DEADLINE_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, NOW_MS),
    })
    expect(legacy.slice(0, 10)).toBe(toFunctionSelector('swap(address,address,uint256,uint256)'))
    expect(withDeadline.slice(0, 10)).toBe(toFunctionSelector('swap(address,address,uint256,uint256,uint256)'))
    const decoded = decodeFunctionData({ abi: STABLE_SWAP_ABI, data: withDeadline })
    expect(decoded.args?.[4]).toBe(BigInt(NOW_S + 1200))
  })
})

describe('pool addLiquidity shapes', () => {
  it('keeps the legacy 3-arg addLiquidity for non-deadline pools', () => {
    expect(buildPoolAddLiquidityCall(OTHER_POOL, 1n, 2n, 3n, NOW_MS)).toEqual({
      functionName: 'addLiquidity',
      args: [1n, 2n, 3n],
    })
    expect(buildPoolAddLiquidityUcwCall(OTHER_POOL, 1n, 2n, 3n, NOW_MS)).toEqual({
      abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256)',
      abiParameters: ['1', '2', '3'],
    })
  })

  it('uses the 4-arg addLiquidity with a fresh deadline for the EURC/cirBTC pool', () => {
    const expected = BigInt(NOW_S + 1200)
    expect(buildPoolAddLiquidityCall(DEADLINE_POOL, 1n, 2n, 3n, NOW_MS)).toEqual({
      functionName: 'addLiquidity',
      args: [1n, 2n, 3n, expected],
    })
    expect(buildPoolAddLiquidityUcwCall(DEADLINE_POOL, 1n, 2n, 3n, NOW_MS)).toEqual({
      abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256,uint256)',
      abiParameters: ['1', '2', '3', expected.toString()],
    })
  })

  it('encodes distinct selectors for the two addLiquidity overloads via STABLE_SWAP_ABI', () => {
    const legacy = encodeFunctionData({ abi: STABLE_SWAP_ABI, ...buildPoolAddLiquidityCall(OTHER_POOL, 1n, 2n, 3n, NOW_MS) })
    const withDeadline = encodeFunctionData({ abi: STABLE_SWAP_ABI, ...buildPoolAddLiquidityCall(DEADLINE_POOL, 1n, 2n, 3n, NOW_MS) })
    expect(legacy.slice(0, 10)).toBe(toFunctionSelector('addLiquidity(uint256,uint256,uint256)'))
    expect(withDeadline.slice(0, 10)).toBe(toFunctionSelector('addLiquidity(uint256,uint256,uint256,uint256)'))
  })
})

describe('router swap shapes', () => {
  const params = (pool: Address) => ({
    pool,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: 100n,
    minOut: 90n,
    treasury: TREASURY,
    feeBps: 5n,
  })

  it('keeps swapWithFee for non-deadline pools', () => {
    expect(buildRouterSwapCall(params(OTHER_POOL), NOW_MS)).toEqual({
      functionName: 'swapWithFee',
      args: [OTHER_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, TREASURY, 5n],
    })
    expect(buildRouterSwapUcwCall(params(OTHER_POOL), NOW_MS)).toEqual({
      abiFunctionSignature: 'swapWithFee(address,address,address,uint256,uint256,address,uint256)',
      abiParameters: [OTHER_POOL, TOKEN_IN, TOKEN_OUT, '100', '90', TREASURY, '5'],
    })
  })

  it('uses swapWithFeeAndDeadline only for the EURC/cirBTC pool', () => {
    const expected = BigInt(NOW_S + 1200)
    const call = buildRouterSwapCall(params(DEADLINE_POOL), NOW_MS)
    expect(call).toEqual({
      functionName: 'swapWithFeeAndDeadline',
      args: [DEADLINE_POOL, TOKEN_IN, TOKEN_OUT, 100n, 90n, TREASURY, 5n, expected],
    })
    expect(buildRouterSwapUcwCall(params(DEADLINE_POOL), NOW_MS)).toEqual({
      abiFunctionSignature:
        'swapWithFeeAndDeadline(address,address,address,uint256,uint256,address,uint256,uint256)',
      abiParameters: [DEADLINE_POOL, TOKEN_IN, TOKEN_OUT, '100', '90', TREASURY, '5', expected.toString()],
    })
    if (call.functionName !== 'swapWithFeeAndDeadline') throw new Error('unreachable')
    const data = encodeFunctionData({ abi: ARCIS_SWAP_ROUTER_ABI, ...call })
    expect(data.slice(0, 10)).toBe(
      toFunctionSelector('swapWithFeeAndDeadline(address,address,address,uint256,uint256,address,uint256,uint256)')
    )
  })
})
