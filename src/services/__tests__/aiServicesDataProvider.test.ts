// src/services/__tests__/aiServicesDataProvider.test.ts
// Proof for the paid native AI services: answers are built from real reads, an unreadable
// input is answered with an explicit UNAVAILABLE, and no invented figure, score, calldata,
// liquidation or settlement value can reach a caller.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVE_GATEWAY_CONTRACTS } from '../../config/gatewayConfig'
import { gatewayIndexerManifest } from '../../config/x402/manifests/gatewayIndexer'
import { arbitrageSentinelManifest } from '../../config/x402/manifests/arbitrageSentinel'
import { slippageOptimizerManifest } from '../../config/x402/manifests/slippageOptimizer'
import { gatewayRouteScoutManifest } from '../../config/x402/manifests/gatewayRouteScout'
import { vaultAnalyticsManifest } from '../../config/x402/manifests/vaultAnalytics'
import { portfolioRiskManifest } from '../../config/x402/manifests/portfolioRisk'
import { vaultYieldReportManifest } from '../../config/x402/manifests/vaultYieldReport'
import { ARC_TESTNET_TOKENS } from '../../config/arcChain'
import { POOL_CONTRACTS } from '../../config/poolsConfig'
import { generateLiveServiceData } from '../aiServicesDataProvider'
import { getSwapEstimate } from '../swapService'
import { hasAcceptedX402Payment, hasVerifiedX402Settlement, isServiceDataAvailable, isSuccessfulX402ServiceResult } from '../x402Client'
import { isX402ServiceResultAvailable } from '../../../api/x402'
import type { X402ExecutionReceipt } from '../../types/x402'
import { invalidateGatewayFlowCache } from '../gatewayFlowIndexer'

const state = vi.hoisted(() => ({
  client: null as any,
  prices: {} as Record<string, number>,
  reserves: { reserveA: 0n, reserveB: 0n } as { reserveA: bigint; reserveB: bigint } | null,
  vaultAssets: 0n as bigint | null,
  vaultSupply: 0n as bigint | null,
  vaultShares: 0n as bigint | null,
  vaultPrincipal: 0n as bigint | null,
  vaultPending: 0n as bigint | null,
  vaultRedeem: 0n as bigint | null,
  balances: {} as Record<string, bigint>,
  nativeBalances: {} as Record<string, bigint>,
  balanceFails: false,
  cctpQuote: null as {
    finalityThreshold: number
    minimumFeeBps: number
    forwardFeeSubunits: bigint
  } | null,
  gatewayBalances: null as { token: string; balances: Array<{ domain: number; depositor: string; balance: string }> } | null,
}))

beforeEach(() => {
  state.nativeBalances = {}
  state.balanceFails = false
})

vi.mock('../rpc', () => ({
  getArcPublicClient: () => state.client,
  getResilientPublicClient: (chainKey?: string) => ({ ...state.client, chainKey }),
  resilientGetBalance: vi.fn(async (client: any) => {
    if (state.balanceFails) throw new Error('arc rpc unavailable')
    const key = client?.chainKey || ''
    return state.nativeBalances[key] ?? state.nativeBalances['default'] ?? 0n
  }),
  resilientReadContract: vi.fn(async (_client: unknown, params: any) => {
    if (params.functionName === 'reserveA' || params.functionName === 'reserveB') {
      if (state.reserves === null) throw new Error('arc rpc unavailable')
      return params.functionName === 'reserveA' ? state.reserves.reserveA : state.reserves.reserveB
    }
    if (params.functionName === 'totalAssets') return state.vaultAssets
    if (params.functionName === 'totalSupply') return state.vaultSupply
    if (params.functionName === 'balanceOf') {
      if (params.address === POOL_CONTRACTS.YIELD_VAULT) return state.vaultShares
      if (state.balanceFails) throw new Error('arc rpc unavailable')
      return state.balances[String(params.address).toLowerCase()] ?? 0n
    }
    if (params.functionName === 'principalAssets') return state.vaultPrincipal
    if (params.functionName === 'pendingYield') return state.vaultPending
    if (params.functionName === 'previewRedeem') return state.vaultRedeem
    return 0n
  }),
}))

vi.mock('../bridgeUcwService', () => ({
  fetchCctpForwardQuote: vi.fn(async () => state.cctpQuote),
}))

vi.mock('../gatewayService', () => ({
  getGatewayBalances: vi.fn(async () => {
    if (!state.gatewayBalances) throw new Error('gateway api unavailable')
    return state.gatewayBalances
  }),
}))

vi.mock('../tokenPriceService', () => ({
  getLiveTokenPrices: vi.fn(async () => state.prices),
  normalizeTokenSymbol: (symbol: string) => symbol.toUpperCase(),
}))

vi.mock('../swapService', () => ({
  getSwapEstimate: vi.fn(),
  // The depth read must resolve the pool the quote came from, so only pairs with a
  // StableSwap pool resolve here; anything else returns null and no depth figure.
  resolveArcNativeRoute: vi.fn((tokenIn: string, tokenOut: string) => {
    const pair = [String(tokenIn).toUpperCase(), String(tokenOut).toUpperCase()].sort().join('/')
    if (pair === 'EURC/USDC') {
      return { poolAddress: '0x00000000000000000000000000000000000000d1', isStable: true }
    }
    return null
  }),
}))

const MINTER = String(ACTIVE_GATEWAY_CONTRACTS.gatewayMinter).toLowerCase()
const WALLET = String(ACTIVE_GATEWAY_CONTRACTS.gatewayWallet).toLowerCase()

const usdc = (amount: number) => BigInt(Math.round(amount * 1e6))

// Every payload carries `timestamp: Date.now()`, and a 13-digit epoch can contain a forbidden
// figure by accident (a "2500" inside 17...2500...). Structural checks must not depend on the
// clock, so the timestamp is dropped before the payload is scanned for invented numbers.
function withoutTimestamp(data: Record<string, any>): Record<string, any> {
  const { timestamp: _timestamp, ...rest } = data
  return rest
}

