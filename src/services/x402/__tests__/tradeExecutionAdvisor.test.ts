// src/services/x402/__tests__/tradeExecutionAdvisor.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSwapEstimate,
  mockResolveArcNativeRoute,
  mockGetLiveTokenPrices,
  mockEstimateArcGasCostUsdc,
  mockResilientReadContract,
} = vi.hoisted(() => ({
  mockGetSwapEstimate: vi.fn(),
  mockResolveArcNativeRoute: vi.fn(),
  mockGetLiveTokenPrices: vi.fn(),
  mockEstimateArcGasCostUsdc: vi.fn(),
  mockResilientReadContract: vi.fn(),
}))

vi.mock('../../swapService.js', () => ({
  getSwapEstimate: mockGetSwapEstimate,
  resolveArcNativeRoute: mockResolveArcNativeRoute,
}))

vi.mock('../../tokenPriceService.js', () => ({
  getLiveTokenPrices: mockGetLiveTokenPrices,
  normalizeTokenSymbol: (s: string) => s.trim().toUpperCase(),
}))

vi.mock('../../arcGasService.js', () => ({
  estimateArcGasCostUsdc: mockEstimateArcGasCostUsdc,
}))

vi.mock('../../rpc/index.js', () => ({
  getArcPublicClient: () => ({}),
  resilientReadContract: mockResilientReadContract,
}))

import {
  analyzeTradeExecution,
  computePoolAmmPriceImpactPct,
  resolveTradeExecutionVerdict,
  resolveTradePoolMeta,
} from '../tradeExecutionAdvisor'

