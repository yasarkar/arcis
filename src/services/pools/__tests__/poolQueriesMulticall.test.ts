import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseUnits } from 'viem'

const {
  multicallMock,
  readContractMock,
  getArcPublicClientMock,
  isLivePriceAvailableMock,
} = vi.hoisted(() => ({
  multicallMock: vi.fn(),
  readContractMock: vi.fn(),
  getArcPublicClientMock: vi.fn(() => ({ chain: { id: 5042002 } })),
  isLivePriceAvailableMock: vi.fn(() => true),
}))

vi.mock('../../rpc', () => ({
  getArcPublicClient: getArcPublicClientMock,
  resilientMulticall: multicallMock,
  resilientReadContract: readContractMock,
}))

vi.mock('../../tokenPriceService', () => ({
  getCachedTokenPrice: vi.fn((sym: string) => {
    if (sym === 'EURC') return 1.1
    if (sym === 'BTC') return 80_000
    if (sym === 'WETH' || sym === 'ETH') return 2_500
    return 1
  }),
  getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1.1, BTC: 80_000, WETH: 2_500 })),
  isLivePriceAvailable: isLivePriceAvailableMock,
}))

import {
  fetchOnchainPoolBalances,
  fetchUserPoolPositions,
  onchainPoolBalancesQueryKey,
  prefetchUserWalletPoolsData,
  userPoolPositionsQueryKey,
} from '../poolQueries'
import { POOL_CONTRACTS } from '../../../config/poolsConfig'

const WALLET_MIXED = '0xAbCd000000000000000000000000000000000123'
const WALLET_LOWER = WALLET_MIXED.toLowerCase()

