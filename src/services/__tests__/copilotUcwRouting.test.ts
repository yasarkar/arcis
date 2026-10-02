// src/services/__tests__/copilotUcwRouting.test.ts
// Verifies that Ask Arco routes transactions through the Circle UCW executors when UCW is the
// active auth source, and never silently signs from a passkey/session/injected EOA wallet.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeDirectCopilotAction } from '../copilotExecutionService'
import {
  sendModularUserOperation,
  createModularUsdcTransferCall,
  getModularPublicClient,
  getStoredMscaAddress,
} from '../modularWalletService'
import { sendToken } from '../sendService'
import { deductSessionSpend } from '../sessionKeyService'
import { addTransaction } from '../../utils/history'
import { executeSwap, getSwapEstimate } from '../swapService'
import { ARC_TOKENS } from '../../config/arcChain'
import { POOL_CONTRACTS } from '../../config/poolsConfig'
import { encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem'
import { getResilientPublicClient } from '../rpc'
import { resolveArcNativeRoute } from '../swapService'

vi.mock('../modularWalletService', () => ({
  getStoredMscaAddress: vi.fn(() => ''),
  sendModularUserOperation: vi.fn(),
  createModularUsdcTransferCall: vi.fn(),
  getModularPublicClient: vi.fn(),
  arcTestnetChain: {},
}))

vi.mock('../sendService', () => ({
  createViemAdapter: vi.fn(),
  createHeadlessSessionAdapter: vi.fn(),
  sendToken: vi.fn(),
}))

vi.mock('../swapService', () => ({
  getSwapEstimate: vi.fn(),
  executeSwap: vi.fn(),
  resolveArcNativeRoute: vi.fn(),
}))

vi.mock('../rpc', () => ({
  getResilientPublicClient: vi.fn(() => ({
    getBalance: vi.fn().mockResolvedValue(100_000_000n),
    readContract: vi.fn().mockResolvedValue(100_000_000_000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: TX_HASH,
      status: 'success',
      gasUsed: 21_000n,
      effectiveGasPrice: 20_000_000_000n,
    }),
  })),
}))
vi.mock('../bridgeService', () => ({ executeBridge: vi.fn() }))
vi.mock('../bridgeUcwService', () => ({ executeUcwBridgeTransfer: vi.fn() }))
vi.mock('../../utils/history', () => ({ addTransaction: vi.fn() }))
vi.mock('../../utils/poolVolumeUtils', () => ({ recordClientSwapVolume: vi.fn() }))

vi.mock('../sessionKeyService', () => ({
  getSessionKeyConfig: vi.fn(() => ({
    isActive: false,
    autoExecute: false,
    ephemeralPrivateKey: undefined,
    expiresAt: Date.now() + 3_600_000,
    maxSpendUsdc: 100,
    spentUsdc: 0,
    maxPerTxUsdc: 50,
    allowedActions: [],
  })),
  verifySessionLimits: vi.fn(() => ({ allowed: false, reason: 'Session inactive' })),
  deductSessionSpend: vi.fn(),
}))

const UCW_WALLET = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70'
const TX_HASH = `0x${'a'.repeat(64)}`
const TRANSFER_ABI = [{
  type: 'event', name: 'Transfer',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'value' },
  ],
}] as const

function mockConfirmedTransfer(tokenSymbol = 'USDC', amount = '10') {
  const decimals = tokenSymbol === 'cirBTC' ? 8 : 6
  const tokenAddress = ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS]
  const topics = encodeEventTopics({ abi: TRANSFER_ABI, eventName: 'Transfer', args: { from: UCW_WALLET as `0x${string}`, to: RECIPIENT as `0x${string}` } })
  const data = encodeAbiParameters([{ type: 'uint256' }], [parseUnits(amount, decimals)])
  vi.mocked(getResilientPublicClient).mockReturnValue({
    readContract: vi.fn().mockResolvedValue(100_000_000_000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: TX_HASH, status: 'success', logs: [{ address: tokenAddress, topics, data }] }),
  } as any)
}

const SWAPPED_ABI = [{
  type: 'event', name: 'Swapped',
  inputs: [
    { type: 'address', indexed: true, name: 'user' },
    { type: 'address', indexed: false, name: 'tokenIn' },
    { type: 'uint256', indexed: false, name: 'amountIn' },
    { type: 'uint256', indexed: false, name: 'amountOut' },
  ],
}] as const

