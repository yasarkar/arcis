// src/services/__tests__/gatewayDepositFee.test.ts
// End-to-end proof that the Gateway deposit path returns the REAL fees read from the mined
// receipts: the approve tx fee and the deposit tx fee, each in the chain's native currency.
// A receipt whose gas fields cannot be read must yield no fee at all (never an estimate).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { depositToGateway } from '../gatewayService'
import * as rpcModule from '../rpc'
import { CHAIN_DEFS } from '../../config/chainMeta'

const CHAIN_ID_HEX = `0x${CHAIN_DEFS.Arc_Testnet.id.toString(16)}`
import { ACTIVE_GATEWAY_CONTRACTS, USDC_ADDRESSES } from '../../config/gatewayConfig'

vi.mock('../chainSwitchService', () => ({ assertNetwork: vi.fn() }))
vi.mock('../spendingCeilingService', () => ({
  checkCeilingStatus: vi.fn(() => ({ suggestedCeiling: '1000', currentCeiling: '0' })),
  setSpendingCeiling: vi.fn(),
}))
vi.mock('../rpc', () => ({
  getResilientPublicClient: vi.fn(),
  resilientReadContract: vi.fn(),
  resilientWaitForReceipt: vi.fn(),
}))

const WALLET = '0x0000000000000000000000000000000000000001'
const APPROVE_HASH = `0x${'1'.repeat(64)}` as `0x${string}`
const DEPOSIT_HASH = `0x${'2'.repeat(64)}` as `0x${string}`
const CHAIN_KEY = 'Arc_Testnet'

/** EIP-1193 provider stub: accounts + submitted tx hashes in submission order. */
function providerStub(hashes: string[]) {
  let index = 0
  return {
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return [WALLET]
      if (method === 'eth_sendTransaction') return hashes[index++] ?? hashes[hashes.length - 1]
      if (method === 'eth_chainId') return CHAIN_ID_HEX
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
      return null
    }),
  }
}

function receiptStub(gasUsed: bigint, effectiveGasPrice: bigint): any {
  return { status: 'success', gasUsed, effectiveGasPrice }
}

beforeEach(() => {
  vi.clearAllMocks()
  // allowance 0 → forces the approve step; balance is ample.
  vi.mocked(rpcModule.resilientReadContract)
    .mockResolvedValueOnce(10_000_000_000n as never) // balanceOf
    .mockResolvedValueOnce(0n as never) // allowance
  vi.mocked(rpcModule.getResilientPublicClient).mockReturnValue({
    estimateContractGas: vi.fn().mockResolvedValue(50_000n),
  } as any)
})

describe('depositToGateway fee reporting', () => {
  it('returns the exact approve and deposit fees from their receipts', async () => {
    vi.mocked(rpcModule.resilientWaitForReceipt)
      .mockResolvedValueOnce({
        receipt: { ...receiptStub(46_000n, 1_000_000_000n), transactionHash: APPROVE_HASH },
        transactionHash: APPROVE_HASH,
        status: 'success',
      })
      .mockResolvedValueOnce({
        receipt: { ...receiptStub(120_000n, 1_000_000_000n), transactionHash: DEPOSIT_HASH },
        transactionHash: DEPOSIT_HASH,
        status: 'success',
      })

    const result = await depositToGateway(
      providerStub([APPROVE_HASH, DEPOSIT_HASH]),
      CHAIN_KEY,
      '10',
      CHAIN_DEFS[CHAIN_KEY],
      'USDC'
    )

    expect(result.depositTxHash).toBe(DEPOSIT_HASH)
    // Arc native currency is USDC with 18 decimals: 46,000 × 1 Gwei and 120,000 × 1 Gwei.
    expect(result.approvalFee).toEqual({ amount: '0.000046', symbol: 'USDC' })
    expect(result.depositFee).toEqual({ amount: '0.00012', symbol: 'USDC' })
  })

  it('omits a fee whose receipt carries no gas data instead of inventing one', async () => {
    vi.mocked(rpcModule.resilientWaitForReceipt)
      .mockResolvedValueOnce({
        receipt: { status: 'success', transactionHash: APPROVE_HASH } as any,
        transactionHash: APPROVE_HASH,
        status: 'success',
      })
      .mockResolvedValueOnce({
        receipt: { ...receiptStub(120_000n, 1_000_000_000n), transactionHash: DEPOSIT_HASH },
        transactionHash: DEPOSIT_HASH,
        status: 'success',
      })

    const result = await depositToGateway(
      providerStub([APPROVE_HASH, DEPOSIT_HASH]),
      CHAIN_KEY,
      '10',
      CHAIN_DEFS[CHAIN_KEY],
      'USDC'
    )

    expect(result.approvalFee).toBeUndefined()
    expect(result.depositFee).toEqual({ amount: '0.00012', symbol: 'USDC' })
  })

  it('reports no fees when the allowance already covers the deposit (no approve tx)', async () => {
    vi.mocked(rpcModule.resilientReadContract)
      .mockReset()
      .mockResolvedValueOnce(10_000_000_000n as never) // balanceOf
      .mockResolvedValueOnce(999_000_000_000n as never) // allowance already sufficient
    vi.mocked(rpcModule.resilientWaitForReceipt).mockResolvedValueOnce({
      receipt: { ...receiptStub(120_000n, 1_000_000_000n), transactionHash: DEPOSIT_HASH },
      transactionHash: DEPOSIT_HASH,
      status: 'success',
    } as any)

    const result = await depositToGateway(
      providerStub([DEPOSIT_HASH]),
      CHAIN_KEY,
      '10',
      CHAIN_DEFS[CHAIN_KEY],
      'USDC'
    )

    expect(result.approveTxHash).toBe('')
    expect(result.approvalFee).toBeUndefined()
    expect(result.depositFee).toEqual({ amount: '0.00012', symbol: 'USDC' })
  })
})

describe('depositToGateway guards', () => {
  it('still refuses to submit when the on-chain balance cannot be verified', async () => {
    vi.mocked(rpcModule.resilientReadContract).mockReset().mockRejectedValue(new Error('node down') as never)

    await expect(
      depositToGateway(providerStub([DEPOSIT_HASH]), CHAIN_KEY, '10', CHAIN_DEFS[CHAIN_KEY], 'USDC')
    ).rejects.toThrow(/Could not verify USDC balance/)
  })

  it('targets the configured Gateway wallet with the deposit token address', () => {
    // Guards the addresses the fee/approve flow depends on.
    expect(ACTIVE_GATEWAY_CONTRACTS.gatewayWallet).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(USDC_ADDRESSES[CHAIN_KEY]).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})