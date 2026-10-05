// src/services/__tests__/walletTestnetBalancesTokens.test.ts
// Verifies that fetchWalletTestnetBalancesData batches every requested token read for a chain
// into a single Multicall3 call, and that the optional token subset keeps the Unified Balance
// deposit panel from paying for EURC/cirBTC/WETH/USYC RPC reads.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../rpc', () => ({
  getResilientPublicClient: vi.fn(() => ({})),
  resilientGetBalance: vi.fn(async () => 0n),
  resilientMulticall: vi.fn(async (_client: unknown, contracts: Array<{ address: string }>) =>
    contracts.map(() => ({ status: 'success' as const, result: 0n }))
  ),
}))

import { resilientGetBalance, resilientMulticall } from '../rpc'
import {
  fetchWalletTestnetBalancesData,
  TESTNET_CHAINS,
} from '../../hooks/useWalletTestnetBalances'
import { USDC_ADDRESSES } from '../../config/gatewayConfig'

const WALLET = '0x0000000000000000000000000000000000000001'

describe('fetchWalletTestnetBalancesData batching', () => {
  beforeEach(() => {
    vi.mocked(resilientMulticall).mockClear()
    vi.mocked(resilientGetBalance).mockClear()
  })

  it('batches the USDC-only subset into one multicall per chain', async () => {
    await fetchWalletTestnetBalancesData(WALLET, ['USDC'])

    const chainCount = Object.keys(TESTNET_CHAINS).length
    const calls = vi.mocked(resilientMulticall).mock.calls as unknown as Array<[unknown, Array<{ address: string }>]>
    expect(calls.length).toBe(chainCount)

    const usdcAddresses = new Set(Object.values(USDC_ADDRESSES).map((address) => address.toLowerCase()))
    for (const call of calls) {
      const contracts = call[1]
      expect(contracts).toHaveLength(1)
      expect(usdcAddresses.has(String(contracts[0].address).toLowerCase())).toBe(true)
    }
  })

  it('sends the full token set in a single batched call per chain by default', async () => {
    await fetchWalletTestnetBalancesData(WALLET)

    const chainCount = Object.keys(TESTNET_CHAINS).length
    const calls = vi.mocked(resilientMulticall).mock.calls as unknown as Array<[unknown, unknown[]]>
    expect(calls.length).toBe(chainCount)
    const totalContracts = calls.reduce((sum, call) => sum + call[1].length, 0)
    expect(totalContracts).toBeGreaterThan(chainCount)
  })

  it('returns a zeroed record without RPC calls for a non-EVM address', async () => {
    const record = await fetchWalletTestnetBalancesData('So11111111111111111111111111111111111111112')
    expect(vi.mocked(resilientMulticall).mock.calls.length).toBe(0)
    expect(record.Arc_Testnet?.usdc).toBe('0.00')
  })

  it('reads native balances through the deduplicated resilient helper', async () => {
    await fetchWalletTestnetBalancesData(WALLET, ['USDC'])

    const chainCount = Object.keys(TESTNET_CHAINS).length
    // Arc's native gas is USDC itself, so it does not need an eth_getBalance read.
    expect(vi.mocked(resilientGetBalance).mock.calls.length).toBe(chainCount - 1)
  })
})