describe('poolQueries Multicall3 batching & key normalization', () => {
  beforeEach(() => {
    multicallMock.mockReset()
    readContractMock.mockReset()
    isLivePriceAvailableMock.mockReturnValue(true)
  })

  it('batches all 4 Arc Testnet token balances into a single Multicall3 call', async () => {
    multicallMock.mockResolvedValueOnce([
      { status: 'success', result: parseUnits('125.5', 6) },
      { status: 'success', result: parseUnits('40.25', 6) },
      { status: 'success', result: parseUnits('0.012345', 8) },
      { status: 'success', result: parseUnits('1.5', 18) },
    ])

    const balances = await fetchOnchainPoolBalances(WALLET_MIXED)

    expect(multicallMock).toHaveBeenCalledTimes(1)
    expect(readContractMock).not.toHaveBeenCalled()
    const [, calls] = multicallMock.mock.calls[0]
    expect(calls).toHaveLength(4)
    expect(calls.map((c: any) => c.args[0])).toEqual([
      WALLET_LOWER,
      WALLET_LOWER,
      WALLET_LOWER,
      WALLET_LOWER,
    ])
    expect(balances).toEqual({
      usdc: '125.50',
      eurc: '40.25',
      cirbtc: '0.012345',
      weth: '1.5000',
    })
  })

  it('isolates per-token multicall failures without zeroing healthy tokens', async () => {
    multicallMock.mockResolvedValueOnce([
      { status: 'success', result: parseUnits('50', 6) },
      { status: 'failure', error: new Error('EURC revert') },
      { status: 'success', result: 0n },
      { status: 'failure', error: new Error('WETH revert') },
    ])

    const balances = await fetchOnchainPoolBalances(WALLET_MIXED)

    expect(multicallMock).toHaveBeenCalledTimes(1)
    expect(balances).toEqual({
      usdc: '50.00',
      eurc: '0.00',
      cirbtc: '0.000000',
      weth: '0.0000',
    })
  })

  it('reads all deployed pool positions in a single Multicall3 call when vault balance is zero', async () => {
    multicallMock.mockImplementationOnce(async (_client: unknown, calls: Array<any>) =>
      calls.map((call) => {
        if (call.address === POOL_CONTRACTS.STABLE_SWAP_POOL) {
          if (call.functionName === 'balanceOf') return { status: 'success', result: parseUnits('100', 18) }
          if (call.functionName === 'reserveA') return { status: 'success', result: parseUnits('1000', 6) }
          if (call.functionName === 'reserveB') return { status: 'success', result: parseUnits('1000', 6) }
          if (call.functionName === 'totalLp') return { status: 'success', result: parseUnits('1000', 18) }
          if (call.functionName === 'unclaimedFeeA') return { status: 'success', result: parseUnits('10', 6) }
          if (call.functionName === 'unclaimedFeeB') return { status: 'success', result: parseUnits('10', 6) }
          if (call.functionName === 'pendingFees') {
            return { status: 'success', result: [parseUnits('2', 6), parseUnits('1', 6)] as const }
          }
        }
        if (call.functionName === 'decimals') return { status: 'success', result: 6 }
        if (call.functionName === 'pendingFees') return { status: 'success', result: [0n, 0n] as const }
        return { status: 'success', result: 0n }
      })
    )

    const positions = await fetchUserPoolPositions(WALLET_MIXED, undefined, {
      eurc: 1.1,
      btc: 80_000,
      weth: 2_500,
    })

    // Exactly ONE RPC round-trip for every deployed pool combined; no previewRedeem needed.
    expect(multicallMock).toHaveBeenCalledTimes(1)
    expect(readContractMock).not.toHaveBeenCalled()

    const stable = positions['usdc-eurc-stable-pool']
    expect(stable).toBeDefined()
    expect(stable.poolSharePct).toBe(10)
    expect(stable.tokenAStaked).toBe('100.00')
    expect(stable.tokenBStaked).toBe('100.00')
    expect(stable.stakedUsd).toBeCloseTo(210, 4)
    expect(stable.priceUnavailable).toBe(false)
  })

  it('runs a single conditional previewRedeem only when the wallet holds YieldVault shares', async () => {
    multicallMock.mockImplementationOnce(async (_client: unknown, calls: Array<any>) =>
      calls.map((call) => {
        if (call.address === POOL_CONTRACTS.YIELD_VAULT) {
          if (call.functionName === 'balanceOf') return { status: 'success', result: parseUnits('250', 6) }
          if (call.functionName === 'totalAssets') return { status: 'success', result: parseUnits('1020', 6) }
          if (call.functionName === 'totalSupply') return { status: 'success', result: parseUnits('1000', 6) }
          if (call.functionName === 'decimals') return { status: 'success', result: 6 }
          if (call.functionName === 'pendingYield') return { status: 'success', result: parseUnits('3.5', 6) }
        }
        if (call.functionName === 'pendingFees') return { status: 'success', result: [0n, 0n] as const }
        return { status: 'success', result: 0n }
      })
    )
    readContractMock.mockResolvedValueOnce(parseUnits('255', 6))

    const positions = await fetchUserPoolPositions(WALLET_MIXED)

    expect(multicallMock).toHaveBeenCalledTimes(1)
    expect(readContractMock).toHaveBeenCalledTimes(1)
    expect(readContractMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        address: POOL_CONTRACTS.YIELD_VAULT,
        functionName: 'previewRedeem',
        args: [parseUnits('250', 6)],
      })
    )

    const vault = positions['usdc-yield-vault']
    expect(vault).toBeDefined()
    expect(vault.stakedUsd).toBeCloseTo(255, 4)
    expect(vault.poolSharePct).toBe(25)
    expect(vault.earnedFeesUsd).toBeCloseTo(5, 4)
  })

  it('prefetchUserWalletPoolsData populates the exact normalized query keys', async () => {
    const prefetchQuery = vi.fn(async (_opts: { queryKey: unknown }) => {})
    await prefetchUserWalletPoolsData({ prefetchQuery } as never, `  ${WALLET_MIXED}  `)

    const keys = prefetchQuery.mock.calls.map(([opts]) => opts.queryKey)
    expect(keys).toEqual([
      onchainPoolBalancesQueryKey(WALLET_LOWER),
      userPoolPositionsQueryKey(WALLET_LOWER),
    ])
  })
})
