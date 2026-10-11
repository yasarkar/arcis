import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, parseUnits } from 'viem'
import { executeSwap, getSwapEstimate } from '../swapService'
import { STABLE_SWAP_ABI } from '../../config/poolsConfig'
const harness = vi.hoisted(() => ({ write: vi.fn(), mode: 'ucw', reserve: 100_000_000_000n }))
vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(), createWalletClient: () => ({ writeContract: harness.write }) }))
vi.mock('../rpc', () => ({ getArcPublicClient: () => ({}), getResilientPublicClient: () => ({}),
  resilientReadContract: vi.fn(async (_client, params) => params.functionName === 'allowance' ? 0n : harness.reserve),
  resilientWaitForReceipt: vi.fn(async (_client, hash) => ({ status: 'success', receipt: { transactionHash: hash, status: 'success' } })),
}))
vi.mock('../modularWalletService', () => ({ getActiveSmartAccount: () => harness.mode === 'passkey' ? { address: WALLET } : null,
  restoreSmartAccount: async () => null, sendModularUserOperation: vi.fn(async () => ({ success: true, txHash: HASH })),
}))
vi.mock('../../config/feeTiers', () => ({ getDynamicArcGasOptions: async () => ({ maxFeePerGas: 20_000_000_000n, maxPriorityFeePerGas: 0n }), ARC_GAS_LIMITS: { contractInteraction: 300000n } }))
vi.mock('../../utils/poolVolumeUtils', () => ({ recordClientSwapVolumeForPair: vi.fn() }))
import { sendModularUserOperation } from '../modularWalletService'
import { resilientReadContract } from '../rpc'
const WALLET = '0x1111111111111111111111111111111111111111'
const HASH = `0x${'a'.repeat(64)}`
const params = { fromChain: 'Arc_Testnet', tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '10', senderAddress: WALLET, recipientAddress: WALLET }
beforeEach(() => {
  vi.clearAllMocks(); harness.reserve = 100_000_000_000n
  harness.write.mockResolvedValue(HASH)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
})
afterEach(() => vi.unstubAllGlobals())

describe('A03 signed calldata keeps the card minimum', () => {
  it.each([10, 50, 100, 200])('preserves %s bps for actual EOA, UCW and MSCA signers', async slippageBps => {
    const quote = await getSwapEstimate({ ...params, slippageBps })
    const expected = parseUnits(quote.stopLimit, 6)
    for (const mode of ['ucw', 'evm', 'passkey'] as const) {
      harness.mode = mode; harness.write.mockClear(); vi.mocked(sendModularUserOperation).mockClear()
      const ucw = vi.fn(async (_call: any) => ({ success: true, txHash: HASH }))
      const status = await executeSwap({ ...params, slippageBps, minimumOutput: quote.stopLimit, authSource: mode,
        sourceAdapter: mode === 'evm' ? { address: WALLET, provider: { request: vi.fn() } } : undefined, executeUcwContract: ucw })
      expect(status.status).toBe('DONE')
      if (mode === 'ucw') expect(ucw.mock.calls.find(c => c[0].abiFunctionSignature?.startsWith('swapWithFee'))?.[0].abiParameters?.[4]).toBe(expected.toString())
      if (mode === 'evm') expect(harness.write.mock.calls.find(c => c[0].functionName === 'swapWithFee')?.[0].args[4]).toBe(expected)
      if (mode === 'passkey') {
        const call = vi.mocked(sendModularUserOperation).mock.calls[0][0].calls[1]
        if (!call.data) throw new Error('Missing swap calldata')
        expect(decodeFunctionData({ abi: STABLE_SWAP_ABI, data: call.data }).args?.[3]).toBe(expected)
      }
    }
  })

  it.each(['ucw', 'evm'] as const)('never lowers the minimum after %s approval changes the market', async mode => {
    harness.mode = mode
    const quote = await getSwapEstimate({ ...params, slippageBps: 100 })
    // Shrink both reserves after approval: price impact increases enough to fall below the card minimum.
    const ucw = vi.fn(async (call: any) => { if (call.abiFunctionSignature?.startsWith('approve')) harness.reserve = 10_000_000n; return { success: true, txHash: HASH } })
    harness.write.mockImplementation(async (call: any) => { if (call.functionName === 'approve') harness.reserve = 10_000_000n; return HASH })
    const status = await executeSwap({ ...params, slippageBps: 100, minimumOutput: quote.stopLimit, authSource: mode,
      sourceAdapter: mode === 'evm' ? { address: WALLET, provider: { request: vi.fn() } } : undefined, executeUcwContract: ucw })
    expect(status.status).toBe('FAILED')
    expect(status.errorMessage).toContain('approved minimum')
    expect(ucw.mock.calls.filter(c => c[0].abiFunctionSignature?.startsWith('swapWithFee'))).toHaveLength(0)
    expect(harness.write.mock.calls.filter(c => c[0].functionName === 'swapWithFee')).toHaveLength(0)
  })

  it('rejects invalid tolerance before reserve reads or any signer', async () => {
    const status = await executeSwap({ ...params, slippageBps: 1 })
    expect(status.status).toBe('FAILED')
    expect(resilientReadContract).not.toHaveBeenCalled()
    expect(sendModularUserOperation).not.toHaveBeenCalled()
  })
})
