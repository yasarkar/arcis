import { describe, it, expect } from 'vitest'
import { ARCIS_POOLS, POOL_CONTRACTS, CIRBTC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS } from '../../config/poolsConfig'
import { computeMinLpShares } from '../../hooks/usePoolsData'
import {
  estimateLpSharesForDeposit,
  analyzeDualDepositBalance,
  calculateConstantProductExpectedOut,
} from '../poolMath'
import { poolIdForSwapPair, POOL_TESTNET_BASE_VOLUME } from '../poolVolumeUtils'
import { resolveArcNativeRoute } from '../../services/swapService'
import { parseUnits } from 'viem'

describe('cirBTC / WETH Pool (cirbtc-weth-pool) End-to-End Integration Tests', () => {
  const cirBtcWethPool = ARCIS_POOLS.find((p) => p.id === 'cirbtc-weth-pool')

  it('is properly registered in ARCIS_POOLS with 8-dec cirBTC, 18-dec WETH, and 0.30% fee tier', () => {
    expect(cirBtcWethPool).toBeDefined()
    expect(cirBtcWethPool!.name).toBe('cirBTC / WETH')
    expect(cirBtcWethPool!.tokens[0].symbol).toBe('cirBTC')
    expect(cirBtcWethPool!.tokens[0].decimals).toBe(8)
    expect(cirBtcWethPool!.tokens[1].symbol).toBe('WETH')
    expect(cirBtcWethPool!.tokens[1].decimals).toBe(18)
    expect(cirBtcWethPool!.feeTierPercent).toBe(0.30)
    expect(cirBtcWethPool!.lpTokenSymbol).toBe('af-cirBTC-WETH')
    expect(cirBtcWethPool!.contractAddress).toBe(POOL_CONTRACTS.CIRBTC_WETH_POOL)
    expect(cirBtcWethPool!.tags).toContain('Concentrated Liquidity')
    expect(CIRBTC_WETH_CONSTANT_PRODUCT_LP_FEE_BPS).toBe(30n)
  })

  it('routes cirBTC/BTC and WETH/ETH swap pairs to cirbtc-weth-pool', () => {
    expect(poolIdForSwapPair('cirBTC', 'WETH')).toBe('cirbtc-weth-pool')
    expect(poolIdForSwapPair('WETH', 'cirBTC')).toBe('cirbtc-weth-pool')
    expect(poolIdForSwapPair('BTC', 'ETH')).toBe('cirbtc-weth-pool')
    expect(poolIdForSwapPair('ETH', 'BTC')).toBe('cirbtc-weth-pool')
    expect(poolIdForSwapPair('cirBTC', 'ETH')).toBe('cirbtc-weth-pool')
    expect(poolIdForSwapPair('BTC', 'WETH')).toBe('cirbtc-weth-pool')
  })

  it('resolves direct single-hop native swap route when pool contract address is configured', () => {
    // When pool contract is 0x00...00 (pre-audit unbroadcasted state), it safely returns null
    const unbroadcastedRoute = resolveArcNativeRoute('cirBTC', 'WETH')
    expect(unbroadcastedRoute).toBeNull()

    // Test route resolution with a deployed address mock
    const originalAddr = POOL_CONTRACTS.CIRBTC_WETH_POOL
    try {
      POOL_CONTRACTS.CIRBTC_WETH_POOL = '0x1234567890123456789012345678901234567890' as `0x${string}`
      const btcToWethRoute = resolveArcNativeRoute('cirBTC', 'WETH')
      expect(btcToWethRoute).not.toBeNull()
      expect(btcToWethRoute!.isStable).toBe(false)
      expect(btcToWethRoute!.decIn).toBe(8)
      expect(btcToWethRoute!.decOut).toBe(18)
      expect(btcToWethRoute!.feeBps).toBe(30n)

      const wethToBtcRoute = resolveArcNativeRoute('WETH', 'cirBTC')
      expect(wethToBtcRoute).not.toBeNull()
      expect(wethToBtcRoute!.isStable).toBe(false)
      expect(wethToBtcRoute!.decIn).toBe(18)
      expect(wethToBtcRoute!.decOut).toBe(8)
      expect(wethToBtcRoute!.feeBps).toBe(30n)
    } finally {
      POOL_CONTRACTS.CIRBTC_WETH_POOL = originalAddr
    }
  })

  it('initialises with 0 baseline volume for honest metrics reporting', () => {
    expect(POOL_TESTNET_BASE_VOLUME['cirbtc-weth-pool']).toBe(0)
  })

  it('computes minLpShares using Constant Product (x*y=k) for dual volatile bluechip pair', () => {
    // Mock pool state: 10 cirBTC (8 dec) / 200 WETH (18 dec) -> 1 BTC = 20 ETH.
    // Total LP: 1,000 LP (18 dec).
    const mockPoolAddress = '0x2222333344445555666677778888999900001111' as `0x${string}`
    const mockState = {
      [mockPoolAddress]: {
        reserveA: '10',
        reserveB: '200',
        totalLp: '1000',
      },
    }

    // Proportional deposit: 1.0 cirBTC (8 dec) + 20.0 WETH (18 dec)
    // Expected LP = (1.0 * 1,000) / 10 = 100 LP
    const amountA = parseUnits('1', 8)
    const amountB = parseUnits('20', 18)

    const minLp = computeMinLpShares(
      cirBtcWethPool!,
      mockPoolAddress,
      mockState,
      amountA,
      amountB,
      18,
      0.5 // 0.5% slippage -> 99.5% of 100 = 99.5 LP
    )

    const expected100Lp = parseUnits('100', 18)
    const expectedMinOut = (expected100Lp * 9950n) / 10000n
    expect(minLp).toBe(expectedMinOut)
  })

  it('computes initial zero-liquidity seed LP shares with geometric-mean normalization (1e5 scalar)', () => {
    // Initial deposit: 1 cirBTC (8 dec) * 20 WETH (18 dec)
    // Product in wei = 1e8 * 20e18 = 2e27
    // sqrt(2e27) = 44,721,359,549,995
    // initialLp = 44,721,359,549,995 * 1e5 = 4,472,135,954,999,500,000 wei (~4.472 LP)
    const result = estimateLpSharesForDeposit({
      poolId: 'cirbtc-weth-pool',
      amountA: 1,
      amountB: 20,
      reserveA: 0,
      reserveB: 0,
      totalLp: 0,
      allowInitialSeed: true,
    })

    expect(result).not.toBeNull()
    expect(result!.shares).toBeGreaterThan(0)
    expect(result!.totalLpAfter).toBeGreaterThanOrEqual(result!.shares)
    expect(result!.shares).toBeCloseTo(4.472, 2)
  })

  it('protects against unbalanced deposits by flagging excess donation', () => {
    // Pool ratio is 1 cirBTC per 20 WETH
    // User deposits 2 cirBTC with only 20 WETH (100% excess cirBTC)
    const balance = analyzeDualDepositBalance({
      poolId: 'cirbtc-weth-pool',
      amountA: 2,
      amountB: 20,
      reserveA: 10,
      reserveB: 200,
      totalLp: 1000,
    })

    expect(balance).not.toBeNull()
    expect(balance!.donationPct).toBeGreaterThan(0)
    // Optimal amount should cap cirBTC at 1.0 (the proportional counterpart to 20 WETH)
    expect(balance!.optimizedAmountA).toBeCloseTo(1, 4)
    expect(balance!.optimizedAmountB).toBeCloseTo(20, 4)
  })

  it('calculates swap outputs accurately using Constant Product formula with 30 bps fee', () => {
    // 10 cirBTC (8 dec) and 200 WETH (18 dec)
    const reserveIn = parseUnits('10', 8)
    const reserveOut = parseUnits('200', 18)
    const amountIn = parseUnits('1', 8) // swap 1 cirBTC for WETH

    const expectedOut = calculateConstantProductExpectedOut(
      amountIn,
      reserveIn,
      reserveOut,
      30n // 30 bps
    )

    // inAfterFee = 1 * (10000 - 30) / 10000 = 0.997 cirBTC
    // out = 200 * 0.997 / (10 + 0.997) = 199.4 / 10.997 ≈ 18.1322 WETH
    expect(expectedOut).toBeGreaterThan(0n)
    const outFormatted = parseFloat(parseUnits(expectedOut.toString(), 0).toString()) / 1e18
    expect(outFormatted).toBeCloseTo(18.132, 2)
  })
})

