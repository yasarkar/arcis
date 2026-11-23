import { decodeFunctionData, hexToString, type Hex } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MEMO_ABI, MEMO_CONTRACT_ADDRESS } from '../../../config/memoConfig'
import * as rpc from '../../rpc'
import * as sessionEnclaveService from '../../sessionEnclaveService'
import * as sessionKeyService from '../../sessionKeyService'
import type { CopilotActionContext } from '../copilotCommon'

const { mockSendTransaction } = vi.hoisted(() => ({
  mockSendTransaction: vi.fn(async () => '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      sendTransaction: mockSendTransaction,
    })),
  }
})

// Mock dependencies
vi.mock('../../arcGasService', () => ({
  resolveArcActualFeeUsdc: vi.fn(async () => ({
    feeUsdc: 0.0005,
    baseFeeUsdcExact: '0.0004',
    priorityFeeUsdcExact: '0.0001',
  })),
}))

vi.mock('../../utils/history', () => ({
  addTransaction: vi.fn(),
}))

vi.mock('../../swapService', () => ({
  getSwapEstimate: vi.fn(async () => ({
    estimatedOutput: '9.95',
  })),
  executeSwap: vi.fn(),
  resolveArcNativeRoute: vi.fn(() => ({
    tokenInAddr: '0x3600000000000000000000000000000000000000',
    tokenOutAddr: '0x3611111111111111111111111111111111111111',
    poolAddress: '0x3622222222222222222222222222222222222222',
    decIn: 6,
    decOut: 6,
  })),
}))

vi.mock('../copilotReceiptVerifier', () => ({
  verifyArcSwapReceipt: vi.fn(async () => ({
    status: 'success',
    amountOut: 9.95,
    actualFeeUsdc: 0.0005,
  })),
}))

import { executeCopilotDepositAction } from '../copilotDepositAction'
import { executeCopilotSendAction } from '../copilotSendAction'
import { executeCopilotSwapAction } from '../copilotSwapAction'

