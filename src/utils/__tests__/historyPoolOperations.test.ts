import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addTransaction,
  getHistory,
  historyDisplayTxHash,
  historyDisplayChain,
  type HistoryItem,
} from '../history'

describe('Pool & AMM Transaction History Integration', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const testWallet = `0x${'55'.repeat(20)}`
  const poolAddress = `0x${'aa'.repeat(20)}`

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records single-asset and zap add_liquidity with pool metadata', () => {
    const txHash = `0x${'01'.repeat(32)}`
    addTransaction({
      type: 'add_liquidity',
      txHash,
      amount: '100',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      recipient: poolAddress,
      userAddress: testWallet,
      status: 'success',
      poolId: 'usdc-yield-vault',
      poolName: 'Arcis Real-Yield Vault',
      lpMinted: '99.45',
      poolShare: 1.25,
    })

    const history = getHistory(testWallet)
    const entry = history.find((h) => h.txHash === txHash)

    expect(entry).toBeDefined()
    expect(entry?.type).toBe('add_liquidity')
    expect(entry?.poolName).toBe('Arcis Real-Yield Vault')
    expect(entry?.amount).toBe('100')
    expect(entry?.tokenSymbol).toBe('USDC')
    expect(entry?.lpMinted).toBe('99.45')
    expect(entry?.poolShare).toBe(1.25)
    expect(entry?.status).toBe('success')
  })

  it('records dual-asset add_liquidity with both tokens preserved', () => {
    const txHash = `0x${'02'.repeat(32)}`
    addTransaction({
      type: 'add_liquidity',
      txHash,
      amount: '50',
      tokenSymbol: 'USDC',
      amountB: '46.2',
      tokenB: 'EURC',
      sourceChain: 'Arc_Testnet',
      recipient: poolAddress,
      userAddress: testWallet,
      status: 'success',
      poolId: 'usdc-eurc-stable-pool',
      poolName: 'USDC / EURC Stable AMM',
      lpMinted: '95.8',
    })

    const history = getHistory(testWallet)
    const entry = history.find((h) => h.txHash === txHash)

    expect(entry).toBeDefined()
    expect(entry?.type).toBe('add_liquidity')
    expect(entry?.amount).toBe('50')
    expect(entry?.tokenSymbol).toBe('USDC')
    expect(entry?.amountB).toBe('46.2')
    expect(entry?.tokenB).toBe('EURC')
    expect(entry?.poolName).toBe('USDC / EURC Stable AMM')
  })

  it('records remove_liquidity correctly', () => {
    const txHash = `0x${'03'.repeat(32)}`
    addTransaction({
      type: 'remove_liquidity',
      txHash,
      amount: '40',
      tokenSymbol: 'af-USDC-EURC',
      sourceChain: 'Arc_Testnet',
      recipient: poolAddress,
      userAddress: testWallet,
      status: 'success',
      poolId: 'usdc-eurc-stable-pool',
      poolName: 'USDC / EURC Stable AMM',
    })

    const history = getHistory(testWallet)
    const entry = history.find((h) => h.txHash === txHash)

    expect(entry).toBeDefined()
    expect(entry?.type).toBe('remove_liquidity')
    expect(entry?.amount).toBe('40')
    expect(entry?.tokenSymbol).toBe('af-USDC-EURC')
    expect(entry?.poolName).toBe('USDC / EURC Stable AMM')
  })

  it('records harvest / claim yield correctly', () => {
    const txHash = `0x${'04'.repeat(32)}`
    addTransaction({
      type: 'harvest',
      txHash,
      amount: '12.4500',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      recipient: testWallet,
      userAddress: testWallet,
      status: 'success',
      poolId: 'usdc-cirbtc-pool',
      poolName: 'USDC / cirBTC Pool',
    })

    const history = getHistory(testWallet)
    const entry = history.find((h) => h.txHash === txHash)

    expect(entry).toBeDefined()
    expect(entry?.type).toBe('harvest')
    expect(entry?.amount).toBe('12.4500')
    expect(entry?.tokenSymbol).toBe('USDC')
    expect(entry?.poolName).toBe('USDC / cirBTC Pool')
    expect(entry?.recipient?.toLowerCase()).toBe(testWallet.toLowerCase())
  })
})
