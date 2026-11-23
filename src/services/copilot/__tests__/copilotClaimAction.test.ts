// src/services/copilot/__tests__/copilotClaimAction.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem'
import { POOL_CONTRACTS, STABLE_SWAP_ABI, YIELD_VAULT_ABI } from '../../../config/poolsConfig'

const mockReadContract = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()
const mockEstimateContractGas = vi.fn(async () => 180_000n)
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
      feeUsdc: 0.0008,
      baseFeeUsdcExact: '0.00070',
      priorityFeeUsdcExact: '0.00010',
    })),
    getDynamicArcGasOptions: vi.fn(async () => ({
      isDynamic: true,
      maxFeePerGas: 25_000_000_000n,
      source: 'arc-rpc',
    })),
    calculateArcGasCostFromFee: vi.fn(() => '0.00090'),
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

import { scanClaimableCopilotFees } from '../copilotClaimQuote'
import { executeCopilotClaimFeesAction } from '../copilotClaimAction'

const WALLET = '0x1111111111111111111111111111111111111111' as const
const TX_HASH_1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const
const TX_HASH_2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const

function feesHarvestedLog(poolAddress: string, lp: string, feeA: bigint, feeB: bigint) {
  const topics = encodeEventTopics({
    abi: STABLE_SWAP_ABI,
    eventName: 'FeesHarvested',
    args: { lp: lp as `0x${string}` },
  })
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [feeA, feeB])
  return { address: poolAddress, data, topics }
}

function yieldHarvestedLog(vaultAddress: string, user: string, amount: bigint) {
  const topics = encodeEventTopics({
    abi: YIELD_VAULT_ABI,
    eventName: 'YieldHarvested',
    args: { user: user as `0x${string}` },
  })
  const data = encodeAbiParameters([{ type: 'uint256' }], [amount])
  return { address: vaultAddress, data, topics }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('scanClaimableCopilotFees', () => {
  it('scans all 7 contracts (6 AMM pools + Yield Vault) and aggregates non-zero claimable fees', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'pendingYield' && address === POOL_CONTRACTS.YIELD_VAULT) {
        return parseUnits('2.5', 6) // $2.50 USDC
      }
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
        return [parseUnits('1.5', 6), parseUnits('1', 6)] // $1.50 + $1.08 = $2.58
      }
      return [0n, 0n]
    })

    const scan = await scanClaimableCopilotFees(WALLET)
    expect(scan.ok).toBe(true)
    if (scan.ok) {
      expect(scan.pools).toHaveLength(2)
      expect(scan.pools.map((p) => p.poolId)).toEqual(['usdc-eurc-stable-pool', 'usdc-yield-vault'])
      expect(scan.totalClaimableUsd).toBeCloseTo(5.08, 2)
    }
  })

  it('returns an empty-state error without preparing an action when no fees are accrued', async () => {
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'pendingYield') return 0n
      return [0n, 0n]
    })

    const scan = await scanClaimableCopilotFees(WALLET)
    expect(scan.ok).toBe(false)
    if (!scan.ok) {
      expect(scan.empty).toBe(true)
      expect(scan.error).toContain('No claimable fees yet')
    }
  })

  it('lists other active pools with pending fees when a specific requested pool has 0 claimable fees', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      // Requested pool USDC/EURC has 0 fees
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
        return [0n, 0n]
      }
      // Other pools DO have accrued fees
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.WETH_POOL) {
        return [parseUnits('1.25', 6), parseUnits('0.001', 18)]
      }
      if (functionName === 'pendingYield' && address === POOL_CONTRACTS.YIELD_VAULT) {
        return parseUnits('2.5', 6)
      }
      return [0n, 0n]
    })

    const scan = await scanClaimableCopilotFees(WALLET, { poolId: 'usdc-eurc-stable-pool' })
    expect(scan.ok).toBe(false)
    if (!scan.ok) {
      expect(scan.empty).toBe(true)
      expect(scan.otherClaimablePools?.map((p) => p.poolId)).toEqual(['usdc-yield-vault', 'usdc-weth-pool'])
      expect(scan.error).toContain('No claimable fees yet')
      expect(scan.error).toContain('USDC / EURC')
      expect(scan.error).toContain('Active pools with claimable fees')
      expect(scan.error).toContain('USDC / WETH')
      expect(scan.error).toContain('[[token:USDC]]')
      expect(scan.error).toContain('[[token:WETH]]')
      expect(scan.error).toContain('USDC Yield Vault')
      expect(scan.error).toContain('Claim all fees')
    }
  })
})

