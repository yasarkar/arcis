// src/services/copilot/__tests__/copilotLpRemoveAction.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem'
import { POOL_CONTRACTS, STABLE_SWAP_ABI } from '../../../config/poolsConfig'
import { getCopilotLpPoolById, parseCopilotLpRemoveAmount } from '../../../utils/copilotPoolParser'

const mockReadContract = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()
const mockEstimateContractGas = vi.fn(async () => 220_000n)
const mockWriteContract = vi.fn()
const mockSendModularUserOp = vi.fn()
const mockAddTransaction = vi.fn()

vi.mock('../../rpc/index.js', () => ({
  getResilientPublicClient: () => ({
    readContract: mockReadContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    estimateContractGas: mockEstimateContractGas,
  }),
}))

vi.mock('../../rpc', () => ({
  getResilientPublicClient: () => ({
    readContract: mockReadContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    estimateContractGas: mockEstimateContractGas,
  }),
}))

vi.mock('../../arcGasService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../arcGasService')>()
  return {
    ...actual,
    resolveArcActualFeeUsdc: vi.fn(async () => ({
      feeUsdc: 0.0009,
      baseFeeUsdcExact: '0.00080',
      priorityFeeUsdcExact: '0.00010',
    })),
    getDynamicArcGasOptions: vi.fn(async () => ({
      isDynamic: true,
      maxFeePerGas: 25_000_000_000n,
      source: 'arc-rpc',
    })),
    calculateArcGasCostFromFee: vi.fn(() => '0.00095'),
  }
})

vi.mock('../../tokenPriceService', () => ({
  DEFAULT_TOKEN_PRICES: { USDC: 1, EURC: 1.08, WETH: 2650, CIRBTC: 65000 },
  getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1.08, WETH: 2650, CIRBTC: 65000 })),
  normalizeTokenSymbol: (s: string) => s.trim().toUpperCase(),
}))

vi.mock('../../modularWalletService', () => ({
  sendModularUserOperation: (...args: any[]) => mockSendModularUserOp(...args),
  arcTestnetChain: { id: 5042002, name: 'Arc Testnet' },
}))

vi.mock('../../../utils/history', () => ({
  addTransaction: (...args: any[]) => mockAddTransaction(...args),
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      writeContract: mockWriteContract,
    })),
  }
})

import { getCopilotLpRemoveQuote } from '../copilotLpRemoveQuote'
import { executeCopilotLpRemoveAction } from '../copilotLpRemoveAction'

const WALLET = '0x1111111111111111111111111111111111111111' as const
const TX_HASH = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const

function liquidityRemovedLog(poolAddress: string, provider: string, lpAmount: bigint, amountA: bigint, amountB: bigint) {
  const topics = encodeEventTopics({
    abi: STABLE_SWAP_ABI,
    eventName: 'LiquidityRemoved',
    args: { provider: provider as `0x${string}` },
  })
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [lpAmount, amountA, amountB]
  )
  return { address: poolAddress, data, topics }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseCopilotLpRemoveAmount', () => {
  it('parses percentages, Turkish/English natural keywords, USD values, and exact LP amounts', () => {
    expect(parseCopilotLpRemoveAmount('remove 50% LP from USDC/EURC')).toEqual({ status: 'percent', percent: 50 })
    expect(parseCopilotLpRemoveAmount('USDC/EURC havuzundan %25 LP çek')).toEqual({ status: 'percent', percent: 25 })
    expect(parseCopilotLpRemoveAmount('USDC/EURC havuzundan tüm LP\'yi çek')).toEqual({ status: 'percent', percent: 100 })
    expect(parseCopilotLpRemoveAmount('remove all LP from USDC/WETH')).toEqual({ status: 'percent', percent: 100 })
    expect(parseCopilotLpRemoveAmount('USDC/EURC havuzundaki LP\'nin yarısını çek')).toEqual({ status: 'percent', percent: 50 })
    expect(parseCopilotLpRemoveAmount('USDC/EURC havuzundan çeyrek LP çek')).toEqual({ status: 'percent', percent: 25 })
    expect(parseCopilotLpRemoveAmount('remove $50 from USDC/EURC pool')).toEqual({ status: 'usd', usdAmount: 50 })
    expect(parseCopilotLpRemoveAmount('EURC/WETH havuzundan 2.5 LP çek')).toEqual({
      status: 'lp',
      lpAmount: 2.5,
      lpAmountDecimal: '2.5',
    })
  })

  it('rejects out-of-range percentages and ambiguous thousands separators fail-closed', () => {
    expect(parseCopilotLpRemoveAmount('remove 150% LP from USDC/EURC').status).toBe('error')
    expect(parseCopilotLpRemoveAmount('remove 1.000 LP from USDC/EURC').status).toBe('error')
    expect(parseCopilotLpRemoveAmount('remove LP from USDC/EURC').status).toBe('missing')
  })
})

