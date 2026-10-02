import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSwap } from '../swapService'
import { POOL_CONTRACTS } from '../../config/poolsConfig'

// Mock resilient RPC calls
vi.mock('../rpc', () => ({
  getArcPublicClient: vi.fn(() => ({})),
  getResilientPublicClient: vi.fn(() => ({})),
  resilientReadContract: vi.fn(),
  resilientWaitForReceipt: vi.fn().mockImplementation(async (_client: unknown, hash: string) => ({
    status: 'success',
    receipt: { transactionHash: hash, status: 'success' },
  })),
}))

// Mock modular wallet to return null so it doesn't take MSCA path
vi.mock('../modularWalletService', () => ({
  getActiveSmartAccount: vi.fn(() => null),
  sendModularUserOperation: vi.fn(),
}))

import { resilientReadContract } from '../rpc'

describe('Swap UCW Execution Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })

  it('rejects cross-chain swap when using Circle UCW with a clear informative error', async () => {
    const mockExecuteUcw = vi.fn()
    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      toChain: 'Base_Sepolia',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorMessage).toContain('Circle UCW cüzdanları şu anda yalnızca Arc Testnet içi takasları desteklemektedir')
    expect(mockExecuteUcw).not.toHaveBeenCalled()
  })

  it('executes approval then swapWithFee via executeUcwContract when allowance is insufficient', async () => {
    // 1st call for reserveA, 2nd for reserveB, 3rd for allowance (return 0n)
    vi.mocked(resilientReadContract)
      .mockResolvedValueOnce(100_000_000_000n) // reserveA
      .mockResolvedValueOnce(100_000_000_000n) // reserveB
      .mockResolvedValueOnce(0n) // allowance: 0

    const mockExecuteUcw = vi.fn()
      // approve challenge success
      .mockResolvedValueOnce({ success: true, txHash: `0x${'a'.repeat(64)}` })
      // swap challenge success
      .mockResolvedValueOnce({ success: true, txHash: `0x${'b'.repeat(64)}` })
    const receiptWait = vi.spyOn(await import('../rpc'), 'resilientWaitForReceipt')
    receiptWait.mockImplementation(async (_client: unknown, hash: string) => ({
      status: 'success', receipt: { transactionHash: hash, status: 'success' },
    }) as any)

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '50',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
      customFee: {
        percentageBps: 12,
        recipientAddress: '0x2222222222222222222222222222222222222222',
      },
    })

    expect(result.status).toBe('DONE')
    expect(result.sourceTxHash).toBe(`0x${'b'.repeat(64)}`)
    expect(mockExecuteUcw).toHaveBeenCalledTimes(2)

    // Check approval challenge call
    expect(mockExecuteUcw).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contractAddress: POOL_CONTRACTS.USDC,
      abiFunctionSignature: 'approve(address,uint256)',
      blockchain: 'ARC-TESTNET',
    }))

    // Check swap challenge call
    expect(mockExecuteUcw).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contractAddress: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
      abiFunctionSignature: 'swapWithFee(address,address,address,uint256,uint256,address,uint256)',
      blockchain: 'ARC-TESTNET',
    }))
  })

  it('skips approve challenge when on-chain allowance is already sufficient', async () => {
    // 1st call for reserveA, 2nd for reserveB, 3rd for allowance (already max)
    vi.mocked(resilientReadContract)
      .mockResolvedValueOnce(100_000_000_000n)
      .mockResolvedValueOnce(100_000_000_000n)
      .mockResolvedValueOnce(1_000_000_000_000n) // Sufficient allowance

    const mockExecuteUcw = vi.fn().mockResolvedValueOnce({
      success: true,
      txHash: `0x${'c'.repeat(64)}`,
    })
    const receiptWait = vi.spyOn(await import('../rpc'), 'resilientWaitForReceipt')
    receiptWait.mockImplementation(async (_client: unknown, hash: string) => ({
      status: 'success', receipt: { transactionHash: hash, status: 'success' },
    }) as any)

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('DONE')
    expect(result.sourceTxHash).toBe(`0x${'c'.repeat(64)}`)
    // Only 1 call because approve was skipped!
    expect(mockExecuteUcw).toHaveBeenCalledTimes(1)
    expect(mockExecuteUcw).toHaveBeenCalledWith(expect.objectContaining({
      contractAddress: POOL_CONTRACTS.ARCIS_SWAP_ROUTER,
      abiFunctionSignature: 'swapWithFee(address,address,address,uint256,uint256,address,uint256)',
      blockchain: 'ARC-TESTNET',
    }))
  })

  it('flags isCanceled when user cancels the UCW challenge', async () => {
    vi.mocked(resilientReadContract)
      .mockResolvedValueOnce(100_000_000_000n)
      .mockResolvedValueOnce(100_000_000_000n)
      .mockResolvedValueOnce(1_000_000_000_000n)

    const mockExecuteUcw = vi.fn().mockResolvedValueOnce({
      success: false,
      error: 'Challenge was canceled by user',
    })

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      recipientAddress: '0x1111111111111111111111111111111111111111',
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('FAILED')
    expect(result.isCanceled).toBe(true)
  })
})