interface FakeFlow {
  inflow?: Array<{ sourceDomain: number; value: bigint }>
  outflow?: Array<{ value: bigint }>
  inflowFails?: boolean
}

function makeClient(flow: FakeFlow = {}) {
  const headBlock = 2_000_000
  const headTimestamp = 1_800_000_000

  return {
    getBlockNumber: vi.fn(async () => BigInt(headBlock)),
    getBlock: vi.fn(async ({ blockNumber }: any) => ({
      timestamp: BigInt(headTimestamp - (headBlock - Number(blockNumber))),
    })),
    getGasPrice: vi.fn(async () => 20_000_000_000n), // 20 Gwei, the Arc protocol floor
    getLogs: vi.fn(async (params: any) => {
      const address = String(params.address).toLowerCase()
      if (address === MINTER) {
        if (flow.inflowFails) throw new Error('arc rpc unavailable')
        return (flow.inflow ?? []).map((log) => ({
          args: {
            token: params.args.token,
            recipient: '0x00000000000000000000000000000000000000aa',
            transferSpecHash: '0x' + '11'.repeat(32),
            sourceDomain: log.sourceDomain,
            sourceDepositor: '0x' + '22'.repeat(32),
            sourceSigner: '0x' + '33'.repeat(32),
            value: log.value,
          },
        }))
      }
      if (address === WALLET) {
        return (flow.outflow ?? []).map((log) => ({
          args: {
            token: params.args.token,
            depositor: '0x00000000000000000000000000000000000000bb',
            transferSpecHash: '0x' + '44'.repeat(32),
            destinationDomain: 0,
            destinationRecipient: '0x' + '55'.repeat(32),
            signer: '0x00000000000000000000000000000000000000cc',
            value: log.value,
            fee: 0n,
            fromAvailable: log.value,
            fromWithdrawing: 0n,
          },
        }))
      }
      return []
    }),
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function stubLlmNarrative(narrative = {
  headline: 'Stablecoin-heavy portfolio with one dominant holding',
  observations: ['Most measured value sits in stablecoins.', 'One holding dominates the total.'],
  risks: ['A single asset drives most of the exposure.'],
}) {
  vi.stubEnv('OPENROUTER_API_KEY', 'sk-testserverkey0123456789')
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(narrative) } }],
    usage: { prompt_tokens: 140, completion_tokens: 55 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  invalidateGatewayFlowCache()
  state.client = makeClient()
  state.prices = {}
  state.reserves = { reserveA: 0n, reserveB: 0n }
  state.vaultAssets = 0n
  state.vaultSupply = 0n
  state.vaultShares = 0n
  state.vaultPrincipal = 0n
  state.vaultPending = 0n
  state.vaultRedeem = 0n
  state.balances = {}
  state.balanceFails = false
  state.cctpQuote = null
  state.gatewayBalances = null
  vi.mocked(getSwapEstimate).mockReset()
})

describe('Ask Arco x402 success gates', () => {
  const result = (overrides: Partial<X402ExecutionReceipt> = {}): X402ExecutionReceipt => ({
    statusCode: 503,
    success: false,
    executionTimeMs: 0,
    costUsdc: 0,
    ...overrides,
  })

  it('distinguishes Gateway acceptance from final settlement', () => {
    expect(hasVerifiedX402Settlement(result())).toBe(false)
    expect(hasVerifiedX402Settlement(result({ success: true, costUsdc: 0.005 }))).toBe(false)
    expect(hasVerifiedX402Settlement(result({
      success: true,
      costUsdc: 0.005,
      payment: { status: 'authorized' } as any,
    }))).toBe(false)
    expect(hasVerifiedX402Settlement(result({
      success: true,
      costUsdc: 0.005,
      payment: {
        status: 'settled',
        settlementRef: '0x' + 'a'.repeat(64),
        amountUsdc: 0.005,
      } as any,
    }))).toBe(true)
    const pending = result({
      success: true,
      costUsdc: 0.005,
      payment: { status: 'settlement_pending', settlementRef: 'gateway-ref-123', amountUsdc: 0.005 } as any,
    })
    expect(hasAcceptedX402Payment(pending)).toBe(true)
    expect(hasVerifiedX402Settlement(pending)).toBe(false)
  })

  it('rejects missing service data and explicit UNAVAILABLE results', () => {
    expect(isServiceDataAvailable(result())).toBe(false)
    expect(isServiceDataAvailable(result({ data: { status: 'UNAVAILABLE' } }))).toBe(false)
    expect(isServiceDataAvailable(result({ data: { status: 'OPPORTUNITY_DETECTED' } }))).toBe(true)
    expect(isServiceDataAvailable(result({ data: {} }))).toBe(false)
    expect(isX402ServiceResultAvailable({ status: 'UNAVAILABLE' })).toBe(false)
    expect(isX402ServiceResultAvailable({ status: 'LIVE' })).toBe(true)
  })

  it('only considers an x402 response successful when both settlement and data are valid', () => {
    const paid = result({
      success: true,
      costUsdc: 0.005,
      payment: { status: 'settled', settlementRef: '0x' + 'a'.repeat(64), amountUsdc: 0.005 } as any,
      data: { status: 'OPPORTUNITY_DETECTED' },
    })
    expect(isSuccessfulX402ServiceResult(paid)).toBe(true)
    expect(isSuccessfulX402ServiceResult({ ...paid, data: { status: 'UNAVAILABLE' } })).toBe(false)
    expect(isSuccessfulX402ServiceResult({ ...paid, payment: { status: 'authorized' } as any })).toBe(false)
    const acceptedPending = {
      ...paid,
      payment: { status: 'settlement_pending', settlementRef: 'circle-reference', amountUsdc: 0.005 } as any,
    }
    expect(isSuccessfulX402ServiceResult(acceptedPending)).toBe(true)
    expect(hasAcceptedX402Payment(acceptedPending)).toBe(true)
    expect(hasVerifiedX402Settlement(acceptedPending)).toBe(false)
  })
})

