// src/services/__tests__/portfolioContextService.test.ts
// Verifies the chain-read side of the portfolio snapshot: real WETH/cirBTC balances, a vault value
// read from the contract, and a net worth that prices every held asset.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POOL_CONTRACTS } from '../../config/poolsConfig'
import { ARC_TOKENS } from '../../config/arcChain'
import { getLivePortfolioSnapshot, invalidatePortfolioCache } from '../portfolioContextService'

const mocks = vi.hoisted(() => ({
  resilientGetBalance: vi.fn(),
  resilientReadContract: vi.fn(),
  getGatewayBalances: vi.fn(),
}))

vi.mock('../rpc', () => ({
  getArcPublicClient: () => ({}),
  resilientGetBalance: mocks.resilientGetBalance,
  resilientReadContract: mocks.resilientReadContract,
}))

vi.mock('../gatewayService', () => ({
  getGatewayBalances: mocks.getGatewayBalances,
}))

vi.mock('../sessionKeyService', () => ({
  getSessionKeyConfig: () => ({
    sessionId: 'test-session',
    sessionPublicKey: '0x0000000000000000000000000000000000000001',
    expiresAt: Date.now() + 3_600_000,
    maxSpendUsdc: 100,
    spentUsdc: 0,
    maxPerTxUsdc: 50,
    allowedActions: [],
    isActive: false,
    autoExecute: false,
    createdAt: Date.now(),
  }),
}))

vi.mock('../tokenPriceService', () => ({
  getLiveTokenPrices: async () => ({ USDC: 1, EURC: 1.08, WETH: 2500, WBTC: 78500 }),
}))

vi.mock('../modularWalletService', () => ({
  getStoredMscaAddress: () => null,
}))

const WALLET = '0x1111111111111111111111111111111111111111'

const USDC_ADDR = String(POOL_CONTRACTS.USDC).toLowerCase()
const EURC_ADDR = String(POOL_CONTRACTS.EURC).toLowerCase()
const CIRBTC_ADDR = String(POOL_CONTRACTS.cirBTC).toLowerCase()
const WETH_ADDR = String(ARC_TOKENS.WETH).toLowerCase()
const VAULT_ADDR = String(POOL_CONTRACTS.YIELD_VAULT).toLowerCase()

function setChainBalances({ previewRedeemFails = false } = {}) {
  mocks.resilientGetBalance.mockResolvedValue(BigInt(0))
  mocks.getGatewayBalances.mockResolvedValue({ balances: [] })
  mocks.resilientReadContract.mockImplementation(async (_client: unknown, params: any) => {
    if (params.functionName === 'previewRedeem') {
      if (previewRedeemFails) throw new Error('rpc unavailable')
      return BigInt(108_420_000) // 100 vault shares redeem for 108.42 USDC
    }

    const address = String(params.address).toLowerCase()
    if (address === USDC_ADDR) return BigInt(12_340_000) // 12.34 USDC
    if (address === EURC_ADDR) return BigInt(5_500_000) // 5.50 EURC
    if (address === WETH_ADDR) return BigInt('250000000000000000') // 0.25 WETH
    if (address === CIRBTC_ADDR) return BigInt(130_000) // 0.0013 cirBTC (8 decimals)
    if (address === VAULT_ADDR) return BigInt(100_000_000) // 100 vault shares
    return BigInt(0)
  })
}

beforeEach(() => {
  mocks.resilientGetBalance.mockReset()
  mocks.resilientReadContract.mockReset()
  mocks.getGatewayBalances.mockReset()
  invalidatePortfolioCache()
})

describe('getLivePortfolioSnapshot chain reads', () => {
  it('populates WETH and cirBTC balances instead of leaving them at zero', async () => {
    setChainBalances()
    const snapshot = await getLivePortfolioSnapshot(WALLET)

    expect(snapshot.liquidWeth).toBe(0.25)
    expect(snapshot.liquidCirBtc).toBe(0.0013)
    expect(snapshot.liquidUsdc).toBe(12.34)
    expect(snapshot.liquidEurc).toBe(5.5)
  })

  it('values the vault position from the contract, not a hard-coded ratio', async () => {
    setChainBalances()
    const snapshot = await getLivePortfolioSnapshot(WALLET)

    // 100 shares x 1.0842 would also be 108.42, so assert the contract read actually happened.
    const previewCalls = mocks.resilientReadContract.mock.calls.filter(
      (call: any[]) => call[1]?.functionName === 'previewRedeem'
    )
    expect(previewCalls).toHaveLength(1)
    expect(snapshot.vaultStakedUsdc).toBe(108.42)
  })

  it('prices every held asset into the total net worth', async () => {
    setChainBalances()
    const snapshot = await getLivePortfolioSnapshot(WALLET)

    // 12.34 + (5.5 x 1.08) + (0.25 x 2500) + (0.0013 x 78500) + 108.42
    expect(snapshot.totalNetWorthUsd).toBeCloseTo(853.75, 2)
  })

  it('reports zero rather than a fabricated vault value when the read fails', async () => {
    setChainBalances({ previewRedeemFails: true })
    const snapshot = await getLivePortfolioSnapshot(WALLET)

    expect(snapshot.vaultStakedUsdc).toBe(0)
  })

  it('skips the vault read entirely when the wallet holds no shares', async () => {
    setChainBalances({ previewRedeemFails: true })
    mocks.resilientReadContract.mockImplementation(async (_client: unknown, params: any) => {
      if (String(params.address).toLowerCase() === VAULT_ADDR) return BigInt(0)
      return BigInt(0)
    })

    const snapshot = await getLivePortfolioSnapshot(WALLET)

    const previewCalls = mocks.resilientReadContract.mock.calls.filter(
      (call: any[]) => call[1]?.functionName === 'previewRedeem'
    )
    expect(previewCalls).toHaveLength(0)
    expect(snapshot.vaultStakedUsdc).toBe(0)
  })

  it('does not inflate tiny native USDC balances (W3-05)', async () => {
    setChainBalances()
    mocks.resilientGetBalance.mockResolvedValue(10_000_000_000_000n) // 0.00001 native USDC (18 decimals)
    mocks.resilientReadContract.mockImplementation(async (_client: unknown, _params: any) => BigInt(0))
    const snapshot = await getLivePortfolioSnapshot(WALLET)
    expect(snapshot.liquidUsdc).toBe(0)
    expect(snapshot.liquidUsdc).not.toBe(10_000_000)
  })

  it('returns an empty snapshot for a wallet that is not a valid address', async () => {
    setChainBalances()
    const snapshot = await getLivePortfolioSnapshot('')

    expect(snapshot.walletAddress).toBe('0xDemo...Wallet')
    expect(snapshot.totalNetWorthUsd).toBe(0)
    expect(mocks.resilientReadContract).not.toHaveBeenCalled()
  })

  it('treats a non-zero but unusable balance read as zero rather than NaN', async () => {
    setChainBalances()
    mocks.resilientGetBalance.mockRejectedValue(new Error('native balance failed'))
    mocks.resilientReadContract.mockImplementation(async (_client: unknown, params: any) => {
      if (params.functionName === 'previewRedeem') return BigInt(0)
      if (String(params.address).toLowerCase() === WETH_ADDR) throw new Error('weth read failed')
      return BigInt(0)
    })

    const snapshot = await getLivePortfolioSnapshot(WALLET)

    expect(snapshot.liquidWeth).toBe(0)
    expect(Number.isFinite(snapshot.totalNetWorthUsd)).toBe(true)
    expect(snapshot.liquidUsdc).toBe(0)
  })
})