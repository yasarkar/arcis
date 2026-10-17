import { describe, it, expect } from 'vitest'
import { ARCIS_POOLS, POOL_CONTRACTS } from '../../config/poolsConfig'
import { computeMinLpShares } from '../../hooks/usePoolsData'
import {
  estimateLpSharesForDeposit,
  analyzeDualDepositBalance,
  calculateConstantProductExpectedOut,
} from '../poolMath'
import { poolIdForSwapPair, POOL_TESTNET_BASE_VOLUME } from '../poolVolumeUtils'
import { parseUnits } from 'viem'

describe('EURC / WETH Pool (eurc-weth-pool) End-to-End Integration Tests', () => {
  const eurcWethPool = ARCIS_POOLS.find((p) => p.id === 'eurc-weth-pool')

  it('is properly registered in ARCIS_POOLS with 6-dec EURC, 18-dec WETH, and 0.30% fee tier', () => {
    expect(eurcWethPool).toBeDefined()
    expect(eurcWethPool!.name).toBe('EURC / WETH')
    expect(eurcWethPool!.tokens[0].symbol).toBe('EURC')
    expect(eurcWethPool!.tokens[0].decimals).toBe(6)
    expect(eurcWethPool!.tokens[1].symbol).toBe('WETH')
    expect(eurcWethPool!.tokens[1].decimals).toBe(18)
    expect(eurcWethPool!.feeTierPercent).toBe(0.3)
    expect(eurcWethPool!.lpTokenSymbol).toBe('af-EURC-WETH')
    expect(eurcWethPool!.contractAddress).toBe(POOL_CONTRACTS.EURC_WETH_POOL)
    expect(eurcWethPool!.tags).toContain('Concentrated Liquidity')
  })

  it('routes EURC and WETH/ETH swap pairs to eurc-weth-pool', () => {
    expect(poolIdForSwapPair('EURC', 'WETH')).toBe('eurc-weth-pool')
    expect(poolIdForSwapPair('WETH', 'EURC')).toBe('eurc-weth-pool')
    expect(poolIdForSwapPair('EURC', 'ETH')).toBe('eurc-weth-pool')
    expect(poolIdForSwapPair('ETH', 'EURC')).toBe('eurc-weth-pool')
  })

  it('initialises with 0 baseline volume for honest metrics reporting', () => {
    expect(POOL_TESTNET_BASE_VOLUME['eurc-weth-pool']).toBe(0)
  })

  it('computes minLpShares using Constant Product (x*y=k) and 18-decimal counter asset', () => {
    // Mock pool state: 2,400,000 EURC (6 dec) / 1,000 WETH (18 dec) -> 2,400 EURC per WETH.
    // Total LP: 50,000 LP (18 dec).
    const mockPoolAddress = '0x1234567890123456789012345678901234567890' as `0x${string}`
    const mockState = {
      [mockPoolAddress]: {
        reserveA: '2400000',
        reserveB: '1000',
        totalLp: '50000',
      },
    }

    // Proportional deposit: 2,400 EURC (6 dec) + 1.0 WETH (18 dec)
    // Expected LP = (2400 * 50000) / 2400000 = 50 LP
    const amountA = parseUnits('2400', 6)
    const amountB = parseUnits('1', 18)

    const minLp = computeMinLpShares(
      eurcWethPool!,
      mockPoolAddress,
      mockState,
      amountA,
      amountB,
      18,
      0.5 // 0.5% slippage -> 99.5% of 50 = 49.75 LP
    )

    const expected50Lp = parseUnits('50', 18)
    const expectedMinOut = (expected50Lp * 9950n) / 10000n
    expect(minLp).toBe(expectedMinOut)
  })

  it('computes initial zero-liquidity seed LP shares with geometric-mean normalization (1e6 scalar)', () => {
    // Initial deposit: 2,400 EURC (6 dec = 2,400,000,000) * 1 WETH (18 dec = 1,000,000,000,000,000,000)
    const result = estimateLpSharesForDeposit({
      poolId: 'eurc-weth-pool',
      amountA: 2400,
      amountB: 1,
      reserveA: 0,
      reserveB: 0,
      totalLp: 0,
      allowInitialSeed: true,
    })

    expect(result).not.toBeNull()
    expect(result!.shares).toBeGreaterThan(0)
    expect(result!.totalLpAfter).toBeGreaterThanOrEqual(result!.shares)
    expect(result!.shares).toBeCloseTo(48.989, 2)
  })

  it('protects against unbalanced deposits by flagging excess donation', () => {
    // Pool ratio is 2,400 EURC per 1 WETH
    // User tries to deposit 4,800 EURC with only 1 WETH (100% excess EURC)
    const balance = analyzeDualDepositBalance({
      poolId: 'eurc-weth-pool',
      amountA: 4800,
      amountB: 1,
      reserveA: 240000,
      reserveB: 100,
      totalLp: 5000,
    })

    expect(balance).not.toBeNull()
    expect(balance!.donationPct).toBeGreaterThan(0)
    expect(balance!.optimizedAmountA).toBeCloseTo(2400, 1)
    expect(balance!.optimizedAmountB).toBeCloseTo(1, 4)
  })

  it('calculates expected output for EURC <-> WETH swaps using 30 bps fee', () => {
    // 240,000 EURC reserve, 100 WETH reserve
    const resA = parseUnits('240000', 6)
    const resB = parseUnits('100', 18)
    const amountIn = parseUnits('2400', 6) // swap 2,400 EURC
    const feeBps = 30n // 0.30%

    const expectedWethOut = calculateConstantProductExpectedOut(amountIn, resA, resB, feeBps)
    expect(expectedWethOut).toBeGreaterThan(0n)
    // Roughly 1 WETH minus fee and price impact (~0.987 WETH)
    const formatted = parseFloat(expectedWethOut.toString()) / 1e18
    expect(formatted).toBeCloseTo(0.987, 2)
  })
})
