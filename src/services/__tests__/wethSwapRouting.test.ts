import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveArcNativeRoute, getSwapEstimate } from '../swapService'
import { POOL_CONTRACTS, WETH_CONSTANT_PRODUCT_LP_FEE_BPS } from '../../config/poolsConfig'
import { parseUnits, formatUnits } from 'viem'

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

import { resilientReadContract } from '../rpc'

describe('WETH / USDC Swap Route & Math on Arc Testnet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resilientReadContract).mockReset()
  })

  it('resolves the on-chain WETH pool route for USDC -> WETH', () => {
    const route = resolveArcNativeRoute('USDC', 'WETH')
    expect(route).not.toBeNull()
    expect(route?.poolAddress.toLowerCase()).toBe(POOL_CONTRACTS.WETH_POOL.toLowerCase())
    expect(route?.isStable).toBe(false)
    expect(route?.tokenInAddr.toLowerCase()).toBe(POOL_CONTRACTS.USDC.toLowerCase())
    expect(route?.tokenOutAddr.toLowerCase()).toBe(POOL_CONTRACTS.WETH.toLowerCase())
    expect(route?.decIn).toBe(6)
    expect(route?.decOut).toBe(18)
    expect(route?.feeBps).toBe(WETH_CONSTANT_PRODUCT_LP_FEE_BPS)
    expect(route?.feeBps).toBe(30n)
  })

  it('resolves the on-chain WETH pool route for WETH -> USDC', () => {
    const route = resolveArcNativeRoute('WETH', 'USDC')
    expect(route).not.toBeNull()
    expect(route?.poolAddress.toLowerCase()).toBe(POOL_CONTRACTS.WETH_POOL.toLowerCase())
    expect(route?.isStable).toBe(false)
    expect(route?.tokenInAddr.toLowerCase()).toBe(POOL_CONTRACTS.WETH.toLowerCase())
    expect(route?.tokenOutAddr.toLowerCase()).toBe(POOL_CONTRACTS.USDC.toLowerCase())
    expect(route?.decIn).toBe(18)
    expect(route?.decOut).toBe(6)
    expect(route?.feeBps).toBe(30n)
  })

  it('accepts ETH as an alias for WETH in swap routing', () => {
    const routeIn = resolveArcNativeRoute('ETH', 'USDC')
    const routeOut = resolveArcNativeRoute('USDC', 'ETH')
    expect(routeIn).not.toBeNull()
    expect(routeOut).not.toBeNull()
    expect(routeIn?.tokenInAddr.toLowerCase()).toBe(POOL_CONTRACTS.WETH.toLowerCase())
    expect(routeOut?.tokenOutAddr.toLowerCase()).toBe(POOL_CONTRACTS.WETH.toLowerCase())
  })

  it('calculates accurate swap estimate for USDC -> WETH with constant product math and 30 bps fee', async () => {
    // Mock reserves: 250 USDC (250_000_000 units) and 0.1 WETH (100_000_000_000_000_000 units)
    const reserveA = 250_000_000n
    const reserveB = 100_000_000_000_000_000n

    vi.mocked(resilientReadContract)
      .mockResolvedValueOnce(reserveA)
      .mockResolvedValueOnce(reserveB)

    const amountIn = '10' // 10 USDC
    const estimate = await getSwapEstimate({
      fromChain: 'Arc_Testnet',
      tokenIn: 'USDC',
      tokenOut: 'WETH',
      amountIn,
    })

    // Expected math:
    // amountInUnits = 10_000_000n
    // fee = (10_000_000 * 30) / 10000 = 30_000n
    // netIn = 9_970_000n
    // amountOutUnits = (reserveB * netIn) / (reserveA + netIn)
    // = (100_000_000_000_000_000 * 9_970_000) / (250_000_000 + 9_970_000)
    // = 997_000_000_000_000_000_000_000 / 259_970_000 = 3_835_057_891_295_149n (~0.003835 WETH)
    const expectedOutUnits = (reserveB * 9_970_000n) / (reserveA + 9_970_000n)
    const expectedOutStr = formatUnits(expectedOutUnits, 18)

    expect(estimate.estimatedOutput).toBe(expectedOutStr)
    expect(parseFloat(estimate.estimatedOutput)).toBeGreaterThan(0)
    expect(estimate.fees.length).toBe(1)
    expect(estimate.fees[0].type).toBe('swap')
    expect(estimate.fees[0].token).toBe('USDC')
    expect(estimate.fees[0].amount).toBe('0.03') // 0.30% of 10 USDC = 0.03 USDC
  })

  it('calculates accurate swap estimate for WETH -> USDC with 18-dec in and 6-dec out', async () => {
    const reserveA = 250_000_000n // USDC
    const reserveB = 100_000_000_000_000_000n // WETH (0.1 WETH)

    vi.mocked(resilientReadContract)
      .mockResolvedValueOnce(reserveA)
      .mockResolvedValueOnce(reserveB)

    const amountIn = '0.01' // 0.01 WETH (10_000_000_000_000_000 units)
    const estimate = await getSwapEstimate({
      fromChain: 'Arc_Testnet',
      tokenIn: 'WETH',
      tokenOut: 'USDC',
      amountIn,
    })

    // amountInUnits = 10_000_000_000_000_000n
    // fee = (10_000_000_000_000_000 * 30) / 10000 = 30_000_000_000_000n
    // netIn = 9_970_000_000_000_000n
    // amountOutUnits = (reserveA * netIn) / (reserveB + netIn)
    // = (250_000_000 * 9_970_000_000_000_000) / (100_000_000_000_000_000 + 9_970_000_000_000_000)
    // = 22_665_272n units USDC = 22.665272 USDC
    const netIn = 10_000_000_000_000_000n - (10_000_000_000_000_000n * 30n) / 10000n
    const expectedOutUnits = (reserveA * netIn) / (reserveB + netIn)
    const expectedOutStr = formatUnits(expectedOutUnits, 6)

    expect(estimate.estimatedOutput).toBe(expectedOutStr)
    expect(parseFloat(estimate.estimatedOutput)).toBeCloseTo(22.66, 1)
  })
})