describe('tradeExecutionAdvisor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEstimateArcGasCostUsdc.mockResolvedValue(0.0004)
    mockGetLiveTokenPrices.mockResolvedValue({
      USDC: 1,
      EURC: 1.08,
      WETH: 2800,
      CIRBTC: 90000,
    })
  })

  it('computes pure constant-product AMM price impact accurately', () => {
    const meta = resolveTradePoolMeta('USDC', 'WETH')
    expect(meta).not.toBeNull()
    const impact = computePoolAmmPriceImpactPct({
      meta: meta!,
      fromToken: 'USDC',
      amountIn: 100,
      reserveA: 10_000_000_000n, // 10,000 USDC (6 dec)
      reserveB: 3_570_000_000_000_000_000n, // 3.57 WETH (18 dec)
    })
    // dx_net = 99.7, x = 10000 -> 99.7 / 10099.7 = 0.987%
    expect(impact).not.toBeNull()
    expect(impact!).toBeGreaterThan(0.95)
    expect(impact!).toBeLessThan(1.02)
  })

  it('computes low StableSwap curve impact for balanced EURC/USDC reserves', () => {
    const meta = resolveTradePoolMeta('USDC', 'EURC')
    expect(meta).not.toBeNull()
    const impact = computePoolAmmPriceImpactPct({
      meta: meta!,
      fromToken: 'USDC',
      amountIn: 500,
      reserveA: 50_000_000_000n, // 50,000 USDC
      reserveB: 50_000_000_000n, // 50,000 EURC
    })
    expect(impact).not.toBeNull()
    expect(impact!).toBeLessThan(0.1)
  })

  it('rejects identical tokens cleanly without charging', async () => {
    const res = await analyzeTradeExecution({
      fromToken: 'USDC',
      toToken: 'USDC',
      amount: 10,
    })
    expect(res.data.status).toBe('UNAVAILABLE')
    expect(res.actionablePayload).toBeUndefined()
  })

  it('selects 2-hop route when gas-adjusted output beats direct and exposes twoHopSteps + bottleneck depth', async () => {
    const EURC_WETH = '0x1111111111111111111111111111111111111111'
    const EURC_USDC = '0x2222222222222222222222222222222222222222'
    const USDC_WETH = '0x3333333333333333333333333333333333333333'

    mockResolveArcNativeRoute.mockImplementation((a: string, b: string) => {
      const k = [a.toUpperCase(), b.toUpperCase()].sort().join('/')
      if (k === 'EURC/WETH') return { poolAddress: EURC_WETH }
      if (k === 'EURC/USDC') return { poolAddress: EURC_USDC }
      if (k === 'USDC/WETH') return { poolAddress: USDC_WETH }
      return null
    })

    // Direct EURC -> WETH gives 0.1930 WETH; 2-hop EURC -> USDC -> WETH gives 0.1948 WETH
    mockGetSwapEstimate.mockImplementation(async ({ tokenIn, tokenOut }: any) => {
      if (tokenIn === 'EURC' && tokenOut === 'WETH') {
        return { estimatedOutput: '0.1930', rate: String(0.193 / 500) }
      }
      if (tokenIn === 'EURC' && tokenOut === 'USDC') {
        return { estimatedOutput: '542.10', rate: String(542.1 / 500) }
      }
      if (tokenIn === 'USDC' && tokenOut === 'WETH') {
        return { estimatedOutput: '0.1948', rate: String(0.1948 / 542.1) }
      }
      throw new Error('no route')
    })

    // Reserves: direct EURC/WETH shallow (5,000 EURC); EURC/USDC deep (50,000); USDC/WETH bottleneck (20,000 USDC)
    mockResilientReadContract.mockImplementation(async (_client: any, args: any) => {
      if (args.address === EURC_WETH) {
        return args.functionName === 'reserveA' ? 5_000_000_000n : 2_000_000_000_000_000_000n
      }
      if (args.address === EURC_USDC) {
        return 50_000_000_000n
      }
      if (args.address === USDC_WETH) {
        return args.functionName === 'reserveA' ? 20_000_000_000n : 7_000_000_000_000_000_000n
      }
      return 0n
    })

    const res = await analyzeTradeExecution({
      fromToken: 'EURC',
      toToken: 'WETH',
      amount: 500,
      slippageTolerancePct: 0.5,
    })

    expect(res.data.status).toBe('ROUTE_OPTIMIZED')
    expect(res.data.recommendedHops).toBe(2)
    expect(res.data.recommendedPath).toBe('EURC → USDC → WETH')
    expect(res.data.twoHopOutputGainPct).toBeGreaterThan(0.5)
    expect(res.data.twoHopSteps).toEqual({
      step1From: 'EURC',
      step1To: 'USDC',
      step1AmountIn: 500,
      step1EstimatedOut: 542.1,
      step2From: 'USDC',
      step2To: 'WETH',
      step2AmountIn: 542.1,
      step2EstimatedOut: 0.1948,
    })
    // Bottleneck pool is USDC/WETH ($20,000), NOT direct EURC/WETH ($5,400)
    expect(res.data.poolReserveUsdc).toBe(20000)
    expect(res.data.bottleneckPool).toBe(USDC_WETH)
    expect(res.actionablePayload?.details.step).toBe(1)
    expect(res.actionablePayload?.details.nextStep?.toToken).toBe('WETH')
  })

  it('continues returning on-chain ROUTE_OPTIMIZED even when external oracle prices are unavailable', async () => {
    const USDC_WETH = '0x3333333333333333333333333333333333333333'
    mockGetLiveTokenPrices.mockRejectedValue(new Error('oracle down'))
    mockResolveArcNativeRoute.mockImplementation((a: string, b: string) => {
      const k = [a.toUpperCase(), b.toUpperCase()].sort().join('/')
      return k === 'USDC/WETH' ? { poolAddress: USDC_WETH } : null
    })
    mockGetSwapEstimate.mockResolvedValue({
      estimatedOutput: '0.0035',
      rate: '0.00035',
    })
    mockResilientReadContract.mockImplementation(async (_client: any, args: any) =>
      args.functionName === 'reserveA' ? 10_000_000_000n : 3_500_000_000_000_000_000n
    )

    const res = await analyzeTradeExecution({
      fromToken: 'USDC',
      toToken: 'WETH',
      amount: 10,
    })

    expect(res.data.status).toBe('ROUTE_OPTIMIZED')
    expect(res.data.signedPriceImpactPct).toBeNull()
    expect(res.data.ammPriceImpactPct).not.toBeNull()
    expect(res.data.riskRegister.some((r: any) => r.id === 'ORACLE_BENCHMARK_UNAVAILABLE')).toBe(true)
    expect(res.actionablePayload?.type).toBe('swap')
  })

  it('classifies trades with calibrated 1.0–5.0 star ratings and verdicts without prohibitive language', () => {
    // Clean, low-depth, favorable-oracle swap -> 5.0 stars
    const pristine = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 0.15,
      signedPriceImpactPct: -0.1,
      tradeReserveExposurePct: 0.8,
      recommendedBatchCount: 1,
    })
    expect(pristine).toMatchObject({
      code: 'EXECUTE',
      label: 'Optimal Path Ready',
      tone: 'success',
      rating: 5,
      maxRating: 5,
    })

    // Healthy swap with moderate 2%–5% reserve depth -> 4.5 stars
    const optimal = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 0.34,
      signedPriceImpactPct: -0.12,
      tradeReserveExposurePct: 3.41,
      recommendedBatchCount: 1,
    })
    expect(optimal).toMatchObject({
      code: 'EXECUTE',
      label: 'Optimal Path Ready',
      tone: 'success',
      rating: 4.5,
      maxRating: 5,
    })

    // Unverified oracle (feed down) caps rating at 4.5 stars even with clean on-chain AMM
    const noOracle = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 0.2,
      signedPriceImpactPct: null,
      tradeReserveExposurePct: 0.9,
      recommendedBatchCount: 1,
    })
    expect(noOracle).toMatchObject({
      code: 'EXECUTE',
      rating: 4.5,
      ratingBreakdown: { oracleVerificationPenalty: 0.5 },
    })

    // Split path (14.2% reserve, 6 batches, 2.31% Batch-1 AMM) -> 3.0 stars
    const split = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 12.4,
      signedPriceImpactPct: 12.1,
      tradeReserveExposurePct: 14.2,
      recommendedBatchCount: 6,
      perBatchAmmPriceImpactPct: 2.31,
      exceedsCappedBatchDepth: false,
    })
    expect(split).toMatchObject({
      code: 'CAUTION_SPLIT',
      label: 'Split Path Recommended',
      tone: 'cancelled',
      rating: 3,
      maxRating: 5,
    })
    expect(split.reason.toLowerCase()).not.toContain('do not')

    // Exceeds 10-batch pool depth cap -> 1.0 star
    const capped = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 25.0,
      signedPriceImpactPct: 26.0,
      tradeReserveExposurePct: 80.0,
      recommendedBatchCount: 10,
      perBatchAmmPriceImpactPct: 7.4,
      exceedsCappedBatchDepth: true,
    })
    expect(capped).toMatchObject({
      code: 'DO_NOT_EXECUTE',
      label: 'Reduce Size Recommended',
      tone: 'error',
      rating: 1,
      maxRating: 5,
    })
    expect(capped.label.toLowerCase()).not.toContain('do not execute')

    // Pool spot mispriced 5%–10% vs oracle on a tiny swap -> Rate Spread Advisory (3.0 stars — not strongly recommended)
    const spread = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 0.2,
      signedPriceImpactPct: 6.4,
      tradeReserveExposurePct: 0.5,
      recommendedBatchCount: 1,
    })
    expect(spread).toMatchObject({
      code: 'DO_NOT_EXECUTE',
      label: 'Rate Spread Advisory',
      tone: 'error',
      rating: 3,
      maxRating: 5,
    })

    // Severe >=10% oracle spread drops further to 2.0 stars
    const severeSpread = resolveTradeExecutionVerdict({
      ammPriceImpactPct: 0.2,
      signedPriceImpactPct: 11.5,
      tradeReserveExposurePct: 0.5,
      recommendedBatchCount: 1,
    })
    expect(severeSpread).toMatchObject({
      code: 'DO_NOT_EXECUTE',
      label: 'Rate Spread Advisory',
      rating: 2,
      maxRating: 5,
    })
  })
})
