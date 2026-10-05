import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSwap, getSwapEstimate } from '../swapService'
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

// Modular wallet (passkey MSCA) is controllable per test via the mocked functions below.
vi.mock('../modularWalletService', () => ({
  getActiveSmartAccount: vi.fn(() => null),
  restoreSmartAccount: vi.fn(async () => null),
  sendModularUserOperation: vi.fn(),
}))

import { resilientReadContract, resilientWaitForReceipt } from '../rpc'
import { getActiveSmartAccount, restoreSmartAccount, sendModularUserOperation } from '../modularWalletService'

const SENDER = '0x1111111111111111111111111111111111111111'
const CUSTOM_RECIPIENT = '0x9999999999999999999999999999999999999999'

const TX_A = `0x${'a'.repeat(64)}`
const TX_B = `0x${'b'.repeat(64)}`

describe('Swap execution signer routing (authSource)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Drop any once-queued values left unconsumed by a previous test (mockClear keeps them),
    // then restore the default receipt behaviour.
    vi.mocked(resilientReadContract).mockReset()
    vi.mocked(resilientWaitForReceipt).mockReset()
    vi.mocked(resilientWaitForReceipt).mockImplementation(async (_client: unknown, hash: string) =>
      ({
        status: 'success',
        transactionHash: hash,
        receipt: { transactionHash: hash, status: 'success' },
      }) as unknown as Awaited<ReturnType<typeof resilientWaitForReceipt>>
    )
    vi.mocked(getActiveSmartAccount).mockReturnValue(null as any)
    vi.mocked(restoreSmartAccount).mockResolvedValue(null as any)
    // reserveA + reserveB for every test that reaches the Arc-native quote maths.
    vi.mocked(resilientReadContract)
      .mockResolvedValueOnce(100_000_000_000n)
      .mockResolvedValueOnce(100_000_000_000n)
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
  })

  it('never sends a passkey user into the UCW challenge flow when the MSCA cache is cold', async () => {
    const mockExecuteUcw = vi.fn()

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: SENDER,
      authSource: 'passkey',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorMessage).toContain('Passkey smart account could not be loaded')
    expect(mockExecuteUcw).not.toHaveBeenCalled()
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('restores a cold MSCA from the stored credential and executes through the modular account', async () => {
    vi.mocked(restoreSmartAccount).mockResolvedValue({ address: SENDER } as any)
    vi.mocked(sendModularUserOperation).mockResolvedValue({ success: true, txHash: TX_A })
    // 3rd read: MSCA token allowance (insufficient → approve call is batched in).
    vi.mocked(resilientReadContract).mockResolvedValueOnce(0n)

    const mockExecuteUcw = vi.fn()

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: SENDER,
      authSource: 'passkey',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('DONE')
    expect(result.sourceTxHash).toBe(TX_A)
    expect(restoreSmartAccount).toHaveBeenCalledTimes(1)
    expect(sendModularUserOperation).toHaveBeenCalledTimes(1)
    expect(mockExecuteUcw).not.toHaveBeenCalled()
  })

  it('never signs an evm swap through a warm MSCA cache or a missing provider', async () => {
    vi.mocked(getActiveSmartAccount).mockReturnValue({ address: SENDER } as any)
    const mockExecuteUcw = vi.fn()

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: SENDER,
      authSource: 'evm',
      executeUcwContract: mockExecuteUcw,
      // No sourceAdapter → there is no connected EOA signer to use.
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorMessage).toContain('No active Web3 wallet signer')
    expect(mockExecuteUcw).not.toHaveBeenCalled()
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('requires the UCW handler for ucw auth instead of silently falling through to another signer', async () => {
    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: SENDER,
      authSource: 'ucw',
      // executeUcwContract intentionally missing
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorMessage).toContain('Circle UCW execution handler is missing')
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('reads the allowance of the SENDER, not of a custom recipient', async () => {
    vi.mocked(resilientReadContract).mockResolvedValueOnce(0n) // allowance

    const mockExecuteUcw = vi.fn()
      .mockResolvedValueOnce({ success: true, txHash: TX_A })
      .mockResolvedValueOnce({ success: true, txHash: TX_B })

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: CUSTOM_RECIPIENT,
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('DONE')

    const allowanceCall = vi.mocked(resilientReadContract).mock.calls.find(
      (call) => (call[1] as any)?.functionName === 'allowance'
    )
    expect(allowanceCall).toBeTruthy()
    expect((allowanceCall![1] as any).args[0]).toBe(SENDER)
    expect((allowanceCall![1] as any).args[1]).toBe(POOL_CONTRACTS.ARCIS_SWAP_ROUTER)

    // Audit #11: the approval must be a bounded ceiling, never unlimited maxUint256.
    const approveParams = (mockExecuteUcw.mock.calls[0][0].abiParameters as string[]) || []
    expect(mockExecuteUcw.mock.calls[0][0].abiFunctionSignature).toBe('approve(address,uint256)')
    // abiParameters = [spender, amount] — the selector lives in abiFunctionSignature.
    expect(approveParams[1]).toBe((10_000_000n * 10n ** 6n).toString())
    expect(approveParams[1]).not.toBe(
      '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    )
  })

  it('refuses mainnet chains even from a testnet build (audit #10)', async () => {
    const mockExecuteUcw = vi.fn()

    const result = await executeSwap({
      fromChain: 'Ethereum',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: SENDER,
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('FAILED')
    expect(result.errorMessage).toContain('Mainnet swaps are disabled')
    expect(mockExecuteUcw).not.toHaveBeenCalled()
    expect(sendModularUserOperation).not.toHaveBeenCalled()
    expect(resilientReadContract).not.toHaveBeenCalled()
  })

  it('refuses a mainnet quote as well, so the route never appears in the UI', async () => {
    await expect(
      getSwapEstimate({
        fromChain: 'Ethereum',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        amountIn: '10',
      })
    ).rejects.toThrow('Mainnet swaps are disabled')
  })

  it('reports an unconfirmed approval as pendingStage "approve", not as a pending swap', async () => {
    vi.mocked(resilientReadContract).mockResolvedValueOnce(0n) // allowance → approve required
    vi.mocked(resilientWaitForReceipt).mockResolvedValueOnce({ status: 'unknown' } as any)

    const mockExecuteUcw = vi.fn().mockResolvedValueOnce({ success: true, txHash: TX_A })

    const result = await executeSwap({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
      senderAddress: SENDER,
      recipientAddress: SENDER,
      authSource: 'ucw',
      executeUcwContract: mockExecuteUcw,
    })

    expect(result.status).toBe('PENDING')
    expect(result.pendingStage).toBe('approve')
    expect(result.sourceTxHash).toBe(TX_A)
    // The swap itself was never broadcast.
    expect(mockExecuteUcw).toHaveBeenCalledTimes(1)
  })
})
