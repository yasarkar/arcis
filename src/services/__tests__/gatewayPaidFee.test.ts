// src/services/__tests__/gatewayPaidFee.test.ts
// The deposit receipt must only ever print the fee the network ACTUALLY charged:
// gasUsed × effectiveGasPrice read back from the mined receipt. Missing receipts or gas
// fields must resolve to undefined (no row) — never an estimate presented as paid.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseUnits } from 'viem'
import { resolvePaidNetworkFee, paidNetworkFeeFromReceipt } from '../gatewayService'
import * as rpcModule from '../rpc'

vi.mock('../rpc', () => ({
  getResilientPublicClient: vi.fn(),
  resilientReadContract: vi.fn(),
  resilientWaitForReceipt: vi.fn(),
}))

const TX = `0x${'a'.repeat(64)}`

beforeEach(() => {
  vi.clearAllMocks()
})

describe('paidNetworkFeeFromReceipt', () => {
  it('converts gasUsed × effectiveGasPrice with the chain native decimals (Arc USDC, 18)', () => {
    // Same real Arc Testnet numbers pinned in arcActualFee.test.ts:
    // 21,000 × 37,755,525,000 wei = 0.000792866025 USDC.
    const fee = paidNetworkFeeFromReceipt(
      { status: 'success', gasUsed: 21000n, effectiveGasPrice: 37755525000n } as any,
      'Arc_Testnet'
    )

    expect(fee).toEqual({ amount: '0.000792866025', symbol: 'USDC' })
  })

  it('uses the destination chain native currency and decimals (Base Sepolia ETH, 18)', () => {
    const fee = paidNetworkFeeFromReceipt(
      { status: 'success', gasUsed: 120000n, effectiveGasPrice: 1000000000n } as any,
      'Base_Sepolia'
    )

    expect(fee).toEqual({ amount: '0.00012', symbol: 'ETH' })
  })

  it('prefers effectiveGasPrice over the legacy gasPrice field', () => {
    const fee = paidNetworkFeeFromReceipt(
      { status: 'success', gasUsed: 21000n, effectiveGasPrice: 37755525000n, gasPrice: 1n } as any,
      'Arc_Testnet'
    )

    expect(fee?.amount).toBe('0.000792866025')
  })

  it('returns undefined for reverted, missing or gas-less receipts — never a fake fee', () => {
    expect(paidNetworkFeeFromReceipt(undefined, 'Arc_Testnet')).toBeUndefined()
    expect(paidNetworkFeeFromReceipt({ status: 'reverted', gasUsed: 21000n, effectiveGasPrice: 1n } as any, 'Arc_Testnet')).toBeUndefined()
    expect(paidNetworkFeeFromReceipt({ status: 'success' } as any, 'Arc_Testnet')).toBeUndefined()
    expect(paidNetworkFeeFromReceipt({ status: 'success', gasUsed: 21000n } as any, 'Arc_Testnet')).toBeUndefined()
  })

  it('formats the exact paid value without rounding (18-decimal chains keep every digit)', () => {
    const fee = paidNetworkFeeFromReceipt(
      { status: 'success', gasUsed: 123456n, effectiveGasPrice: 123456789012345n } as any,
      'Arc_Testnet'
    )

    // Exact product: 123456 × 123,456,789,012,345 wei = 15.24148134430806432 USDC.
    expect(fee?.amount).toBe('15.24148134430806432')
    expect(fee?.symbol).toBe('USDC')
  })
})

describe('resolvePaidNetworkFee', () => {
  it('reads the receipt from the resilient client and returns the exact paid fee', async () => {
    vi.mocked(rpcModule.getResilientPublicClient).mockReturnValue({
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'success',
        gasUsed: 21000n,
        effectiveGasPrice: 37755525000n,
      }),
    } as any)

    await expect(resolvePaidNetworkFee('Arc_Testnet', TX)).resolves.toEqual({
      amount: '0.000792866025',
      symbol: 'USDC',
    })
  })

  it('resolves undefined for malformed hashes without touching the RPC', async () => {
    const client = { getTransactionReceipt: vi.fn() }
    vi.mocked(rpcModule.getResilientPublicClient).mockReturnValue(client as any)

    await expect(resolvePaidNetworkFee('Arc_Testnet', '')).resolves.toBeUndefined()
    await expect(resolvePaidNetworkFee('Arc_Testnet', null)).resolves.toBeUndefined()
    await expect(resolvePaidNetworkFee('Arc_Testnet', '0x1234')).resolves.toBeUndefined()
    expect(client.getTransactionReceipt).not.toHaveBeenCalled()
  })

  it('resolves undefined (no fee row) when the receipt read fails or hangs', async () => {
    vi.mocked(rpcModule.getResilientPublicClient).mockReturnValue({
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
    } as any)

    await expect(resolvePaidNetworkFee('Arc_Testnet', TX)).resolves.toBeUndefined()
  })
})