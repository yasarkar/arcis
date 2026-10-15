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

describe('WETH Pool (usdc-weth-pool) End-to-End Integration Tests', () => {
  const wethPool = ARCIS_POOLS.find((p) => p.id === 'usdc-weth-pool')

  it('is properly registered in ARCIS_POOLS with 18-decimal WETH and 0.30% fee tier', () => {
    expect(wethPool).toBeDefined()
    expect(wethPool!.name).toBe('USDC / WETH')
    expect(wethPool!.tokens[0].symbol).toBe('USDC')
    expect(wethPool!.tokens[0].decimals).toBe(6)
    expect(wethPool!.tokens[1].symbol).toBe('WETH')
    expect(wethPool!.tokens[1].decimals).toBe(18)
    expect(wethPool!.feeTierPercent).toBe(0.3)
    expect(wethPool!.lpTokenSymbol).toBe('af-USDC-WETH')
    expect(wethPool!.contractAddress).toBe(POOL_CONTRACTS.WETH_POOL)
  })

  it('routes WETH and ETH swap pairs to usdc-weth-pool', () => {
    expect(poolIdForSwapPair('USDC', 'WETH')).toBe('usdc-weth-pool')
    expect(poolIdForSwapPair('WETH', 'USDC')).toBe('usdc-weth-pool')
    expect(poolIdForSwapPair('USDC', 'ETH')).toBe('usdc-weth-pool')
    expect(poolIdForSwapPair('ETH', 'USDC')).toBe('usdc-weth-pool')
  })

  it('initialises with 0 baseline volume for honest metrics reporting', () => {
    expect(POOL_TESTNET_BASE_VOLUME['usdc-weth-pool']).toBe(0)
  })

  it('computes minLpShares using Constant Product (x*y=k) and 18-decimal counter asset', () => {
    // Pool state: 2,600,000 USDC (6 dec) / 1,000 WETH (18 dec) -> $2,600 per WETH.
    // Total LP: 50,000 LP (18 dec).
    const mockState = {
      [wethPool!.contractAddress]: {
        reserveA: '2600000',
        reserveB: '1000',
        totalLp: '50000',
      },
    }

    // Proportional deposit: 2,600 USDC (6 dec) + 1.0 WETH (18 dec)
    // Expected LP = (2600 * 50000) / 2600000 = 50 LP
    const amountA = parseUnits('2600', 6)
    const amountB = parseUnits('1', 18)

    const minLp = computeMinLpShares(
      wethPool!,
      wethPool!.contractAddress,
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
    // Initial deposit: 2,600 USDC (6 dec = 2,600,000,000) * 1 WETH (18 dec = 1,000,000,000,000,000,000)
    // Product = 2.6e9 * 1e18 = 2.6e27
    // sqrt = 50,990,195,135 (approx 5.099e10)
    // initialLp = sqrt * 1e6 = 50,990,195,135,000,000 (approx 5.099e16 wei)
    // shares = initialLp - 1000 wei
    const result = estimateLpSharesForDeposit({
      poolId: 'usdc-weth-pool',
      amountA: 2600,
      amountB: 1,
      reserveA: 0,
      reserveB: 0,
      totalLp: 0,
      allowInitialSeed: true,
    })

    expect(result).not.toBeNull()
    expect(result!.shares).toBeGreaterThan(0)
    expect(result!.totalLpAfter).toBeGreaterThan(result!.shares)
  })

  it('accurately detects and analyzes balanced vs off-ratio dual deposits for WETH', () => {
    // 2,600 USDC / 1 WETH into a pool of 26,000 USDC / 10 WETH with 100 LP:
    const balanced = analyzeDualDepositBalance({
      poolId: 'usdc-weth-pool',
      amountA: 2600,
      amountB: 1,
      reserveA: 26000,
      reserveB: 10,
      totalLp: 100,
    })

    expect(balanced).not.toBeNull()
    expect(balanced!.donationPct).toBeLessThan(0.01)
    expect(balanced!.estimatedShares).toBeCloseTo(10, 4)

    // Off-ratio deposit: 2,600 USDC + 2 WETH (excess 1 WETH):
    const offRatio = analyzeDualDepositBalance({
      poolId: 'usdc-weth-pool',
      amountA: 2600,
      amountB: 2,
      reserveA: 26000,
      reserveB: 10,
      totalLp: 100,
    })

    expect(offRatio).not.toBeNull()
    expect(offRatio!.donationPct).toBeGreaterThan(10) // Excess WETH is donated
  })

  it('calculates expected constant product swap output for USDC <-> WETH with 30 bps fee', () => {
    // 100,000 USDC / 40 WETH reserves ($2,500/WETH)
    const resA = parseUnits('100000', 6)
    const resB = parseUnits('40', 18)
    const inA = parseUnits('2500', 6) // swap 2,500 USDC for WETH

    const outB = calculateConstantProductExpectedOut(inA, resA, resB, 30n)
    expect(outB).toBeGreaterThan(0n)
    // Roughly ~0.97 WETH received after price impact and 0.30% fee
    const outBFormatted = Number(outB) / 1e18
    expect(outBFormatted).toBeGreaterThan(0.95)
    expect(outBFormatted).toBeLessThan(1.0)
  })
})
