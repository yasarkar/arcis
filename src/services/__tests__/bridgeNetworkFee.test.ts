// src/services/__tests__/bridgeNetworkFee.test.ts
// The bridge receipt's Network Fee must be the real gas paid on the mined source
// transaction (gasUsed × effectiveGasPrice) — never an estimate — and must be
// omitted (undefined) whenever it cannot be verified.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@circle-fin/app-kit', () => ({
  AppKit: class {
    on = vi.fn()
    off = vi.fn()
    bridge = vi.fn()
    estimateBridge = vi.fn()
    getSupportedChains = vi.fn(() => [])
  },
}))

const { receiptMock } = vi.hoisted(() => ({ receiptMock: vi.fn() }))

vi.mock('../rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rpc')>()),
  getResilientPublicClient: vi.fn(() => ({ getTransactionReceipt: receiptMock })),
}))

vi.mock('../arcGasService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../arcGasService')>()),
  resolveArcActualFeeUsdc: vi.fn(),
}))

import { resolveBridgeNetworkFee } from '../bridgeService'
import { resolveArcActualFeeUsdc } from '../arcGasService'

const TX = `0x${'ab'.repeat(32)}`

describe('resolveBridgeNetworkFee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the exact Arc USDC fee ArcScan displays', async () => {
    vi.mocked(resolveArcActualFeeUsdc).mockResolvedValue({
      feeUsdcExact: '0.0000198',
    } as any)

    expect(await resolveBridgeNetworkFee('Arc_Testnet', TX)).toBe('0.0000198 USDC')
    expect(receiptMock).not.toHaveBeenCalled()
  })

  it('returns undefined for Arc when the fee could not be verified', async () => {
    vi.mocked(resolveArcActualFeeUsdc).mockResolvedValue({ feeUsdcExact: null } as any)

    expect(await resolveBridgeNetworkFee('Arc_Testnet', TX)).toBeUndefined()
  })

  it('reads gasUsed × effectiveGasPrice from the receipt for non-Arc chains', async () => {
    // 21_000 gas × 20 gwei = 0.00042 ETH
    receiptMock.mockResolvedValue({
      gasUsed: 21_000n,
      effectiveGasPrice: 20_000_000_000n,
    })

    expect(await resolveBridgeNetworkFee('Base_Sepolia', TX)).toBe('0.00042 ETH')
  })

  it('returns undefined (never an estimate) when the receipt lacks gas fields', async () => {
    receiptMock.mockResolvedValue({})

    expect(await resolveBridgeNetworkFee('Base_Sepolia', TX)).toBeUndefined()
  })

  it('returns undefined for a missing or malformed hash without touching RPC', async () => {
    expect(await resolveBridgeNetworkFee('Base_Sepolia', undefined)).toBeUndefined()
    expect(await resolveBridgeNetworkFee('Base_Sepolia', '0xnope')).toBeUndefined()

    expect(receiptMock).not.toHaveBeenCalled()
    expect(resolveArcActualFeeUsdc).not.toHaveBeenCalled()
  })

  it('swallows RPC failures instead of surfacing a guessed value', async () => {
    receiptMock.mockRejectedValue(new Error('node down'))

    expect(await resolveBridgeNetworkFee('Base_Sepolia', TX)).toBeUndefined()
  })
})
