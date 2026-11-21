import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../sendService', () => ({
  createHeadlessSessionAdapter: vi.fn(() => ({ kind: 'headless-enclave-adapter' })),
  createViemAdapter: vi.fn(async () => ({ kind: 'metamask-provider-adapter' })),
}))

vi.mock('../../sessionKeyService', () => ({
  verifySessionLimits: vi.fn(() => ({ allowed: true })),
}))

vi.mock('../../sessionEnclaveService', () => ({
  getEphemeralSessionAccount: vi.fn(),
  getEphemeralSessionPrivateKey: vi.fn(),
  fetchEnclaveUsdcBalance: vi.fn(),
}))

vi.mock('../../bridgeService', () => ({
  executeBridge: vi.fn(),
}))

vi.mock('../../bridgeUcwService', () => ({
  pollCctpDestinationTx: vi.fn(),
  executeUcwBridgeTransfer: vi.fn(),
}))

vi.mock('../../../utils/history', () => ({
  addTransaction: vi.fn(),
}))

import { createHeadlessSessionAdapter, createViemAdapter } from '../../sendService'
import { verifySessionLimits } from '../../sessionKeyService'
import {
  getEphemeralSessionAccount,
  getEphemeralSessionPrivateKey,
  fetchEnclaveUsdcBalance,
} from '../../sessionEnclaveService'
import { executeBridge } from '../../bridgeService'
import { pollCctpDestinationTx } from '../../bridgeUcwService'
import { executeCopilotBridgeAction } from '../copilotBridgeAction'

const WALLET = '0x1111111111111111111111111111111111111111'
const ENCLAVE_ADDR = '0x2222222222222222222222222222222222222222'
const ENCLAVE_KEY = `0x${'1'.repeat(64)}` as const
const BURN_HASH = `0x${'a'.repeat(64)}`
const MINT_HASH = `0x${'b'.repeat(64)}`

describe('executeCopilotBridgeAction Session Enclave (zero-popup)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(verifySessionLimits).mockReturnValue({ allowed: true })
    vi.mocked(getEphemeralSessionAccount).mockReturnValue({ address: ENCLAVE_ADDR } as any)
    vi.mocked(getEphemeralSessionPrivateKey).mockReturnValue(ENCLAVE_KEY)
    vi.mocked(fetchEnclaveUsdcBalance).mockResolvedValue(50)
    vi.mocked(executeBridge).mockResolvedValue({
      state: 'success',
      burnTxHash: BURN_HASH,
      mintTxHash: MINT_HASH,
    } as any)
    vi.mocked(pollCctpDestinationTx).mockResolvedValue({
      status: 'confirmed',
      destTxHash: MINT_HASH,
      receivedAmount: '10',
    } as any)
  })

  it('uses the headless Session Enclave adapter without opening MetaMask for Arc Testnet bridges', async () => {
    const fakeProvider = { request: vi.fn() }
    const receipt = await executeCopilotBridgeAction(
      {
        actionPayload: {
          type: 'interactive_bridge',
          title: 'Bridge 10 USDC',
          data: { amount: 10, fromChain: 'Arc Testnet', toChain: 'Base Sepolia' },
        },
        activeWallet: WALLET,
        provider: fakeProvider,
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(createHeadlessSessionAdapter).toHaveBeenCalledWith(ENCLAVE_KEY)
    expect(createViemAdapter).not.toHaveBeenCalled()
    expect(executeBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceAdapter: { kind: 'headless-enclave-adapter' },
        recipientAddress: WALLET,
        fromChain: 'Arc_Testnet',
        toChain: 'Base_Sepolia',
        amount: '10',
      }),
      expect.any(Function)
    )
  })

  it('falls back to the connected wallet provider when enclave balance is insufficient', async () => {
    vi.mocked(fetchEnclaveUsdcBalance).mockResolvedValue(2)
    const fakeProvider = { request: vi.fn() }

    const receipt = await executeCopilotBridgeAction(
      {
        actionPayload: {
          type: 'interactive_bridge',
          title: 'Bridge 10 USDC',
          data: { amount: 10, fromChain: 'Arc Testnet', toChain: 'Base Sepolia' },
        },
        activeWallet: WALLET,
        provider: fakeProvider,
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(createHeadlessSessionAdapter).not.toHaveBeenCalled()
    expect(createViemAdapter).toHaveBeenCalledWith(fakeProvider)
  })

  it('uses the connected wallet provider for non-Arc source chains (enclave is Arc-only)', async () => {
    const fakeProvider = { request: vi.fn() }

    await executeCopilotBridgeAction(
      {
        actionPayload: {
          type: 'interactive_bridge',
          title: 'Bridge 10 USDC',
          data: { amount: 10, fromChain: 'Base Sepolia', toChain: 'Arc Testnet' },
        },
        activeWallet: WALLET,
        provider: fakeProvider,
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(createHeadlessSessionAdapter).not.toHaveBeenCalled()
    expect(createViemAdapter).toHaveBeenCalledWith(fakeProvider)
  })
})