describe('Copilot Autonomous Enclave Execution (Zero-Popup)', () => {
  const MOCK_WALLET = '0x1111111111111111111111111111111111111111'
  const MOCK_RECIPIENT = '0x2222222222222222222222222222222222222222'
  const MOCK_ENCLAVE_PUB = '0x3333333333333333333333333333333333333333'
  const MOCK_TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

  beforeEach(() => {
    vi.clearAllMocks()
    mockSendTransaction.mockResolvedValue(MOCK_TX_HASH)

    // Mock ephemeral account on both services
    const mockAccount = {
      address: MOCK_ENCLAVE_PUB as Hex,
      signTransaction: vi.fn(),
      signTypedData: vi.fn(),
    } as any
    vi.spyOn(sessionKeyService, 'getEphemeralSessionAccount').mockReturnValue(mockAccount)
    vi.spyOn(sessionEnclaveService, 'getEphemeralSessionAccount').mockReturnValue(mockAccount)
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(0)
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(0)

    // Mock resilient client readContract
    vi.spyOn(rpc, 'getResilientPublicClient').mockReturnValue({
      readContract: vi.fn(async ({ functionName }: any) => {
        if (functionName === 'allowance') return 1000000000n
        if (functionName === 'balanceOf') return 50000000n // 50 USDC
        if (functionName === 'previewDeposit') return 10000000n
        return 0n
      }),
      waitForTransactionReceipt: vi.fn(async () => ({ status: 'success' })),
    } as any)
  })

  it('bypasses wallet provider and executes Send directly with zero-popup when enclave has balance', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(25) // 25 USDC in enclave
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(25)

    const mockProvider = {
      request: vi.fn(),
    }

    const context: CopilotActionContext = {
      actionPayload: {
        type: 'send',
        title: 'Send 5 USDC',
        data: {
          token: 'USDC',
          amount: 5,
          recipient: MOCK_RECIPIENT,
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    // Mock getVerifiedArcReceipt to return success receipt with matching log
    const copilotCommon = await import('../copilotCommon')
    vi.spyOn(copilotCommon, 'readArcSendBalance').mockResolvedValue(100n)
    vi.spyOn(copilotCommon, 'getVerifiedArcReceipt').mockResolvedValue({
      status: 'success',
      logs: [],
    } as any)
    vi.spyOn(copilotCommon, 'verifyArcTokenTransferReceipt').mockReturnValue(true)

    const receipt = await executeCopilotSendAction(context, { isActive: true })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.title).toBe('Send Completed Successfully')
    expect(receipt.subtitle).toContain('Zero-Popup')
    expect(receipt.amountIn).toBe(5)
    // Critical: provider.request (MetaMask popup) was NEVER called
    expect(mockProvider.request).not.toHaveBeenCalled()
  })

  it('falls back to wallet provider if enclave balance is insufficient', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(1) // Only 1 USDC in enclave

    const mockProvider = {
      request: vi.fn(async ({ method }) => {
        if (method === 'eth_sendTransaction') return MOCK_TX_HASH
        return null
      }),
    }

    const context: CopilotActionContext = {
      actionPayload: {
        type: 'send',
        title: 'Send 10 USDC',
        data: {
          token: 'USDC',
          amount: 10,
          recipient: MOCK_RECIPIENT,
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    const copilotCommon = await import('../copilotCommon')
    vi.spyOn(copilotCommon, 'readArcSendBalance').mockResolvedValue(100n)
    vi.spyOn(copilotCommon, 'getVerifiedArcReceipt').mockResolvedValue({
      status: 'success',
      logs: [],
    } as any)
    vi.spyOn(copilotCommon, 'verifyArcTokenTransferReceipt').mockReturnValue(true)

    // SendToken mock
    const sendService = await import('../../sendService')
    vi.spyOn(sendService, 'sendToken').mockResolvedValue({
      txHash: MOCK_TX_HASH,
    } as any)

    const receipt = await executeCopilotSendAction(context, { isActive: true })

    expect(receipt.status).toBe('SUCCESS')
    // Subtitle does not say Zero-Popup because it fell back to provider
    expect(receipt.subtitle).toBeUndefined()
  })

  it('executes DEX Swap autonomously with zero-popup when enclave has USDC balance', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50) // 50 USDC in enclave
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)

    const mockProvider = { request: vi.fn() }
    const context: CopilotActionContext = {
      actionPayload: {
        type: 'trade',
        title: 'Swap 10 USDC for EURC',
        data: {
          fromToken: 'USDC',
          toToken: 'EURC',
          amount: 10,
          minReceived: '9.90',
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    const receipt = await executeCopilotSwapAction(context, { isActive: true })
    if (receipt.status === 'FAILED') {
      console.log('SWAP FAILED RECEIPT:', receipt)
    }

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.title).toBe('Swap Completed Successfully')
    expect(receipt.subtitle).toContain('Zero-Popup')
    expect(receipt.amountIn).toBe(10)
    expect(receipt.amountOut).toBe(9.95)
    expect(mockProvider.request).not.toHaveBeenCalled()
  })

  it('refuses autonomous enclave swap without broadcasting when live quote drops below approved minReceived (ARCO-01)', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)

    const swapService = await import('../../swapService')
    vi.mocked(swapService.getSwapEstimate).mockResolvedValueOnce({
      estimatedOutput: '9.50',
    } as any)

    const mockProvider = { request: vi.fn() }
    const progressStates: string[] = []
    const context: CopilotActionContext = {
      actionPayload: {
        type: 'trade',
        title: 'Swap 10 USDC for EURC',
        data: {
          fromToken: 'USDC',
          toToken: 'EURC',
          amount: 10,
          minReceived: '9.90',
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      onProgress: (state) => progressStates.push(state),
      budgetManaged: true,
      startTime: Date.now(),
    }

    const receipt = await executeCopilotSwapAction(context, { isActive: true })

    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toBe('Quote Requires Confirmation')
    expect(receipt.errorMessage).toContain('approved minimum')
    expect(mockSendTransaction).not.toHaveBeenCalled()
    expect(mockProvider.request).not.toHaveBeenCalled()
    expect(progressStates).not.toContain('broadcasting')
    expect(progressStates).toContain('failed')
  })

  it('refuses autonomous enclave swap without falling back to 0n when minReceived is missing (ARCO-01)', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)

    const mockProvider = { request: vi.fn() }
    const context: CopilotActionContext = {
      actionPayload: {
        type: 'trade',
        title: 'Swap 10 USDC for EURC',
        data: {
          fromToken: 'USDC',
          toToken: 'EURC',
          amount: 10,
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    const receipt = await executeCopilotSwapAction(context, { isActive: true })

    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toBe('Quote Requires Confirmation')
    expect(mockSendTransaction).not.toHaveBeenCalled()
    expect(mockProvider.request).not.toHaveBeenCalled()
  })

  it('refuses autonomous enclave swap without 1:1 fallback when live quote fails or is invalid (ARCO-01)', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)

    const swapService = await import('../../swapService')
    vi.mocked(swapService.getSwapEstimate).mockRejectedValueOnce(new Error('RPC quote timeout'))

    const mockProvider = { request: vi.fn() }
    const context: CopilotActionContext = {
      actionPayload: {
        type: 'trade',
        title: 'Swap 10 USDC for EURC',
        data: {
          fromToken: 'USDC',
          toToken: 'EURC',
          amount: 10,
          minReceived: '9.90',
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    const failedQuoteReceipt = await executeCopilotSwapAction(context, { isActive: true })
    expect(failedQuoteReceipt.status).toBe('FAILED')
    expect(mockSendTransaction).not.toHaveBeenCalled()
    expect(mockProvider.request).not.toHaveBeenCalled()

    vi.mocked(swapService.getSwapEstimate).mockResolvedValueOnce({
      estimatedOutput: '0',
    } as any)

    const invalidQuoteReceipt = await executeCopilotSwapAction(context, { isActive: true })
    expect(invalidQuoteReceipt.status).toBe('FAILED')
    expect(invalidQuoteReceipt.title).toBe('Invalid Swap Quote')
    expect(mockSendTransaction).not.toHaveBeenCalled()
    expect(mockProvider.request).not.toHaveBeenCalled()
  })

  it('executes Yield Vault Deposit autonomously with zero-popup when enclave has USDC balance', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50) // 50 USDC in enclave
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(50)

    const mockProvider = { request: vi.fn() }
    const context: CopilotActionContext = {
      actionPayload: {
        type: 'interactive_deposit',
        title: 'Deposit 15 USDC to Vault',
        data: {
          amount: 15,
          apy: '8.4%',
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    const copilotCommon = await import('../copilotCommon')
    vi.spyOn(copilotCommon, 'getVerifiedArcReceipt').mockResolvedValue({
      status: 'success',
      logs: [],
    } as any)

    const receipt = await executeCopilotDepositAction(context, { isActive: true })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.title).toBe('Deposit Completed Successfully')
    expect(receipt.subtitle).toContain('Zero-Popup')
    expect(receipt.amountIn).toBe(15)
    expect(mockProvider.request).not.toHaveBeenCalled()
  })

  it('does NOT deduct session spend when falling back to primary wallet for send', async () => {
    const deductSpy = vi.spyOn(sessionKeyService, 'deductSessionSpend')
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(0) // 0 in enclave -> triggers fallback

    const mockProvider = {
      request: vi.fn(async ({ method }) => {
        if (method === 'eth_sendTransaction') return MOCK_TX_HASH
        return null
      }),
    }

    const context: CopilotActionContext = {
      actionPayload: {
        type: 'send',
        title: 'Send 10 USDC',
        data: {
          token: 'USDC',
          amount: 10,
          recipient: MOCK_RECIPIENT,
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: false,
      startTime: Date.now(),
    }

    const copilotCommon = await import('../copilotCommon')
    vi.spyOn(copilotCommon, 'readArcSendBalance').mockResolvedValue(100n)
    vi.spyOn(copilotCommon, 'getVerifiedArcReceipt').mockResolvedValue({
      status: 'success',
      logs: [],
    } as any)
    vi.spyOn(copilotCommon, 'verifyArcTokenTransferReceipt').mockReturnValue(true)

    const sendService = await import('../../sendService')
    const sendTokenSpy = vi.spyOn(sendService, 'sendToken').mockResolvedValue({
      txHash: MOCK_TX_HASH,
    } as any)

    const receipt = await executeCopilotSendAction(context, { isActive: true })

    expect(receipt.status).toBe('SUCCESS')
    expect(sendTokenSpy).toHaveBeenCalled()
    // Session budget was NOT deducted because it was a primary wallet fallback!
    expect(deductSpy).not.toHaveBeenCalled()
  })

  it('routes enclave USDC send with memo through Memo.memo(...) contract instead of plain ERC-20 transfer (ARCO-05)', async () => {
    vi.spyOn(sessionKeyService, 'fetchEnclaveUsdcBalance').mockResolvedValue(25)
    vi.spyOn(sessionEnclaveService, 'fetchEnclaveUsdcBalance').mockResolvedValue(25)

    const mockProvider = { request: vi.fn() }
    const context: CopilotActionContext = {
      actionPayload: {
        type: 'interactive_send',
        title: 'Send 5 USDC with memo',
        data: {
          tokenSymbol: 'USDC',
          amount: 5,
          recipient: MOCK_RECIPIENT,
          memo: 'Invoice #42',
        },
      },
      activeWallet: MOCK_WALLET,
      provider: mockProvider,
      budgetManaged: true,
      startTime: Date.now(),
    }

    const copilotCommon = await import('../copilotCommon')
    vi.spyOn(copilotCommon, 'getVerifiedArcReceipt').mockResolvedValue({ status: 'success', logs: [] } as any)
    vi.spyOn(copilotCommon, 'verifyArcTokenTransferReceipt').mockReturnValue(true)

    const receipt = await executeCopilotSendAction(context, { isActive: true })

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.memo).toBe('Invoice #42')
    expect(mockSendTransaction).toHaveBeenCalledTimes(1)
    const txCall = (mockSendTransaction.mock.calls as any[][])[0][0]
    expect(String(txCall.to).toLowerCase()).toBe(MEMO_CONTRACT_ADDRESS.toLowerCase())
    const decoded = decodeFunctionData({ abi: MEMO_ABI, data: txCall.data })
    expect(decoded.functionName).toBe('memo')
    expect(hexToString((decoded.args as any)[3])).toBe('Invoice #42')
    expect(mockProvider.request).not.toHaveBeenCalled()
  })
})