describe('executeCopilotClaimFeesAction', () => {
  it('batches all claimable pools into ONE single UserOperation for Passkey/MSCA wallets', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'pendingYield' && address === POOL_CONTRACTS.YIELD_VAULT) {
        return parseUnits('3', 6)
      }
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
        return [parseUnits('2', 6), parseUnits('1', 6)]
      }
      return [0n, 0n]
    })

    mockSendModularUserOp.mockResolvedValue({ success: true, txHash: TX_HASH_1 })
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH_1,
      logs: [
        feesHarvestedLog(POOL_CONTRACTS.STABLE_SWAP_POOL, WALLET, parseUnits('2', 6), parseUnits('1', 6)),
        yieldHarvestedLog(POOL_CONTRACTS.YIELD_VAULT, WALLET, parseUnits('3', 6)),
      ],
    })

    const receipt = await executeCopilotClaimFeesAction({
      actionPayload: { type: 'interactive_claim_fees', title: 'Claim All Fees', data: { claimScope: 'all' } },
      activeWallet: WALLET,
      activeMsca: WALLET,
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.actionType).toBe('claim')
    expect(receipt.txCount).toBe(1)
    expect(receipt.claimedPools).toHaveLength(2)
    expect(receipt.totalClaimedUsd).toBeCloseTo(6.08, 2)
    expect(mockSendModularUserOp).toHaveBeenCalledTimes(1)
    expect(mockSendModularUserOp.mock.calls[0][0].calls).toHaveLength(2)
    expect(mockSendModularUserOp.mock.calls[0][0].paymaster).toBe(true)
    expect(mockAddTransaction).toHaveBeenCalledTimes(2)
  })

  it('executes sequential harvest() calls for Circle UCW and reports partial harvest if canceled mid-batch', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'pendingYield' && address === POOL_CONTRACTS.YIELD_VAULT) {
        return parseUnits('4', 6)
      }
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
        return [parseUnits('1', 6), 0n]
      }
      return [0n, 0n]
    })

    const executeUcwContract = vi
      .fn()
      .mockResolvedValueOnce({ success: true, txHash: TX_HASH_1 })
      .mockResolvedValueOnce({ success: false, error: 'User canceled challenge' })

    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH_1,
      logs: [feesHarvestedLog(POOL_CONTRACTS.STABLE_SWAP_POOL, WALLET, parseUnits('1', 6), 0n)],
    })

    const receipt = await executeCopilotClaimFeesAction({
      actionPayload: { type: 'interactive_claim_fees', title: 'Claim All Fees', data: { claimScope: 'all' } },
      activeWallet: WALLET,
      ucwHandlers: { authSource: 'ucw', executeUcwContract },
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.title).toContain('Partial Fee Harvest')
    expect(receipt.claimedPools).toHaveLength(1)
    expect(receipt.totalClaimedUsd).toBeCloseTo(1.0, 2)
    expect(executeUcwContract).toHaveBeenCalledTimes(2)
    expect(executeUcwContract.mock.calls[0][0].abiFunctionSignature).toBe('harvest()')
  })

  it('executes sequential harvest() calls for injected EOA wallets and sums gas across txs', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'pendingYield' && address === POOL_CONTRACTS.YIELD_VAULT) {
        return parseUnits('5', 6)
      }
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.WETH_POOL) {
        return [parseUnits('2', 6), parseUnits('0.001', 18)] // $2 + $2.65 = $4.65
      }
      return [0n, 0n]
    })

    mockWriteContract.mockResolvedValueOnce(TX_HASH_1).mockResolvedValueOnce(TX_HASH_2)
    mockWaitForTransactionReceipt
      .mockResolvedValueOnce({
        status: 'success',
        transactionHash: TX_HASH_1,
        logs: [yieldHarvestedLog(POOL_CONTRACTS.YIELD_VAULT, WALLET, parseUnits('5', 6))],
      })
      .mockResolvedValueOnce({
        status: 'success',
        transactionHash: TX_HASH_2,
        logs: [feesHarvestedLog(POOL_CONTRACTS.WETH_POOL, WALLET, parseUnits('2', 6), parseUnits('0.001', 18))],
      })

    const receipt = await executeCopilotClaimFeesAction({
      actionPayload: { type: 'interactive_claim_fees', title: 'Claim All Fees', data: { claimScope: 'all' } },
      activeWallet: WALLET,
      provider: { request: vi.fn() },
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.txCount).toBe(2)
    expect(receipt.claimedPools).toHaveLength(2)
    expect(receipt.totalClaimedUsd).toBeCloseTo(9.65, 2)
    expect(receipt.actualGasUsdc).toBeCloseTo(0.0016, 4)
  })

  it('produces a pool-specific receipt title and subtitle for single-pool fee claims', async () => {
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'pendingFees' && address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
        return [parseUnits('1.5', 6), parseUnits('1', 6)]
      }
      return [0n, 0n]
    })

    mockWriteContract.mockResolvedValueOnce(TX_HASH_1)
    mockWaitForTransactionReceipt.mockResolvedValueOnce({
      status: 'success',
      transactionHash: TX_HASH_1,
      logs: [feesHarvestedLog(POOL_CONTRACTS.STABLE_SWAP_POOL, WALLET, parseUnits('1.5', 6), parseUnits('1', 6))],
    })

    const receipt = await executeCopilotClaimFeesAction({
      actionPayload: {
        type: 'interactive_claim_fees',
        title: 'Claim USDC / EURC Fees',
        data: { claimScope: 'single', poolId: 'usdc-eurc-stable-pool', poolName: 'USDC / EURC' },
      },
      activeWallet: WALLET,
      provider: { request: vi.fn() },
      startTime: Date.now(),
    })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.title).toBe('USDC / EURC Fees Claimed')
    expect(receipt.subtitle).toContain('USDC / EURC accrued fees')
    expect(receipt.poolId).toBe('usdc-eurc-stable-pool')
    expect(receipt.poolName).toBe('USDC / EURC')
  })
})