function mockConfirmedSwapOutput(amountOut: string) {
  const route = {
    poolAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
    tokenInAddr: POOL_CONTRACTS.USDC,
    tokenOutAddr: POOL_CONTRACTS.EURC,
    decIn: 6,
    decOut: 6,
  }
  vi.mocked(resolveArcNativeRoute).mockReturnValue(route as any)
  const topics = encodeEventTopics({ abi: SWAPPED_ABI, eventName: 'Swapped', args: { user: UCW_WALLET as `0x${string}` } })
  const data = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
    [POOL_CONTRACTS.USDC, parseUnits('10', 6), parseUnits(amountOut, 6)]
  )
  vi.mocked(getResilientPublicClient).mockReturnValue({
    waitForTransactionReceipt: vi.fn().mockResolvedValue({
      transactionHash: TX_HASH,
      status: 'success',
      logs: [{ address: POOL_CONTRACTS.STABLE_SWAP_POOL, topics, data }],
    }),
  } as any)
}

describe('Ask Arco → Circle UCW routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getModularPublicClient).mockReturnValue({
      getTransactionReceipt: vi.fn().mockResolvedValue({
        transactionHash: TX_HASH,
        status: 'success',
        gasUsed: 21_000n,
        effectiveGasPrice: 20_000_000_000n,
      }),
    } as any)
    vi.mocked(getResilientPublicClient).mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(100_000_000n),
      readContract: vi.fn().mockResolvedValue(100_000_000_000n),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({
        transactionHash: TX_HASH,
        status: 'success',
        logs: [],
      }),
    } as any)
    vi.unstubAllGlobals()
  })

  it('executes a send through executeUcwTransfer instead of the passkey/session path', async () => {
    mockConfirmedTransfer()
    const executeUcwTransfer = vi.fn().mockResolvedValue({ success: true, txHash: TX_HASH })

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        data: { recipient: RECIPIENT, amount: 10, tokenSymbol: 'USDC' },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer, executeUcwContract: vi.fn() }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.txHash).toBe(TX_HASH)
    // Gas is omitted when the fee RPC cannot provide receipt gas fields; no estimate is reported as paid.
    expect(receipt.actualGasUsdc).toBeNull()
    expect(receipt.gasUsdc).toBe(0)
    expect(executeUcwTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationAddress: RECIPIENT,
        amount: '10',
        tokenSymbol: 'USDC',
        tokenAddress: '', // Arc Testnet native USDC
        blockchain: 'ARC-TESTNET',
      })
    )
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('fails clearly instead of falling back to window.ethereum when UCW handlers are missing', async () => {
    vi.stubGlobal('window', { ethereum: { request: vi.fn() } })

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        data: { recipient: RECIPIENT, amount: 10, tokenSymbol: 'USDC' },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw' }
    )

    expect(receipt.status).toBe('FAILED')
    expect(receipt.errorMessage).toContain('Circle UCW')
    expect(sendToken).not.toHaveBeenCalled()
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('reports the exact output from the matching successful on-chain swap event, not the quote', async () => {
    mockConfirmedSwapOutput('9.42')
    vi.mocked(getSwapEstimate).mockResolvedValue({
      estimatedOutput: '9.5',
      rate: '0.95',
      stopLimit: '0',
      fees: [],
    })
    vi.mocked(executeSwap).mockResolvedValue({ status: 'DONE', sourceTxHash: TX_HASH })
    const executeUcwContract = vi.fn()

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_swap',
        title: '',
        data: { fromToken: 'USDC', toToken: 'EURC', amount: 10 },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwContract }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.txHash).toBe(TX_HASH)
    expect(receipt.amountOut).toBe(9.42)
    expect(receipt.amountOut).not.toBe(9.5)
    expect(executeSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        authSource: 'ucw',
        executeUcwContract,
        recipientAddress: UCW_WALLET,
      })
    )
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('uses EOA swap output and fee from receipt evidence rather than its quote or synthetic gas', async () => {
    mockConfirmedSwapOutput('9.42')
    vi.mocked(getSwapEstimate).mockResolvedValue({ estimatedOutput: '9.5', rate: '0.95', stopLimit: '0', fees: [] })
    vi.mocked(executeSwap).mockResolvedValue({ status: 'DONE', sourceTxHash: TX_HASH })

    const receipt = await executeDirectCopilotAction(
      { type: 'interactive_swap', title: '', data: { fromToken: 'USDC', toToken: 'EURC', amount: 10 } },
      UCW_WALLET,
      { request: vi.fn() }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.amountOut).toBe(9.42)
    expect(receipt.actualGasUsdc).toBeNull()
    expect(receipt.gasUsdc).toBe(0)
  })

  it('rejects swap precision that cannot be represented by the input token', async () => {
    vi.mocked(resolveArcNativeRoute).mockReturnValue({
      poolAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
      tokenInAddr: POOL_CONTRACTS.USDC,
      tokenOutAddr: POOL_CONTRACTS.EURC,
      decIn: 6,
      decOut: 6,
    } as any)
    const receipt = await executeDirectCopilotAction(
      { type: 'interactive_swap', title: '', data: { fromToken: 'USDC', toToken: 'EURC', amount: 1.0000001 } },
      UCW_WALLET
    )
    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toBe('Invalid Swap Amount')
  })

  it('keeps a mined successful swap PENDING until its matching pool output event is verified', async () => {
    vi.mocked(resolveArcNativeRoute).mockReturnValue({
      poolAddress: POOL_CONTRACTS.STABLE_SWAP_POOL,
      tokenInAddr: POOL_CONTRACTS.USDC,
      tokenOutAddr: POOL_CONTRACTS.EURC,
      decIn: 6,
      decOut: 6,
    } as any)
    vi.mocked(getSwapEstimate).mockResolvedValue({ estimatedOutput: '9.5', rate: '0.95', stopLimit: '0', fees: [] })
    vi.mocked(executeSwap).mockResolvedValue({ status: 'DONE', sourceTxHash: TX_HASH })
    vi.mocked(getResilientPublicClient).mockReturnValue({
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ transactionHash: TX_HASH, status: 'success', logs: [] }),
    } as any)

    const receipt = await executeDirectCopilotAction(
      { type: 'interactive_swap', title: '', data: { fromToken: 'USDC', toToken: 'EURC', amount: 10 } },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwContract: vi.fn() }
    )

    expect(receipt.status).toBe('PENDING')
    expect(receipt.title).toContain('Output Verification Pending')
    expect(receipt.amountOut).toBeUndefined()
  })

  it('rejects a successful transaction with no exact Transfer event without recording spend/history', async () => {
    const executeUcwTransfer = vi.fn().mockResolvedValue({ success: true, txHash: TX_HASH })
    const receipt = await executeDirectCopilotAction(
      { type: 'interactive_send', title: '', data: { recipient: RECIPIENT, amount: 10, tokenSymbol: 'USDC' } },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer }
    )

    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toBe('Transfer Not Verified')
    expect(deductSessionSpend).not.toHaveBeenCalled()
    expect(addTransaction).not.toHaveBeenCalled()
  })

  it('returns PENDING without spending budget/history when the UCW receipt is unavailable', async () => {
    vi.mocked(getResilientPublicClient).mockReturnValue({
      getBalance: vi.fn().mockResolvedValue(100_000_000n),
      readContract: vi.fn().mockResolvedValue(100_000_000_000n),
      waitForTransactionReceipt: vi.fn().mockRejectedValue(new Error('receipt timeout')),
    } as any)
    const executeUcwTransfer = vi.fn().mockResolvedValue({ success: true, txHash: TX_HASH })

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        data: { recipient: RECIPIENT, amount: 10, tokenSymbol: 'USDC' },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer }
    )

    expect(receipt.status).toBe('PENDING')
    expect(receipt.txHash).toBe(TX_HASH)
    expect(deductSessionSpend).not.toHaveBeenCalled()
    expect(addTransaction).not.toHaveBeenCalled()
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })

  it('canonicalizes a cirBTC UCW send and passes its real Arc ERC-20 address', async () => {
    mockConfirmedTransfer('cirBTC', '0.0001')
    const executeUcwTransfer = vi.fn().mockResolvedValue({ success: true, txHash: TX_HASH })

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        // The model may return the upper-case form; the executor must canonicalize it to cirBTC.
        data: { recipient: RECIPIENT, amount: 0.0001, tokenSymbol: 'CIRBTC' },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer, executeUcwContract: vi.fn() }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.fromToken).toBe('cirBTC')
    expect(executeUcwTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenSymbol: 'cirBTC',
        // Never '' — an empty address means a native USDC transfer on Arc.
        tokenAddress: ARC_TOKENS.cirBTC,
        blockchain: 'ARC-TESTNET',
      })
    )
  })

  it('refuses a WBTC send outright so UCW never falls back to a native USDC transfer', async () => {
    const executeUcwTransfer = vi.fn()

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        data: { recipient: RECIPIENT, amount: 0.0001, tokenSymbol: 'WBTC' },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer, executeUcwContract: vi.fn() }
    )

    expect(receipt.status).toBe('FAILED')
    expect(receipt.errorMessage).toContain('WBTC is not available on Arc Testnet')
    expect(executeUcwTransfer).not.toHaveBeenCalled()
    expect(sendToken).not.toHaveBeenCalled()
  })

  it('moves cirBTC as an ERC-20 (not native USDC) from the passkey/session wallet', async () => {
    mockConfirmedTransfer('cirBTC', '0.0001')
    vi.mocked(getStoredMscaAddress).mockReturnValue(UCW_WALLET)
    vi.mocked(sendModularUserOperation).mockResolvedValue({ success: true, txHash: TX_HASH })

    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        data: { recipient: RECIPIENT, amount: 0.0001, tokenSymbol: 'cirBTC' },
      },
      UCW_WALLET
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.fromToken).toBe('cirBTC')
    // The native USDC transfer helper must never be used for a non-USDC asset.
    expect(createModularUsdcTransferCall).not.toHaveBeenCalled()
    const [{ calls }] = vi.mocked(sendModularUserOperation).mock.calls[0]
    expect(calls[0].to).toBe(ARC_TOKENS.cirBTC)
  })

  it('refuses a zero-address and a self transfer before touching any signer', async () => {
    const executeUcwTransfer = vi.fn()
    const base = { authSource: 'ucw' as const, executeUcwTransfer, executeUcwContract: vi.fn() }

    const zero = await executeDirectCopilotAction(
      { type: 'interactive_send', title: '', data: { recipient: '0x0000000000000000000000000000000000000000', amount: 10, tokenSymbol: 'USDC' } },
      UCW_WALLET,
      undefined,
      undefined,
      base
    )
    expect(zero.status).toBe('FAILED')
    expect(zero.errorMessage).toMatch(/zero address/i)

    const self = await executeDirectCopilotAction(
      { type: 'interactive_send', title: '', data: { recipient: UCW_WALLET, amount: 10, tokenSymbol: 'USDC' } },
      UCW_WALLET,
      undefined,
      undefined,
      base
    )
    expect(self.status).toBe('FAILED')
    expect(self.errorMessage).toMatch(/own wallet/i)
    expect(executeUcwTransfer).not.toHaveBeenCalled()
  })

  it('refuses a zero amount instead of sending the old silent default of 1', async () => {
    const executeUcwTransfer = vi.fn()
    const receipt = await executeDirectCopilotAction(
      { type: 'interactive_send', title: '', data: { recipient: RECIPIENT, amount: 0, tokenSymbol: 'USDC' } },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer, executeUcwContract: vi.fn() }
    )

    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toBe('Invalid Transfer Amount')
    expect(executeUcwTransfer).not.toHaveBeenCalled()
  })

  it('refuses a memo on a Circle UCW transfer instead of dropping it silently', async () => {
    const executeUcwTransfer = vi.fn()
    const receipt = await executeDirectCopilotAction(
      {
        type: 'interactive_send',
        title: '',
        data: { recipient: RECIPIENT, amount: 10, tokenSymbol: 'USDC', memo: 'Invoice #7' },
      },
      UCW_WALLET,
      undefined,
      undefined,
      { authSource: 'ucw', executeUcwTransfer, executeUcwContract: vi.fn() }
    )

    expect(receipt.status).toBe('FAILED')
    expect(receipt.errorMessage).toMatch(/Memos cannot be attached/i)
    expect(executeUcwTransfer).not.toHaveBeenCalled()
  })
})