describe('generateLiveServiceData — Cross-Chain Gateway Flow Indexer', () => {
  it('answers from the real GatewayMinter logs read on Arc L1', async () => {
    state.client = makeClient({
      inflow: [
        { sourceDomain: 0, value: usdc(2_450) },
        { sourceDomain: 6, value: usdc(1_000) },
      ],
      outflow: [{ value: usdc(450) }],
    })

    const { data, actionablePayload } = await generateLiveServiceData(gatewayIndexerManifest, {
      timeWindow: '1h',
    })

    const minterCall = state.client.getLogs.mock.calls.find(
      (call: any[]) => String(call[0].address).toLowerCase() === MINTER
    )
    expect(minterCall).toBeTruthy()
    expect(minterCall![0].fromBlock).toBeLessThan(minterCall![0].toBlock)

    expect(data.status).toBe('LIVE')
    expect(data.grossInflowUsdc).toBe(3_450)
    expect(data.netUsdcInflowUsdc).toBe(3_000)
    expect(data.source).toContain('AttestationUsed')
    expect(data.topSourceChains).toEqual([
      { chain: 'Ethereum Sepolia', domain: 0, inflowUsdc: 2_450, sharePct: 71.01 },
      { chain: 'Base Sepolia', domain: 6, inflowUsdc: 1_000, sharePct: 28.99 },
    ])
    expect(actionablePayload).toBeUndefined()
    expect(data.report.riskRegister.map((e: any) => e.id)).toContain('GATEWAY_NET_INFLOW')

    const serialized = JSON.stringify(withoutTimestamp(data))
    expect(serialized).not.toMatch(/142500|4820500|STRONG_BULLISH|FEED_ACTIVE/)
  })

  it('reports UNAVAILABLE with no numbers when the on-chain read fails', async () => {
    state.client = makeClient({ inflowFails: true })

    const { data, actionablePayload } = await generateLiveServiceData(gatewayIndexerManifest, {
      timeWindow: '1h',
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.grossInflowUsdc).toBeNull()
    expect(data.grossOutflowUsdc).toBeNull()
    expect(data.netUsdcInflowUsdc).toBeNull()
    expect(data.transferCount).toBeNull()
    expect(data.whaleTransferCount).toBeNull()
    expect(data.topSourceChains).toBeNull()
    expect(data.flowDirection).toBeNull()
    expect(data.window).toBeNull()
    expect(data.error).toContain('arc rpc unavailable')
    expect(actionablePayload).toBeUndefined()
    expect(data.report.riskRegister.map((e: any) => e.id)).toContain('GATEWAY_FLOW_READ_FAILED')
    expect(JSON.stringify(withoutTimestamp(data))).not.toMatch(/142500|4820500|STRONG_BULLISH|FEED_ACTIVE/)
  })

  it('reads the window the caller paid for and falls back to 1h for an unknown window', async () => {
    const windows: Array<[any, string, number]> = [
      [{ timeWindow: '24h' }, '24h', 86_400],
      [{ timeWindow: '7d' }, '7d', 604_800],
      [{ timeWindow: 'nonsense' }, '1h', 3_600],
      [{}, '1h', 3_600],
    ]

    for (const [payload, expectedWindow, expectedSeconds] of windows) {
      invalidateGatewayFlowCache()
      state.client = makeClient({ inflow: [], outflow: [] })
      const { data } = await generateLiveServiceData(gatewayIndexerManifest, payload)
      expect(data.timeWindow).toBe(expectedWindow)
      expect(data.requestedWindowSeconds).toBe(expectedSeconds)
    }
  })
})

describe('generateLiveServiceData — arbitrage sentinel', () => {
  it('derives the spread from the real pool reserves and oracle prices only', async () => {
    state.prices = { USDC: 1, EURC: 1.1 }
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }

    const { data, actionablePayload } = await generateLiveServiceData(arbitrageSentinelManifest, {
      pair: 'USDC/EURC',
      tradeSizeUsdc: 25_000,
    })

    // |1.1 - 1.1111| / 1.1111 = 1%
    expect(data.status).toBe('OPPORTUNITY_DETECTED')
    expect(data.bestRoute.grossSpreadPct).toBeCloseTo(1, 3)
    expect(data.bestRoute.buyPriceUsdc).toBe(1.1)
    expect(data.bestRoute.sellPriceUsdc).toBe(1.1111)
    expect(data.onChainReserves).toEqual({ pool: expect.any(String), reserveUSDC: 1_000_000, reserveEURC: 900_000 })
    expect(actionablePayload).toBeUndefined()
    expect(data.riskRegister.map((e: any) => e.id)).toContain('ARBITRAGE_OPPORTUNITY')

    expect(data.bestRoute).not.toHaveProperty('confidenceScore')
    expect(data.bestRoute).not.toHaveProperty('executionCalldataHex')
    expect(data).not.toHaveProperty('mempoolRisk')
    expect(data).not.toHaveProperty('secondaryOpportunities')
    expect(JSON.stringify(withoutTimestamp(data))).not.toMatch(/0\.994|LOW_MEV_THREAT|0x522faf9a/)
  })

  it('prices non-USDC cross-pairs (EURC/WETH) accurately using oraclePriceB / oraclePriceA', async () => {
    // EURC = $1.10, WETH = $3,300 -> oracleRate = 3300 / 1.10 = 3000 EURC per WETH
    // Pool has 330,000 EURC and 100 WETH -> poolRate = 3300 EURC per WETH
    // Spread = |3000 - 3300| / 3300 = 9.091%
    state.prices = { EURC: 1.1, WETH: 3300 }
    state.reserves = { reserveA: usdc(330_000), reserveB: 100n * 10n ** 18n }

    const { data } = await generateLiveServiceData(arbitrageSentinelManifest, {
      pair: 'EURC/WETH',
      tradeSizeUsdc: 25_000,
    })

    expect(data.status).toBe('OPPORTUNITY_DETECTED')
    expect(data.pair).toBe('EURC/WETH')
    expect(data.bestRoute.grossSpreadPct).toBeCloseTo(9.091, 2)
    expect(data.scannedPools).toHaveLength(1)
    expect(data.scannedPools[0].quoteUnit).toBe('EURC per WETH')
    expect(data.riskRegister.map((e: any) => e.id)).toContain('ARBITRAGE_OPPORTUNITY')
  })

  it('scans all 6 Arc pools in parallel when pair is ALL_POOLS and ranks by net spread', async () => {
    state.prices = { USDC: 1, EURC: 1.1, WETH: 3000, cirBTC: 90000 }
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }

    const { data } = await generateLiveServiceData(arbitrageSentinelManifest, {
      pair: 'ALL_POOLS',
      tradeSizeUsdc: 25_000,
      minNetProfitPct: 0.35,
    })

    expect(data.pair).toBe('ALL_POOLS')
    expect(data.poolsScannedCount).toBe(6)
    expect(data.poolsMeasuredCount).toBe(6)
    expect(data.scannedPools).toHaveLength(6)
    // Sorted descending by netProfitPct
    for (let i = 1; i < data.scannedPools.length; i++) {
      expect(data.scannedPools[i - 1].netProfitPct).toBeGreaterThanOrEqual(data.scannedPools[i].netProfitPct)
    }
    expect(data.bestRoute.pair).toBe(data.scannedPools[0].pair)
  })

  it('refuses an unknown pair that has no deployed Arc pool', async () => {
    state.prices = { EURC: 1.1, DAI: 1.0 }
    state.reserves = { reserveA: usdc(500_000), reserveB: usdc(500_000) }

    const { data } = await generateLiveServiceData(arbitrageSentinelManifest, {
      pair: 'EURC/DAI',
      tradeSizeUsdc: 25_000,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.unavailable).toContain('active Arc L1 DEX pool for requested pair')
    expect(data.bestRoute).toBeUndefined()
    expect(data.riskRegister.map((e: any) => e.id)).toContain('ARBITRAGE_READ_UNAVAILABLE')
  })

  it('returns UNAVAILABLE with no spread when the reserves cannot be read', async () => {
    state.prices = { USDC: 1, EURC: 1.1 }
    state.reserves = null

    const { data, actionablePayload } = await generateLiveServiceData(arbitrageSentinelManifest, {
      pair: 'USDC/EURC',
      tradeSizeUsdc: 25_000,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.unavailable).toContain('on-chain StableSwap pool reserves')
    expect(data.onChainReserves).toBeNull()
    expect(data.bestRoute).toBeUndefined()
    expect(actionablePayload).toBeUndefined()
    expect(data.riskRegister.map((e: any) => e.id)).toContain('ARBITRAGE_READ_UNAVAILABLE')
    expect(JSON.stringify(withoutTimestamp(data))).not.toMatch(/confidenceScore|netProfitUsdc|executionCalldataHex/)
  })

  it('returns UNAVAILABLE when the oracle has no quote for the pair', async () => {
    state.prices = {} // no external quotes at all
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }

    const { data } = await generateLiveServiceData(arbitrageSentinelManifest, {
      pair: 'USDC/EURC',
      tradeSizeUsdc: 25_000,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.unavailable).toContain('external oracle price for the pair')
    expect(data.liveOraclePrices).toEqual({ USDC: null, EURC: null })
    expect(JSON.stringify(withoutTimestamp(data))).not.toMatch(/1\.08|2500|78500/)
    // The clock must not be able to poison that scan: an epoch containing "2500" still passes.
    expect(
      JSON.stringify(withoutTimestamp({ ...data, timestamp: 1792250025000 }))
    ).not.toMatch(/1\.08|2500|78500/)
  })
})

describe('generateLiveServiceData — no invented estimates or risk figures', () => {
  it('refuses to quote a slippage route when the live swap quote fails', async () => {
    vi.mocked(getSwapEstimate).mockRejectedValue(new Error('no route'))

    const { data, actionablePayload } = await generateLiveServiceData(slippageOptimizerManifest, {
      amount: 50_000,
      fromToken: 'USDC',
      toToken: 'EURC',
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.expectedOutput).toBeUndefined()
    expect(data).not.toHaveProperty('savedVsSinglePoolUsdc')
    expect(data).not.toHaveProperty('splitExecutionDistribution')
    expect(data).not.toHaveProperty('settlementTimeEstimateMs')
    expect(actionablePayload).toBeUndefined()
    expect(data.riskRegister?.[0]?.id).toBe('SLIPPAGE_QUOTE_UNAVAILABLE')
    expect(JSON.stringify(withoutTimestamp(data))).not.toMatch(/0\.924|0\.042|243_000|0\.0065/)
  })

  it('reports the depth of the pool it quoted, not the StableSwap pool for every pair', async () => {
    state.prices = { USDC: 1, EURC: 1.1 }
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }
    vi.mocked(getSwapEstimate).mockResolvedValue({
      estimatedOutput: '909090.909091',
      rate: '0.909091',
      stopLimit: '900000',
      fees: [],
    } as any)

    const { data } = await generateLiveServiceData(slippageOptimizerManifest, {
      fromToken: 'USDC',
      toToken: 'EURC',
      amount: 50_000,
    })

    expect(data.status).toBe('ROUTE_OPTIMIZED')
    expect(data.flashReserveDepthUsdc).toBe(1_000_000)
    expect(data.depthPool).toBe('0x00000000000000000000000000000000000000d1')
  })

  it('reports no depth when the quoted pair has no resolvable pool', async () => {
    state.prices = { USDC: 1, WETH: 3000 }
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }
    vi.mocked(getSwapEstimate).mockResolvedValue({
      estimatedOutput: '16.666667',
      rate: '0.000333',
      stopLimit: '16.5',
      fees: [],
    } as any)

    const { data } = await generateLiveServiceData(slippageOptimizerManifest, {
      fromToken: 'USDC',
      toToken: 'WETH',
      amount: 50_000,
    })

    expect(data.status).toBe('ROUTE_OPTIMIZED')
    expect(data.flashReserveDepthUsdc).toBeNull()
    expect(data.depthPool).toBeNull()
  })

  it('measures reserve/sandwich exposure and recommends batch splitting when trade exceeds 5% of pool reserve', async () => {
    state.prices = { USDC: 1, EURC: 1.1 }
    // Pool holds 1,000,000 USDC; trade is 100,000 USDC = 10% of reserve (> 5% threshold -> 4 batches)
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }
    vi.mocked(getSwapEstimate).mockResolvedValue({
      estimatedOutput: '90000',
      rate: '0.9',
      stopLimit: '89500',
      fees: [],
    } as any)

    const { data, actionablePayload } = await generateLiveServiceData(slippageOptimizerManifest, {
      fromToken: 'USDC',
      toToken: 'EURC',
      amount: 100_000,
      slippageTolerancePct: 0.4,
    })

    expect(data.status).toBe('ROUTE_OPTIMIZED')
    expect(data.tradeReserveExposurePct).toBe(10)
    expect(data.sandwichRiskLevel).toBe('HIGH')
    expect(data.executionSizing.recommendedBatchCount).toBe(4)
    expect(data.executionSizing.perBatchInputAmount).toBe(25_000)
    expect(data.executionSizing.suggestedMaxSlippagePct).toBe(0.4)
    expect(data.executionSizing.advisoryOnly).toBe(true)
    expect(data.riskRegister.map((e: any) => e.id)).toContain('HIGH_RESERVE_SANDWICH_EXPOSURE')
    expect(actionablePayload?.type).toBe('swap')
    expect(actionablePayload?.details.amountIn).toBe(100_000)
  })

  it('compares direct vs 2-hop routes and selects the route with higher real output', async () => {
    const { resolveArcNativeRoute } = await import('../swapService')
    vi.mocked(resolveArcNativeRoute).mockImplementation((a: string, b: string) => {
      const key = [a.toUpperCase(), b.toUpperCase()].sort().join('/')
      const pools: Record<string, string> = {
        'EURC/WETH': '0x00000000000000000000000000000000000000e1',
        'EURC/USDC': '0x00000000000000000000000000000000000000d1',
        'USDC/WETH': '0x00000000000000000000000000000000000000f1',
      }
      return pools[key] ? ({ poolAddress: pools[key] } as any) : null
    })
    state.prices = { USDC: 1, EURC: 1.1, WETH: 3000 }
    state.reserves = { reserveA: usdc(1_000_000), reserveB: 500n * 10n ** 18n }

    vi.mocked(getSwapEstimate).mockImplementation(async (params: any) => {
      const pair = `${params.tokenIn.toUpperCase()}->${params.tokenOut.toUpperCase()}`
      if (pair === 'EURC->WETH') return { estimatedOutput: '10.0', rate: '0.000333', stopLimit: '9.9', fees: [] } as any
      if (pair === 'EURC->USDC') return { estimatedOutput: '33000', rate: '1.1', stopLimit: '32800', fees: [] } as any
      if (pair === 'USDC->WETH') return { estimatedOutput: '11.0', rate: '0.000333', stopLimit: '10.9', fees: [] } as any
      throw new Error('no route')
    })

    const { data } = await generateLiveServiceData(slippageOptimizerManifest, {
      fromToken: 'EURC',
      toToken: 'WETH',
      amount: 30_000,
    })

    expect(data.status).toBe('ROUTE_OPTIMIZED')
    expect(data.recommendedHops).toBe(2)
    expect(data.recommendedPath).toBe('EURC → USDC → WETH')
    expect(data.twoHopOutputGainPct).toBeCloseTo(10, 2)
    expect(data.routeComparison).toHaveLength(2)
    expect(data.routeComparison[0].recommended).toBe(true)
    expect(data.riskRegister.map((e: any) => e.id)).toContain('TWO_HOP_ROUTE_ADVANTAGE')
  })

  it('refuses identical source and destination tokens', async () => {
    const { data, actionablePayload } = await generateLiveServiceData(slippageOptimizerManifest, {
      fromToken: 'USDC',
      toToken: 'USDC',
      amount: 1000,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(actionablePayload).toBeUndefined()
    expect(data.riskRegister[0].id).toBe('INVALID_TRADE_PARAMS')
  })
})

describe('generateLiveServiceData — gateway fee & route scout', () => {
  it('prices both rails from their real sources and recommends the cheaper one', async () => {
    state.cctpQuote = { finalityThreshold: 2000, minimumFeeBps: 1, forwardFeeSubunits: 50_000n }

    const { data, actionablePayload } = await generateLiveServiceData(gatewayRouteScoutManifest, {
      amountUsdc: 100,
      destinationChain: 'Base_Sepolia',
      urgency: 'standard',
    })

    expect(data.status).toBe('QUOTE_READY')
    expect(data.destinationDomain).toBe(6)
    expect(data.gateway.feeUsdc).toBe(0.005) // 0.005% of 100 USDC
    expect(data.cctp.feeUsdc).toBe(0.06) // 1 bps protocol + 0.05 forwarding
    expect(data.cctp.sourceGasUsdc).toBe(0.0024) // 120k gas at the 20 Gwei floor
    expect(data.recommendedRail).toBe('gateway')
    expect(data.savingsUsdc).toBe(0.0574)
    expect(data.estimatedArrivalMs).toBeNull()
    expect(actionablePayload).toBeUndefined()
    expect(data.riskRegister.map((e: any) => e.id)).toContain('ROUTE_RECOMMENDATION')
  })

  it('keeps the CCTP side null when Circle does not quote the route', async () => {
    state.cctpQuote = null

    const { data, actionablePayload } = await generateLiveServiceData(gatewayRouteScoutManifest, {
      amountUsdc: 500,
      destinationChain: 'Ethereum_Sepolia',
      urgency: 'fast',
    })

    expect(data.status).toBe('PARTIAL')
    expect(data.cctp.available).toBe(false)
    expect(data.cctp.feeUsdc).toBeNull()
    expect(data.cctp.totalCostUsdc).toBeNull()
    expect(data.gateway.feeUsdc).toBe(0.025)
    expect(data.recommendedRail).toBe('gateway')
    expect(data.savingsUsdc).toBeNull()
    expect(data.unavailable).toContain('CCTP protocol and forwarding fee')
    expect(actionablePayload).toBeUndefined()
    expect(data.riskRegister.map((e: any) => e.id)).toContain('ROUTE_RECOMMENDATION')
  })

  it('refuses to quote an unknown destination chain instead of guessing a route', async () => {
    const { data } = await generateLiveServiceData(gatewayRouteScoutManifest, {
      amountUsdc: 100,
      destinationChain: 'Not_A_Chain',
      urgency: 'standard',
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.destinationDomain).toBeNull()
    expect(data.recommendedRail).toBeNull()
    expect(data.gateway.feeUsdc).toBeNull()
    expect(data.cctp.feeUsdc).toBeNull()
    expect(data.reason).toContain('not a Circle Gateway destination')
  })
})

describe('generateLiveServiceData — yield & pool opportunity finder', () => {
  it('derives vault TVL/share price and scans all 6 Arc AMM pools live on-chain', async () => {
    state.prices = { USDC: 1, EURC: 1.1, WETH: 3000, cirBTC: 90000 }
    state.reserves = { reserveA: usdc(100_000), reserveB: usdc(90_000) }
    state.vaultAssets = 1_234_567_890n // 1,234.567890 USDC
    state.vaultSupply = 1_000_000_000_000n // 1,000 shares at 9 decimals

    const { data, actionablePayload } = await generateLiveServiceData(vaultAnalyticsManifest, {
      riskPreference: 'all',
    })

    expect(data.status).toBe('VAULT_READ')
    expect(data.riskPreference).toBe('all')
    expect(data.tvlUsdc).toBe(1234.56789)
    expect(data.sharePriceUsdc).toBe(1.234568)
    expect(data.totalSupplyShares).toBe('1000')
    expect(data.shareDecimals).toBe(9)
    expect(data.poolsScannedCount).toBe(6)
    expect(data.poolsMeasuredCount).toBe(6)
    expect(data.opportunities).toHaveLength(7) // 1 Vault + 6 AMM pools
    expect(data.opportunities.some((o: any) => o.kind === 'vault')).toBe(true)
    expect(data.opportunities.filter((o: any) => o.kind === 'lp_pool')).toHaveLength(6)
    expect(actionablePayload).toBeUndefined()

    expect(data.report.kind).toBe('VAULT_ANALYTICS')
    expect(data.report.coverage.state).toBe('COMPLETE')
    expect(data.report.dataQuality.grade).toBe('A')
    const registerIds = data.report.riskRegister.map((entry: any) => entry.id)
    expect(registerIds).toContain('NO_HISTORICAL_SERIES')
    expect(registerIds).toContain('VAULT_ACTIVE_RESERVES')
  })

  it('filters opportunities by riskPreference and tags wallet-matched pools when walletAddress is provided', async () => {
    const wallet = '0x1111111111111111111111111111111111111111'
    state.prices = { USDC: 1, EURC: 1.1, WETH: 3000, cirBTC: 90000 }
    state.reserves = { reserveA: usdc(100_000), reserveB: usdc(90_000) }
    state.vaultAssets = 500_000_000n
    state.vaultSupply = 500_000_000_000n
    state.balances = {
      [ARC_TESTNET_TOKENS.USDC.toLowerCase()]: 250_000_000n, // holds 250 USDC
    }

    const stableOnly = await generateLiveServiceData(vaultAnalyticsManifest, {
      riskPreference: 'stable_only',
      walletAddress: wallet,
    })
    expect(stableOnly.data.opportunities).toHaveLength(2) // USDC Yield Vault + USDC/EURC StableSwap
    expect(stableOnly.data.opportunities.every((o: any) => o.walletEligible === true)).toBe(true)
    expect(stableOnly.data.opportunities.every((o: any) => o.matchedTokens.includes('USDC'))).toBe(true)
    expect(stableOnly.data.report.riskRegister.map((e: any) => e.id)).toContain('WALLET_OPPORTUNITIES_MATCHED')

    const volatileOnly = await generateLiveServiceData(vaultAnalyticsManifest, {
      riskPreference: 'volatile_only',
    })
    expect(volatileOnly.data.opportunities).toHaveLength(5)
    expect(volatileOnly.data.opportunities.every((o: any) => o.kind === 'lp_pool' && o.riskLevel !== 'Safe')).toBe(true)
  })

  it('does not compute a share price when the vault has no shares', async () => {
    state.vaultAssets = 0n
    state.vaultSupply = 0n

    const { data } = await generateLiveServiceData(vaultAnalyticsManifest, { riskPreference: 'all' })

    expect(data.status).toBe('VAULT_EMPTY')
    expect(data.sharePriceUsdc).toBeNull()
    expect(data.tvlUsdc).toBe(0)
  })

  it('reports UNAVAILABLE rather than a zero when totalAssets cannot be read', async () => {
    state.vaultAssets = null
    state.vaultSupply = 1_000_000_000_000n

    const { data } = await generateLiveServiceData(vaultAnalyticsManifest, { riskPreference: 'all' })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.totalAssetsUsdc).toBeNull()
    expect(data.sharePriceUsdc).toBeNull()
    expect(data.tvlUsdc).toBeNull()
    expect(data.unavailable).toContain('vault totalAssets()')
    expect(data.report.coverage.state).toBe('PARTIAL')
    expect(data.report.riskRegister.map((entry: any) => entry.id)).toContain('VAULT_READ_FAILED')
  })
})

describe('generateLiveServiceData — portfolio risk & exposure', () => {
  const USDC = ARC_TESTNET_TOKENS.USDC.toLowerCase()
  const EURC = ARC_TESTNET_TOKENS.EURC.toLowerCase()

  it('reports measured exposure, concentration and stablecoin share', async () => {
    state.prices = { USDC: 1, EURC: 1.1 }
    state.balances = { [USDC]: 500_000_000n, [EURC]: 100_000_000n }
    state.gatewayBalances = {
      token: 'USDC',
      balances: [{ domain: 6, depositor: '0x0000000000000000000000000000000000000001', balance: '250' }],
    }

    const { data } = await generateLiveServiceData(portfolioRiskManifest, {
      address: '0x0000000000000000000000000000000000000001',
      includeGatewayBalance: true,
    })

    expect(data.status).toBe('PORTFOLIO_ANALYZED')
    expect(data.totalUsd).toBe(860) // 500 + 110 + 250 Gateway
    expect(data.gatewayBalanceUsdc).toBe(250)
    expect(data.concentrationPct).toBe(87.209302)
    expect(data.stablecoinSharePct).toBe(100)
    expect(data.chainExposure).toHaveLength(2)
    expect(data.riskFlags).toContain('HIGH_CONCENTRATION')

    // Institutional envelope: the same measurement is graded, not just flagged.
    expect(data.report.kind).toBe('PORTFOLIO_EXPOSURE')
    expect(data.report.coverage.state).toBe('COMPLETE')
    expect(data.report.dataQuality.grade).toBe('A')
    const concentration = data.report.riskRegister.find(
      (entry: any) => entry.id === 'HIGH_CONCENTRATION'
    )
    expect(concentration.severity).toBe('HIGH') // 87.2% is above the 75% HIGH band
    expect(concentration.evidence.concentrationPct).toBe(87.209302)
    expect(concentration.threshold).toContain('50%')
  })

  it('withholds the total when a balance read fails instead of treating it as zero', async () => {
    state.balanceFails = true

    const { data } = await generateLiveServiceData(portfolioRiskManifest, {
      address: '0x0000000000000000000000000000000000000001',
      includeGatewayBalance: true,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.totalUsd).toBeNull()
    expect(data.concentrationPct).toBeNull()
    expect(data.holdings.every((holding: any) => holding.balance === null)).toBe(true)
    expect(data.unavailable).toContain('USDC wallet balance')
    expect(data.reason).toContain('no holding could be read')

    // A total withheld for unread balances is graded as unreadable, not as an empty portfolio.
    expect(data.report.coverage.state).toBe('INSUFFICIENT')
    expect(data.report.dataQuality.grade).toBe('UNRATED')
    expect(data.report.riskRegister.map((entry: any) => entry.id)).toContain('BALANCE_READ_FAILED')
  })

  it('keeps the measured token side when the requested Gateway balance is unavailable', async () => {
    state.prices = { USDC: 1 }
    state.balances = { [USDC]: 500_000_000n }
    state.gatewayBalances = null

    const { data } = await generateLiveServiceData(portfolioRiskManifest, {
      address: '0x0000000000000000000000000000000000000001',
      includeGatewayBalance: true,
    })

    expect(data.status).toBe('PARTIAL')
    expect(data.totalUsd).toBeNull()
    expect(data.gatewayBalanceUsdc).toBeNull()
    expect(data.holdings[0].balance).toBe(500)
    expect(data.riskFlags).toContain('GATEWAY_BALANCE_UNAVAILABLE')
  })

  it('measures multi-chain native holdings (ETH, POL, AVAX, SEI, S) and includes them in assets and chain exposure', async () => {
    state.prices = { USDC: 1, ETH: 2500, POL: 0.5 }
    state.balances = { [USDC]: 100_000_000n } // 100 USDC on Arc
    state.nativeBalances = {
      Ethereum_Sepolia: 1_000_000_000_000_000_000n, // 1 ETH = $2500
      Polygon_Amoy_Testnet: 200_000_000_000_000_000_000n, // 200 POL = $100
    }
    state.gatewayBalances = null

    const { data } = await generateLiveServiceData(portfolioRiskManifest, {
      address: '0x0000000000000000000000000000000000000001',
      includeGatewayBalance: false,
    })

    expect(data.status).toBe('PORTFOLIO_ANALYZED')
    // Total USD: 100 (USDC) + 2500 (1 ETH) + 100 (200 POL) = 2700 USD
    expect(data.totalUsd).toBe(2700)
    expect(data.holdings.map((h: any) => h.symbol)).toEqual(
      expect.arrayContaining(['USDC', 'EURC', 'ETH', 'cirBTC', 'WETH', 'POL', 'AVAX', 'SEI', 'S'])
    )

    const ethHolding = data.holdings.find((h: any) => h.symbol === 'ETH')
    expect(ethHolding).toBeDefined()
    expect(ethHolding.balance).toBe(1)
    expect(ethHolding.valueUsd).toBe(2500)
    expect(ethHolding.stablecoin).toBe(false)

    const polHolding = data.holdings.find((h: any) => h.symbol === 'POL')
    expect(polHolding).toBeDefined()
    expect(polHolding.balance).toBe(200)
    expect(polHolding.valueUsd).toBe(100)

    const chains = data.chainExposure.map((c: any) => c.chain)
    expect(chains).toContain('Arc_Testnet')
    expect(chains).toContain('Ethereum_Sepolia')
    expect(chains).toContain('Polygon_Amoy_Testnet')
  })
})

describe('generateLiveServiceData — LLM vault yield report', () => {
  const address = '0x0000000000000000000000000000000000000001'

  it('measures principal and redeemable value on-chain, then narrates them', async () => {
    state.vaultAssets = 1_234_567_890n
    state.vaultSupply = 1_000_000_000_000n
    state.vaultShares = 1_000_000_000n
    state.vaultPrincipal = 900_000_000n
    state.vaultPending = 5_000_000n
    state.vaultRedeem = 1_000_000_000n
    const fetchMock = stubLlmNarrative()

    const { data } = await generateLiveServiceData(vaultYieldReportManifest, { address })

    expect(data.status).toBe('REPORT_READY')
    expect(data.measured.currentValueUsdc).toBe(1000)
    expect(data.measured.principalUsdc).toBe(900)
    expect(data.measured.pendingYieldUsdc).toBe(5)
    expect(data.measured.unrealizedYieldUsdc).toBe(100)
    expect(data.measured.shares).toBe('1')
    expect(data.narrative.headline).toBeTruthy()
    expect(data.limitations.join(' ')).toMatch(/cost basis|jurisdiction/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(data.report.kind).toBe('VAULT_POSITION')
    expect(data.report.coverage.state).toBe('COMPLETE')
    const unrealized = data.report.riskRegister.find(
      (entry: any) => entry.id === 'UNREALIZED_YIELD_UNSETTLED'
    )
    expect(unrealized.severity).toBe('INFO')
    expect(unrealized.evidence.unrealizedYieldUsdc).toBe(100)
    // The disclosure items are always present, whatever the position looks like.
    expect(data.report.riskRegister.map((entry: any) => entry.id)).toEqual(
      expect.arrayContaining(['COST_BASIS_OUTSIDE_VAULT', 'TAX_RULES_NOT_APPLIED'])
    )
    expect(data.limitations).toEqual(data.report.limitations)
  })

  it('skips the model and reports NO_POSITION when the address holds no shares', async () => {
    state.vaultAssets = 1_234_567_890n
    state.vaultSupply = 1_000_000_000_000n
    state.vaultShares = 0n
    state.vaultPrincipal = 0n
    state.vaultPending = 0n
    const fetchMock = stubLlmNarrative()

    const { data } = await generateLiveServiceData(vaultYieldReportManifest, { address })

    expect(data.status).toBe('NO_POSITION')
    expect(data.measured.currentValueUsdc).toBe(0)
    expect(data.narrative).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns UNAVAILABLE when the share balance cannot be read', async () => {
    state.vaultAssets = 1_234_567_890n
    state.vaultSupply = 1_000_000_000_000n
    state.vaultShares = null
    const fetchMock = stubLlmNarrative()

    const { data } = await generateLiveServiceData(vaultYieldReportManifest, { address })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.measured).toEqual({})
    expect(data.narrative).toBeNull()
    expect(data.unavailable).toContain('vault balanceOf(address)')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('no fabricated service figures remain in the source', () => {
  const read = (relativePath: string) =>
    fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

  it('keeps the provider free of projected volumes, fixed splits and sentiment verdicts', () => {
    const source = read('src/services/aiServicesDataProvider.ts')

    for (const forbidden of [
      'baseHourlyInflow',
      'windowMultiplier',
      '142_500',
      '142500',
      'STRONG_BULLISH',
      'FEED_ACTIVE',
      'institutionalWhaleTransfersCount',
      'flowSentiment',
      'netUsdcInflowToArc',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('keeps every invented arbitrage, liquidity, MEV and liquidation figure deleted', () => {
    const source = read('src/services/aiServicesDataProvider.ts')

    for (const forbidden of [
      'confidenceScore',
      'executionCalldataHex',
      'mempoolRisk',
      'secondaryOpportunities',
      'LOW_MEV_THREAT',
      'detectedActiveMevBotsCount',
      'mevProtectionScore',
      'potentialLossWithoutShieldUsdc',
      'savedVsSinglePoolUsdc',
      'splitExecutionDistribution',
      'settlementTimeEstimateMs',
      'executableTxPayload',
      'healthFactor',
      'borrowerAddress',
      "125000",
      '118000',
      '84250',
      '243_000',
      '0.0036',
      '0.924',
      '0.994',
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })

  it('keeps copilot service catalog copy precise about which wallets can pay', () => {
    const source = read('src/hooks/useArcCopilot.ts')
    // EOA key holders only: an injected wallet or a Circle Wallet created as an EOA.
    expect(source).toContain('external EOA or an active Circle Wallet signing session')
    expect(source).toContain('provider earnings remain pending')
    expect(source).toContain('Passkey/MSCA and autonomous session payments are unsupported')
    expect(source).toContain('These are catalog rates, not successful calls')
    expect(source).toContain('These are catalog entries. Paid testnet calls require an external EOA or Circle Wallet')
    expect(source).not.toContain('Gasless Micro-Settlement (<150ms)')
    expect(source).not.toContain('Instant Verified Payload (HTTP 200 OK)')
    expect(source).not.toContain('Arbitrage Scan Completed!')
    expect(source).not.toContain('private relayer armed')
  })

  it('keeps the copilot report free of hard-coded inflow figures and whale counts', () => {
    const source = read('src/hooks/useArcCopilot.ts')

    for (const forbidden of [
      '$2.45M',
      '50.8%',
      '27.4%',
      '17.6%',
      '14 large transactions',
      'Bullish Institutional Inflow',
      'netUsdcInflowToArc',
    ]) {
      expect(source).not.toContain(forbidden)
    }

    // The report is rendered by the single owner of the Gateway flow formatting.
    expect(source).toContain('formatGatewayFlowReport')
  })

  it('keeps random settlement hashes out of the paid call paths', () => {
    const orchestrator = read('src/services/x402/paymentOrchestrator.ts')
    const tollgate = read('api/x402.ts')
    const relayer = read('api/relayer.ts')

    // A batched Gateway authorization has no on-chain hash: neither path may mint one.
    expect(orchestrator).not.toContain('batchTxHash')
    expect(orchestrator).not.toContain('Math.random().toString(16)')
    expect(tollgate).not.toContain('batchTxHash')
    expect(tollgate).not.toContain('mockTxHash')
    expect(tollgate).not.toContain('gw-batched-')
    expect(relayer).not.toContain('incrementGaslessDailyQuota(from, DAILY_FREE_LIMIT)')
    expect(relayer).not.toContain('const { receipt, txHash } = await relayerMutex.runExclusive')
  })

  it('keeps fabricated deposit, withdraw and authorization signers out of the gateway client', () => {
    const client = read('src/services/x402/gatewayClient.ts')

    expect(client).not.toContain('depositTxHash')
    expect(client).not.toContain('authorizationSignature')
    expect(client).not.toContain('Math.random()')
  })
})
