import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSwapEstimate } from '../swapService'

vi.mock('../rpc', () => ({
  getArcPublicClient: vi.fn(() => ({})),
  getResilientPublicClient: vi.fn(() => ({})),
  resilientReadContract: vi.fn(),
  resilientWaitForReceipt: vi.fn(),
}))

vi.mock('../modularWalletService', () => ({
  getActiveSmartAccount: vi.fn(() => null),
  restoreSmartAccount: vi.fn(async () => null),
  sendModularUserOperation: vi.fn(),
}))

import { resilientReadContract } from '../rpc'

const RESERVE = 100_000_000_000n // 100,000 units on both sides

async function quote(slippageTolerance?: number) {
  vi.mocked(resilientReadContract)
    .mockResolvedValueOnce(RESERVE)
    .mockResolvedValueOnce(RESERVE)
  return getSwapEstimate({
    fromChain: 'Arc_Testnet',
    tokenIn: 'USDC',
    tokenOut: 'EURC',
    amountIn: '100',
    ...(slippageTolerance !== undefined ? { slippageTolerance } : {}),
  })
}

function stopLimitRatio(result: { stopLimit: string; estimatedOutput: string }) {
  const stop = parseFloat(result.stopLimit)
  const out = parseFloat(result.estimatedOutput)
  expect(Number.isFinite(stop)).toBe(true)
  expect(stop).toBeGreaterThan(0)
  expect(stop).toBeLessThan(out)
  return stop / out
}

describe('Swap slippage clamping (audit fix #5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caps a 50% custom tolerance (0.5) at the 10% pool maximum instead of a negative min-out', async () => {
    const result = await quote(0.5)
    expect(stopLimitRatio(result)).toBeCloseTo(0.9, 4)
  })

  it('caps absurd out-of-band values (50 = 5000%, 1000 = 100000%) as well', async () => {
    expect(stopLimitRatio(await quote(50))).toBeCloseTo(0.9, 4)
    expect(stopLimitRatio(await quote(1000))).toBeCloseTo(0.9, 4)
  })

  it('falls back to the 0.5% default for a negative tolerance', async () => {
    const result = await quote(-5)
    expect(stopLimitRatio(result)).toBeCloseTo(0.995, 4)
  })

  it('falls back to the 0.5% default when no tolerance is provided', async () => {
    const result = await quote(undefined)
    expect(stopLimitRatio(result)).toBeCloseTo(0.995, 4)
  })

  it('keeps in-band tolerances exact: 1% (0.01) → 100 bps, 0.1% (0.001) → 10 bps', async () => {
    expect(stopLimitRatio(await quote(0.01))).toBeCloseTo(0.99, 4)
    expect(stopLimitRatio(await quote(0.001))).toBeCloseTo(0.999, 4)
  })

  it('floors a sub-minimum tolerance (0.001%) at 10 bps instead of 0 bps', async () => {
    expect(stopLimitRatio(await quote(0.00001))).toBeCloseTo(0.999, 4)
  })
})
