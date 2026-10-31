import { describe, it, expect } from 'vitest'
import { ARCIS_POOLS, POOL_CONTRACTS, EURC_CIRBTC_CONSTANT_PRODUCT_LP_FEE_BPS } from '../../config/poolsConfig'
import { computeMinLpShares } from '../../hooks/usePoolsData'
import {
  estimateLpSharesForDeposit,
  analyzeDualDepositBalance,
  calculateConstantProductExpectedOut,
} from '../poolMath'
import { poolIdForSwapPair, POOL_TESTNET_BASE_VOLUME } from '../poolVolumeUtils'
import { parseUnits } from 'viem'

describe('EURC / cirBTC Pool (eurc-cirbtc-pool) End-to-End Integration Tests', () => {
  const eurcCirBtcPool = ARCIS_POOLS.find((p) => p.id === 'eurc-cirbtc-pool')

  it('is properly registered in ARCIS_POOLS with 6-dec EURC, 8-dec cirBTC, and 0.25% fee tier', () => {
    expect(eurcCirBtcPool).toBeDefined()
    expect(eurcCirBtcPool!.name).toBe('EURC / cirBTC')
    expect(eurcCirBtcPool!.tokens[0].symbol).toBe('EURC')
    expect(eurcCirBtcPool!.tokens[0].decimals).toBe(6)
    expect(eurcCirBtcPool!.tokens[1].symbol).toBe('cirBTC')
    expect(eurcCirBtcPool!.tokens[1].decimals).toBe(8)
    expect(eurcCirBtcPool!.feeTierPercent).toBe(0.25)
    expect(eurcCirBtcPool!.lpTokenSymbol).toBe('af-EURC-cirBTC')
    expect(eurcCirBtcPool!.contractAddress).toBe(POOL_CONTRACTS.EURC_CIRBTC_POOL)
    expect(eurcCirBtcPool!.tags).toContain('Concentrated Liquidity')
    expect(EURC_CIRBTC_CONSTANT_PRODUCT_LP_FEE_BPS).toBe(25n)
  })

  it('routes EURC and cirBTC/BTC swap pairs to eurc-cirbtc-pool', () => {
    expect(poolIdForSwapPair('EURC', 'cirBTC')).toBe('eurc-cirbtc-pool')
    expect(poolIdForSwapPair('cirBTC', 'EURC')).toBe('eurc-cirbtc-pool')
    expect(poolIdForSwapPair('EURC', 'BTC')).toBe('eurc-cirbtc-pool')
    expect(poolIdForSwapPair('BTC', 'EURC')).toBe('eurc-cirbtc-pool')
  })

  it('initialises with 0 baseline volume for honest metrics reporting', () => {
    expect(POOL_TESTNET_BASE_VOLUME['eurc-cirbtc-pool']).toBe(0)
  })

  it('computes minLpShares using Constant Product (x*y=k) and 8-decimal counter asset', () => {
    // Mock pool state: 600,000 EURC (6 dec) / 10 cirBTC (8 dec) -> 60,000 EURC per cirBTC.
    // Total LP: 5,000 LP (18 dec).
    const mockPoolAddress = '0x1111222233334444555566667777888899990000' as `0x${string}`
    const mockState = {
      [mockPoolAddress]: {
        reserveA: '600000',
        reserveB: '10',
        totalLp: '5000',
      },
    }

    // Proportional deposit: 60,000 EURC (6 dec) + 1.0 cirBTC (8 dec)
    // Expected LP = (60,000 * 5,000) / 600,000 = 500 LP
    const amountA = parseUnits('60000', 6)
    const amountB = parseUnits('1', 8)

    const minLp = computeMinLpShares(
      eurcCirBtcPool!,
      mockPoolAddress,
      mockState,
      amountA,
      amountB,
      8,
      0.5 // 0.5% slippage -> 99.5% of 500 = 497.5 LP
    )

    const expected500Lp = parseUnits('500', 18)
    const expectedMinOut = (expected500Lp * 9950n) / 10000n
    expect(minLp).toBe(expectedMinOut)
  })

  it('computes initial zero-liquidity seed LP shares with geometric-mean normalization (1e11 scalar)', () => {
    // Initial deposit: 60,000 EURC (6 dec = 60,000,000,000) * 1 cirBTC (8 dec = 100,000,000)
    const result = estimateLpSharesForDeposit({
      poolId: 'eurc-cirbtc-pool',
      amountA: 60000,
      amountB: 1,
      reserveA: 0,
      reserveB: 0,
      totalLp: 0,
      allowInitialSeed: true,
    })

    expect(result).not.toBeNull()
    expect(result!.shares).toBeGreaterThan(0)
    expect(result!.totalLpAfter).toBeGreaterThanOrEqual(result!.shares)
    // sqrt(6e10 * 1e8) = sqrt(6e18) = 2.449489742e9 raw sqrt * 1e11 = 2.449489742e20 wei = ~244.948 LP
    expect(result!.shares).toBeCloseTo(244.948, 2)
  })

  it('protects against unbalanced deposits by flagging excess donation', () => {
    // Pool ratio is 60,000 EURC per 1 cirBTC
    // User tries to deposit 120,000 EURC with only 1 cirBTC (100% excess EURC)
    const balance = analyzeDualDepositBalance({
      poolId: 'eurc-cirbtc-pool',
      amountA: 120000,
      amountB: 1,
      reserveA: 600000,
      reserveB: 10,
      totalLp: 5000,
    })

    expect(balance).not.toBeNull()
    expect(balance!.donationPct).toBeGreaterThan(0)
    expect(balance!.optimizedAmountA).toBeCloseTo(60000, 1)
    expect(balance!.optimizedAmountB).toBeCloseTo(1, 4)
  })

  it('calculates expected output for Constant Product swaps with 0.25% fee tier', () => {
    const reserveIn = parseUnits('600000', 6)  // 600,000 EURC
    const reserveOut = parseUnits('10', 8)     // 10 cirBTC
    const amountIn = parseUnits('60000', 6)    // 60,000 EURC in

    const expectedOut = calculateConstantProductExpectedOut(
      amountIn,
      reserveIn,
      reserveOut,
      EURC_CIRBTC_CONSTANT_PRODUCT_LP_FEE_BPS
    )

    expect(expectedOut).toBeGreaterThan(0n)
    // Net amount in = 60,000 * (1 - 0.0025) = 59,850 EURC
    // Expected cirBTC out = (10 * 59,850) / (600,000 + 59,850) = 598,500 / 659,850 = 0.90702432 cirBTC
    const expectedRaw = (parseUnits('10', 8) * parseUnits('59850', 6)) / (parseUnits('600000', 6) + parseUnits('59850', 6))
    expect(expectedOut).toBe(expectedRaw)
  })
})

