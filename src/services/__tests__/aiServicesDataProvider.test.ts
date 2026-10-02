// src/services/__tests__/aiServicesDataProvider.test.ts
// Proof for the paid native AI services: answers are built from real reads, an unreadable
// input is answered with an explicit UNAVAILABLE, and no invented figure, score, calldata,
// liquidation or settlement value can reach a caller.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ACTIVE_GATEWAY_CONTRACTS } from '../../config/gatewayConfig'
import { gatewayIndexerManifest } from '../../config/x402/manifests/gatewayIndexer'
import { arbitrageSentinelManifest } from '../../config/x402/manifests/arbitrageSentinel'
import { slippageOptimizerManifest } from '../../config/x402/manifests/slippageOptimizer'
import { mevShieldManifest } from '../../config/x402/manifests/mevShield'
import { flashLoanRadarManifest } from '../../config/x402/manifests/flashLoanRadar'
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
  vaultAssets: 0n,
}))

vi.mock('../rpc', () => ({
  getArcPublicClient: () => state.client,
  resilientReadContract: vi.fn(async (_client: unknown, params: any) => {
    if (state.reserves === null) throw new Error('arc rpc unavailable')
    if (params.functionName === 'reserveA') return state.reserves.reserveA
    if (params.functionName === 'reserveB') return state.reserves.reserveB
    if (params.functionName === 'totalAssets') return state.vaultAssets
    return 0n
  }),
}))

vi.mock('../tokenPriceService', () => ({
  getLiveTokenPrices: vi.fn(async () => state.prices),
  normalizeTokenSymbol: (symbol: string) => symbol.toUpperCase(),
}))

vi.mock('../swapService', () => ({
  getSwapEstimate: vi.fn(),
}))

const MINTER = String(ACTIVE_GATEWAY_CONTRACTS.gatewayMinter).toLowerCase()
const WALLET = String(ACTIVE_GATEWAY_CONTRACTS.gatewayWallet).toLowerCase()

const usdc = (amount: number) => BigInt(Math.round(amount * 1e6))

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

beforeEach(() => {
  invalidateGatewayFlowCache()
  state.client = makeClient()
  state.prices = {}
  state.reserves = { reserveA: 0n, reserveB: 0n }
  state.vaultAssets = 0n
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
    expect(actionablePayload?.badgeText).toContain('+$3,000 USDC')

    const serialized = JSON.stringify(data)
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
    expect(actionablePayload?.badgeText).toBe('Gateway flow data unavailable')
    expect(JSON.stringify(data)).not.toMatch(/142500|4820500|STRONG_BULLISH|FEED_ACTIVE/)
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
    expect(actionablePayload?.badgeText).toContain('Net Profit')

    expect(data.bestRoute).not.toHaveProperty('confidenceScore')
    expect(data.bestRoute).not.toHaveProperty('executionCalldataHex')
    expect(data).not.toHaveProperty('mempoolRisk')
    expect(data).not.toHaveProperty('secondaryOpportunities')
    expect(JSON.stringify(data)).not.toMatch(/0\.994|LOW_MEV_THREAT|0x522faf9a/)
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
    expect(actionablePayload?.badgeText).toContain('unavailable')
    expect(JSON.stringify(data)).not.toMatch(/confidenceScore|netProfitUsdc|executionCalldataHex/)
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
    expect(JSON.stringify(data)).not.toMatch(/1\.08|2500|78500/)
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
    expect(actionablePayload?.badgeText).toContain('unavailable')
    expect(JSON.stringify(data)).not.toMatch(/0\.924|0\.042|243_000|0\.0065/)
  })

  it('reports the real trade-to-reserve exposure without invented bot counts or scores', async () => {
    state.reserves = { reserveA: usdc(1_000_000), reserveB: usdc(900_000) }

    const { data } = await generateLiveServiceData(mevShieldManifest, {
      targetTxAmountUsdc: 100_000,
      slippageTolerancePct: 0.5,
    })

    expect(data.status).toBe('ANALYSIS_COMPLETE')
    expect(data.vulnerabilityLevel).toBe('HIGH_IF_UNPROTECTED')
    expect(data.tradeReserveExposurePct).toBe(10)
    // The suggested slippage is the user's own number, not a hidden 0.08 policy cap.
    expect(data.recommendedShieldAction.adjustedMaxSlippagePct).toBe(0.5)
    expect(data).not.toHaveProperty('detectedActiveMevBotsCount')
    expect(data).not.toHaveProperty('potentialLossWithoutShieldUsdc')
    expect(data.recommendedShieldAction).not.toHaveProperty('mevProtectionScore')
    expect(JSON.stringify(data)).not.toMatch(/0\.72|100% SECURE/)
  })

  it('reports an unavailable MEV exposure instead of a default 5% when reserves fail', async () => {
    state.reserves = null

    const { data } = await generateLiveServiceData(mevShieldManifest, {
      targetTxAmountUsdc: 100_000,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.tradeReserveExposurePct).toBeNull()
    expect(data.vulnerabilityLevel).toBeNull()
    expect(data.unavailable).toContain('on-chain pool reserve depth')
  })

  it('returns no liquidation opportunity at all, and never a fabricated one', async () => {
    state.vaultAssets = usdc(84_250)

    const { data } = await generateLiveServiceData(flashLoanRadarManifest, {
      minLiquidationRewardUsdc: 100,
    })

    expect(data.status).toBe('UNAVAILABLE')
    expect(data.onChainVaultLiquidityUsdc).toBe(84_250)
    expect(data.activeOpportunitiesCount).toBeNull()
    expect(data.opportunities).toEqual([])
    expect(data.unavailable).toContain('liquidation opportunity feed')
    expect(JSON.stringify(data)).not.toMatch(/borrowerAddress|healthFactor|executableTxPayload|liquidationBonusPct/)
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

  it('keeps copilot service catalog copy precise about the EOA-only testnet payment path', () => {
    const source = read('src/hooks/useArcCopilot.ts')
    expect(source).toContain('explicitly selected external EOA')
    expect(source).toContain('provider earnings remain pending')
    expect(source).toContain('Passkey/MSCA, UCW and autonomous session payments are unsupported')
    expect(source).toContain('These are catalog rates, not successful calls')
    expect(source).toContain('These are catalog entries. Paid testnet calls require external EOA selection')
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
