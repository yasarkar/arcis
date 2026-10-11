import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseUnits } from 'viem'
import { getSwapEstimate } from '../swapService'

vi.mock('../rpc', () => ({
  getArcPublicClient: vi.fn(() => ({})), getResilientPublicClient: vi.fn(() => ({})),
  resilientReadContract: vi.fn(), resilientWaitForReceipt: vi.fn(),
}))
vi.mock('../modularWalletService', () => ({
  getActiveSmartAccount: vi.fn(() => null), restoreSmartAccount: vi.fn(async () => null), sendModularUserOperation: vi.fn(),
}))
import { resilientReadContract } from '../rpc'

beforeEach(() => { vi.mocked(resilientReadContract).mockReset().mockResolvedValue(100_000_000_000n) })
const params = { fromChain: 'Arc_Testnet', tokenIn: 'USDC', tokenOut: 'EURC', amountIn: '100' }

describe('A03 strict swap slippage (no silent clamp)', () => {
  it.each([10, 50, 100, 150, 200])('honors %s bps exactly in canonical and legacy fraction quotes', async bps => {
    const canonical = await getSwapEstimate({ ...params, slippageBps: bps })
    const legacy = await getSwapEstimate({ ...params, slippageTolerance: bps / 10000 })
    expect(legacy).toEqual(canonical)
    expect(parseUnits(canonical.stopLimit, 6)).toBe(parseUnits(canonical.estimatedOutput, 6) * BigInt(10000 - bps) / 10000n)
  })
  it.each([0.5, 50, 1000, 0.03, -5, 0.00001, NaN, Infinity, 0])('rejects explicit out-of-band fraction %s before RPC', async slippageTolerance => {
    await expect(getSwapEstimate({ ...params, slippageTolerance })).rejects.toThrow(/slippage|tolerans/i)
    expect(resilientReadContract).not.toHaveBeenCalled()
  })
  it('uses the protocol default only when tolerance is absent', async () => {
    expect(await getSwapEstimate(params)).toEqual(await getSwapEstimate({ ...params, slippageBps: 50 }))
  })
  it('rejects contradictory canonical and legacy fields', async () => {
    await expect(getSwapEstimate({ ...params, slippageBps: 10, slippageTolerance: 0.01 })).rejects.toThrow('Conflicting')
  })
})