describe('getCopilotLpRemoveQuote', () => {
  const usdcEurcPool = getCopilotLpPoolById('usdc-eurc-stable-pool')!

  it('computes live proportional Token A + Token B outputs and V4 minOut slippage guards for 50%', async () => {
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'balanceOf') return parseUnits('100', 18)
      if (functionName === 'reserveA') return parseUnits('1000', 6) // 1000 USDC
      if (functionName === 'reserveB') return parseUnits('900', 6) // 900 EURC
      if (functionName === 'totalLp') return parseUnits('1000', 18) // user owns 10%
      if (functionName === 'paused') return false
      return 0n
    })

    const res = await getCopilotLpRemoveQuote({
      walletAddress: WALLET,
      pool: usdcEurcPool,
      removeMode: 'percent',
      removePercent: 50,
      slippageBps: 50,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.quote.lpAmountDecimal).toBe('50')
      expect(res.quote.estimatedOutA).toBe('50')
      expect(res.quote.estimatedOutB).toBe('45')
      expect(res.quote.minOutA).toBe('49.75')
      expect(res.quote.minOutB).toBe('44.775')
      expect(res.quote.removePercent).toBe(50)
      expect(res.quote.estimatedWithdrawUsd).toBeCloseTo(50 + 45 * 1.08, 2)
    }
  })

  it('returns an insufficient LP balance error when requesting more LP than held', async () => {
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'balanceOf') return parseUnits('5', 18)
      if (functionName === 'reserveA') return parseUnits('1000', 6)
      if (functionName === 'reserveB') return parseUnits('1000', 6)
      if (functionName === 'totalLp') return parseUnits('1000', 18)
      if (functionName === 'paused') return false
      return 0n
    })

    const res = await getCopilotLpRemoveQuote({
      walletAddress: WALLET,
      pool: usdcEurcPool,
      removeMode: 'lp',
      lpAmount: 20,
      lpAmountDecimal: '20',
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('Insufficient LP balance')
    }
  })

  it('lists other active LP positions with [[token:...]] icons when the requested pool has 0 LP', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
        if (functionName === 'balanceOf') return 0n
        if (functionName === 'paused') return false
        return parseUnits('1000', 6)
      }
      if (address === POOL_CONTRACTS.WETH_POOL) {
        if (functionName === 'balanceOf') return parseUnits('10', 18)
        if (functionName === 'reserveA') return parseUnits('2000', 6)
        if (functionName === 'reserveB') return parseUnits('1', 18)
        if (functionName === 'totalLp') return parseUnits('100', 18)
      }
      return 0n
    })

    const res = await getCopilotLpRemoveQuote({
      walletAddress: WALLET,
      pool: usdcEurcPool,
      removeMode: 'percent',
      removePercent: 50,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.empty).toBe(true)
      expect(res.otherActivePositions).toHaveLength(1)
      expect(res.error).toContain('No LP position in USDC / EURC')
      expect(res.error).toContain('Your active LP positions')
      expect(res.error).toContain('USDC / WETH')
      expect(res.error).toContain('[[token:USDC]]')
      expect(res.error).toContain('[[token:WETH]]')
    }
  })
})

describe('executeCopilotLpRemoveAction', () => {
  const basePayload = {
    type: 'interactive_lp_remove' as const,
    title: 'Remove 50% LP from USDC / EURC',
    data: {
      poolId: 'usdc-eurc-stable-pool',
      poolName: 'USDC / EURC',
      tokenA: 'USDC',
      tokenB: 'EURC',
      removeMode: 'percent' as const,
      removePercent: 50,
      lpAmount: 50,
      lpAmountDecimal: '50',
      lpAmountRaw: parseUnits('50', 18).toString(),
      minOutARaw: parseUnits('49.75', 6).toString(),
      minOutBRaw: parseUnits('44.775', 6).toString(),
      slippageBps: 50,
    },
  }

  function mockHealthyPoolReads() {
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'balanceOf') return parseUnits('100', 18)
      if (functionName === 'reserveA') return parseUnits('1000', 6)
      if (functionName === 'reserveB') return parseUnits('900', 6)
      if (functionName === 'totalLp') return parseUnits('1000', 18)
      if (functionName === 'paused') return false
      return 0n
    })
  }

  it('executes gasless removeLiquidity UserOp for Passkey/MSCA and decodes LiquidityRemoved', async () => {
    mockHealthyPoolReads()
    mockSendModularUserOp.mockResolvedValue({ success: true, txHash: TX_HASH })
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH,
      logs: [
        liquidityRemovedLog(
          POOL_CONTRACTS.STABLE_SWAP_POOL,
          WALLET,
          parseUnits('50', 18),
          parseUnits('50', 6),
          parseUnits('45', 6)
        ),
      ],
    })

    const receipt = await executeCopilotLpRemoveAction({
      actionPayload: basePayload,
      activeWallet: WALLET,
      activeMsca: WALLET,
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.actionType).toBe('withdraw')
    expect(receipt.title).toBe('USDC / EURC LP Removed')
    expect(receipt.lpBurned).toBe('50')
    expect(receipt.receivedAmountA).toBe('50')
    expect(receipt.receivedAmountB).toBe('45')
    expect(mockSendModularUserOp).toHaveBeenCalledTimes(1)
    expect(mockSendModularUserOp.mock.calls[0][0].paymaster).toBe(true)
    expect(mockAddTransaction).toHaveBeenCalledWith(expect.objectContaining({ type: 'remove_liquidity' }))
  })

  it('executes removeLiquidity(uint256,uint256,uint256) via Circle UCW', async () => {
    mockHealthyPoolReads()
    const executeUcwContract = vi.fn().mockResolvedValue({ success: true, txHash: TX_HASH })
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH,
      logs: [
        liquidityRemovedLog(
          POOL_CONTRACTS.STABLE_SWAP_POOL,
          WALLET,
          parseUnits('50', 18),
          parseUnits('50', 6),
          parseUnits('45', 6)
        ),
      ],
    })

    const receipt = await executeCopilotLpRemoveAction({
      actionPayload: basePayload,
      activeWallet: WALLET,
      ucwHandlers: { authSource: 'ucw', executeUcwContract },
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(executeUcwContract).toHaveBeenCalledWith(
      expect.objectContaining({
        contractAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
        abiFunctionSignature: 'removeLiquidity(uint256,uint256,uint256)',
        blockchain: 'ARC-TESTNET',
      })
    )
  })

  it('executes removeLiquidity via injected EOA walletClient', async () => {
    mockHealthyPoolReads()
    mockWriteContract.mockResolvedValue(TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH,
      logs: [
        liquidityRemovedLog(
          POOL_CONTRACTS.STABLE_SWAP_POOL,
          WALLET,
          parseUnits('50', 18),
          parseUnits('50', 6),
          parseUnits('45', 6)
        ),
      ],
    })

    const receipt = await executeCopilotLpRemoveAction({
      actionPayload: basePayload,
      activeWallet: WALLET,
      provider: { request: vi.fn() },
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(mockWriteContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: POOL_CONTRACTS.STABLE_SWAP_POOL,
        functionName: 'removeLiquidity',
      })
    )
  })

  it('refuses execution without signing if live reserves drifted below approved minOut guards', async () => {
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'balanceOf') return parseUnits('100', 18)
      if (functionName === 'reserveA') return parseUnits('700', 6) // Dropped from 1000 -> 35 USDC out (< 49.75 minOutA)
      if (functionName === 'reserveB') return parseUnits('900', 6)
      if (functionName === 'totalLp') return parseUnits('1000', 18)
      if (functionName === 'paused') return false
      return 0n
    })

    const receipt = await executeCopilotLpRemoveAction({
      actionPayload: basePayload,
      activeWallet: WALLET,
      activeMsca: WALLET,
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toBe('Pool Ratio Moved')
    expect(mockSendModularUserOp).not.toHaveBeenCalled()
    expect(mockWriteContract).not.toHaveBeenCalled()
  })
})
