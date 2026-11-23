// src/services/copilot/__tests__/copilotLpDepositAction.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem'
import { ERC20_ABI, POOL_CONTRACTS, STABLE_SWAP_ABI } from '../../../config/poolsConfig'
import { getCopilotLpPoolById } from '../../../utils/copilotPoolParser'

const mockReadContract = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()
const mockEstimateContractGas = vi.fn(async () => 250_000n)
const mockWriteContract = vi.fn()
const mockSendTransaction = vi.fn()
const mockSendModularUserOp = vi.fn()
const mockAddTransaction = vi.fn()

vi.mock('../../rpc/index.js', () => ({
  getResilientPublicClient: () => ({
    readContract: mockReadContract,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
    estimateContractGas: mockEstimateContractGas,
  }),
}))

vi.mock('../../arcGasService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../arcGasService')>()
  return {
    ...actual,
    resolveArcActualFeeUsdc: vi.fn(async () => ({
      feeUsdc: 0.0012,
      baseFeeUsdcExact: '0.00100',
      priorityFeeUsdcExact: '0.00020',
    })),
    getDynamicArcGasOptions: vi.fn(async () => ({
      isDynamic: true,
      maxFeePerGas: 25_000_000_000n,
      source: 'arc-rpc',
    })),
    calculateArcGasCostFromFee: vi.fn(() => '0.00125'),
  }
})

vi.mock('../../sessionEnclaveService', () => ({
  getEphemeralSessionAccount: vi.fn(() => null),
  fetchEnclaveUsdcBalance: vi.fn(async () => 0),
}))

vi.mock('../../sessionKeyService', () => ({
  verifySessionLimits: vi.fn(() => ({ allowed: true })),
  deductSessionSpend: vi.fn(),
}))

vi.mock('../../modularWalletService', () => ({
  sendModularUserOperation: (...args: any[]) => mockSendModularUserOp(...args),
  arcTestnetChain: { id: 5042002, name: 'Arc Testnet' },
}))

vi.mock('../../../utils/history', () => ({
  addTransaction: (...args: any[]) => mockAddTransaction(...args),
}))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createWalletClient: vi.fn(() => ({
      writeContract: mockWriteContract,
      sendTransaction: mockSendTransaction,
    })),
  }
})

import { getCopilotLpQuote } from '../copilotLpQuote'
import { executeCopilotLpDepositAction } from '../copilotLpDepositAction'

const WALLET = '0x1111111111111111111111111111111111111111' as const
const TX_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const

function buildLiquidityAddedLog(poolAddress: string, provider: string, amountA: bigint, amountB: bigint, lpMinted: bigint) {
  const topics = encodeEventTopics({
    abi: STABLE_SWAP_ABI,
    eventName: 'LiquidityAdded',
    args: {
      provider: provider as `0x${string}`,
    },
  })
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [amountA, amountB, lpMinted]
  )
  return { address: poolAddress, data, topics }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCopilotLpQuote', () => {
  it('computes a live 1-Click Zap quote for USDC/EURC with slippage-guarded minLpShares', async () => {
    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('10000', 6)
      if (functionName === 'reserveB') return parseUnits('9200', 6)
      if (functionName === 'totalLp') return parseUnits('19000', 18)
      if (functionName === 'paused') return false
      return 0n
    })

    const res = await getCopilotLpQuote({
      pool,
      mode: 'zap',
      amountA: 100,
      amountADecimal: '100',
      slippageBps: 50,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(BigInt(res.quote.minLpSharesRaw)).toBeGreaterThan(0n)
      expect(Number(res.quote.estimatedLpOut)).toBeGreaterThan(Number(res.quote.minLpShares))
      expect(res.quote.poolSharePct).toBeGreaterThan(0)
      expect(res.quote.slippageBps).toBe(50)
    }
  })

  it('auto-matches counter token amount from live reserves on EURC/WETH dual deposit', async () => {
    const pool = getCopilotLpPoolById('eurc-weth-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('25000', 6) // 25,000 EURC
      if (functionName === 'reserveB') return parseUnits('10', 18) // 10 WETH (2500 EURC/WETH)
      if (functionName === 'totalLp') return parseUnits('5000', 18)
      if (functionName === 'paused') return false
      return 0n
    })

    const res = await getCopilotLpQuote({
      pool,
      mode: 'dual',
      amountA: 250,
      amountADecimal: '250',
      autoMatchCounter: true,
      anchorSide: 'A',
      slippageBps: 50,
    })

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.quote.amountA).toBe(250)
      expect(res.quote.amountB).toBe(0.1)
      expect(res.quote.donationPct).toBeLessThan(1)
      expect(BigInt(res.quote.minLpSharesRaw)).toBeGreaterThan(0n)
    }
  })

  it('blocks severely unbalanced dual deposits to prevent donating value to existing LPs', async () => {
    const pool = getCopilotLpPoolById('eurc-weth-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('25000', 6)
      if (functionName === 'reserveB') return parseUnits('10', 18)
      if (functionName === 'totalLp') return parseUnits('5000', 18)
      if (functionName === 'paused') return false
      return 0n
    })

    const res = await getCopilotLpQuote({
      pool,
      mode: 'dual',
      amountA: 250,
      amountB: 1, // 10x too much WETH!
      autoMatchCounter: false,
      slippageBps: 50,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('Unbalanced dual deposit blocked')
    }
  })

  it('refuses deposits into paused pools', async () => {
    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'paused') return true
      return parseUnits('1000', 6)
    })

    const res = await getCopilotLpQuote({ pool, mode: 'zap', amountA: 10, amountADecimal: '10' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Pool paused')
  })
})

describe('executeCopilotLpDepositAction', () => {
  it('refuses execution when minLpSharesRaw guard is missing', async () => {
    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Add LP',
          data: {
            poolId: 'usdc-eurc-stable-pool',
            lpMode: 'zap',
            amountA: 10,
            tokenA: 'USDC',
            tokenB: 'EURC',
          },
        },
        activeWallet: WALLET,
        startTime: Date.now(),
      },
      { isActive: true }
    )
    expect(receipt.status).toBe('FAILED')
    expect(receipt.title).toContain('Slippage Guard Required')
  })

  it('executes Dual-Asset EOA deposit on EURC/cirBTC using the 4-arg deadline overload and verifies LiquidityAdded', async () => {
    const pool = getCopilotLpPoolById('eurc-cirbtc-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('60000', 6) // 60k EURC
      if (functionName === 'reserveB') return parseUnits('1', 8) // 1 cirBTC
      if (functionName === 'totalLp') return parseUnits('1000', 18)
      if (functionName === 'paused') return false
      if (functionName === 'balanceOf') return parseUnits('100000', 8)
      if (functionName === 'allowance') return parseUnits('100000', 8) // pre-approved
      return 0n
    })

    mockWriteContract.mockResolvedValue(TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH,
      logs: [
        buildLiquidityAddedLog(
          pool.contractAddress,
          WALLET,
          parseUnits('600', 6),
          parseUnits('0.01', 8),
          parseUnits('10', 18)
        ),
      ],
    })

    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Add Liquidity: EURC / cirBTC',
          data: {
            poolId: 'eurc-cirbtc-pool',
            poolName: pool.name,
            poolAddress: pool.contractAddress,
            lpMode: 'dual',
            tokenA: 'EURC',
            tokenB: 'cirBTC',
            amountA: 600,
            amountB: 0.01,
            slippageBps: 50,
            minLpSharesRaw: parseUnits('9.9', 18).toString(),
          },
        },
        activeWallet: WALLET,
        provider: { request: vi.fn() },
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.poolId).toBe('eurc-cirbtc-pool')
    expect(receipt.lpMinted).toBe('10.000000')
    expect(receipt.amountIn).toBe(600)
    expect(receipt.amountB).toBe(0.01)

    // Verify 4-argument deadline overload was used for EURC/cirBTC V4 pool!
    expect(mockWriteContract).toHaveBeenCalledTimes(1)
    const callArg = mockWriteContract.mock.calls[0][0]
    expect(callArg.functionName).toBe('addLiquidity')
    expect(callArg.args).toHaveLength(4)
    expect(callArg.args[3]).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)))

    expect(mockAddTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'add_liquidity',
        poolId: 'eurc-cirbtc-pool',
        txHash: TX_HASH,
      })
    )
  })

  it('executes Dual-Asset Passkey/MSCA deposit in a single batched UserOperation', async () => {
    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('10000', 6)
      if (functionName === 'reserveB') return parseUnits('10000', 6)
      if (functionName === 'totalLp') return parseUnits('20000', 18)
      if (functionName === 'paused') return false
      if (functionName === 'balanceOf') return parseUnits('1000', 6)
      return 0n
    })

    mockSendModularUserOp.mockResolvedValue({ success: true, txHash: TX_HASH })
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH,
      logs: [
        buildLiquidityAddedLog(
          pool.contractAddress,
          WALLET,
          parseUnits('50', 6),
          parseUnits('50', 6),
          parseUnits('100', 18)
        ),
      ],
    })

    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Add Liquidity: USDC / EURC',
          data: {
            poolId: 'usdc-eurc-stable-pool',
            poolName: pool.name,
            poolAddress: pool.contractAddress,
            lpMode: 'dual',
            tokenA: 'USDC',
            tokenB: 'EURC',
            amountA: 50,
            amountB: 50,
            slippageBps: 50,
            minLpSharesRaw: parseUnits('99', 18).toString(),
          },
        },
        activeWallet: WALLET,
        activeMsca: WALLET,
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(mockSendModularUserOp).toHaveBeenCalledTimes(1)
    expect(mockSendModularUserOp.mock.calls[0][0].calls).toHaveLength(3) // approveA + approveB + addLiquidity
    expect(mockSendModularUserOp.mock.calls[0][0].paymaster).toBe(true)
  })

  it('executes Circle UCW 1-Click Zap (swap + addLiquidity) and verifies LiquidityAdded', async () => {
    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    let eurcReadCount = 0
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('10000', 6)
      if (functionName === 'reserveB') return parseUnits('10000', 6)
      if (functionName === 'totalLp') return parseUnits('20000', 18)
      if (functionName === 'paused') return false
      if (functionName === 'allowance') return parseUnits('100000', 6)
      if (functionName === 'balanceOf') {
        if (String(address).toLowerCase() === POOL_CONTRACTS.EURC.toLowerCase()) {
          eurcReadCount += 1
          return eurcReadCount === 1 ? 0n : parseUnits('49.9', 6)
        }
        return parseUnits('500', 6)
      }
      return 0n
    })

    const swapTx = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
    const executeUcwContract = vi
      .fn()
      .mockResolvedValueOnce({ success: true, txHash: swapTx })
      .mockResolvedValueOnce({ success: true, txHash: TX_HASH })

    mockWaitForTransactionReceipt.mockImplementation(async ({ hash }: any) => {
      if (hash === swapTx) return { status: 'success', transactionHash: swapTx, logs: [] }
      return {
        status: 'success',
        transactionHash: TX_HASH,
        logs: [
          buildLiquidityAddedLog(
            pool.contractAddress,
            WALLET,
            parseUnits('50', 6),
            parseUnits('49.9', 6),
            parseUnits('99.8', 18)
          ),
        ],
      }
    })

    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Zap 100 USDC into USDC / EURC LP',
          data: {
            poolId: 'usdc-eurc-stable-pool',
            poolName: pool.name,
            poolAddress: pool.contractAddress,
            lpMode: 'zap',
            tokenA: 'USDC',
            tokenB: 'EURC',
            amountA: 100,
            slippageBps: 50,
            minLpSharesRaw: parseUnits('98', 18).toString(),
          },
        },
        activeWallet: WALLET,
        ucwHandlers: { authSource: 'ucw', executeUcwContract },
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.lpMode).toBe('zap')
    expect(receipt.lpMinted).toBe('99.800000')
    expect(executeUcwContract).toHaveBeenCalledTimes(2)
    expect(executeUcwContract.mock.calls[0][0].abiFunctionSignature).toBe('swap(address,address,uint256,uint256)')
    expect(executeUcwContract.mock.calls[1][0].abiFunctionSignature).toBe('addLiquidity(uint256,uint256,uint256)')
  })

  it('forwards minted LP tokens from Session Enclave to activeWallet after 1-Click Zap (ARCO-02)', async () => {
    const ENCLAVE = '0x3333333333333333333333333333333333333333' as const
    const SWAP_TX = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
    const FWD_TX = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' as const
    const LP_MINTED = parseUnits('99.5', 18)

    const sessionEnclave = await import('../../sessionEnclaveService')
    vi.mocked(sessionEnclave.getEphemeralSessionAccount).mockReturnValueOnce({ address: ENCLAVE } as any)
    vi.mocked(sessionEnclave.fetchEnclaveUsdcBalance).mockResolvedValueOnce(200)

    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    let eurcReadCount = 0
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('10000', 6)
      if (functionName === 'reserveB') return parseUnits('10000', 6)
      if (functionName === 'totalLp') return parseUnits('20000', 18)
      if (functionName === 'paused') return false
      if (functionName === 'allowance') return parseUnits('100000', 6)
      if (functionName === 'balanceOf') {
        if (String(address).toLowerCase() === POOL_CONTRACTS.EURC.toLowerCase()) {
          eurcReadCount += 1
          return eurcReadCount === 1 ? 0n : parseUnits('49.9', 6)
        }
        if (String(address).toLowerCase() === pool.contractAddress.toLowerCase()) {
          return LP_MINTED
        }
        return parseUnits('500', 6)
      }
      return 0n
    })

    mockSendTransaction
      .mockResolvedValueOnce(SWAP_TX)
      .mockResolvedValueOnce(TX_HASH)
      .mockResolvedValueOnce(FWD_TX)

    mockWaitForTransactionReceipt.mockImplementation(async ({ hash }: any) => {
      if (hash === SWAP_TX) return { status: 'success', transactionHash: SWAP_TX, logs: [] }
      if (hash === FWD_TX) return { status: 'success', transactionHash: FWD_TX, logs: [] }
      return {
        status: 'success',
        transactionHash: TX_HASH,
        logs: [
          buildLiquidityAddedLog(
            pool.contractAddress,
            ENCLAVE,
            parseUnits('50', 6),
            parseUnits('49.9', 6),
            LP_MINTED
          ),
        ],
      }
    })

    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Zap 100 USDC into USDC / EURC LP',
          data: {
            poolId: 'usdc-eurc-stable-pool',
            poolName: pool.name,
            poolAddress: pool.contractAddress,
            lpMode: 'zap',
            tokenA: 'USDC',
            tokenB: 'EURC',
            amountA: 100,
            slippageBps: 50,
            minLpSharesRaw: parseUnits('98', 18).toString(),
          },
        },
        activeWallet: WALLET,
        provider: { request: vi.fn() },
        budgetManaged: true,
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.txHash).toBe(TX_HASH)
    expect(receipt.subtitle).toBe('Executed via Session Key (Zero-Popup 1-Click Zap)')
    expect(mockWriteContract).not.toHaveBeenCalled()

    // 3 enclave txs: swap, addLiquidity, and ERC-20 LP transfer to activeWallet
    expect(mockSendTransaction).toHaveBeenCalledTimes(3)
    const forwardCall = mockSendTransaction.mock.calls[2][0]
    expect(String(forwardCall.to).toLowerCase()).toBe(pool.contractAddress.toLowerCase())
    const decodedForward = decodeFunctionData({ abi: ERC20_ABI, data: forwardCall.data })
    expect(decodedForward.functionName).toBe('transfer')
    expect(String(decodedForward.args[0]).toLowerCase()).toBe(WALLET.toLowerCase())
    expect(decodedForward.args[1]).toBe(LP_MINTED)
  })

  it('discloses enclave custody without triggering a duplicate fallback deposit if LP transfer fails (ARCO-02)', async () => {
    const ENCLAVE = '0x3333333333333333333333333333333333333333' as const
    const SWAP_TX = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as const
    const LP_MINTED = parseUnits('99.5', 18)

    const sessionEnclave = await import('../../sessionEnclaveService')
    vi.mocked(sessionEnclave.getEphemeralSessionAccount).mockReturnValueOnce({ address: ENCLAVE } as any)
    vi.mocked(sessionEnclave.fetchEnclaveUsdcBalance).mockResolvedValueOnce(200)

    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    let eurcReadCount = 0
    mockReadContract.mockImplementation(async ({ address, functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('10000', 6)
      if (functionName === 'reserveB') return parseUnits('10000', 6)
      if (functionName === 'totalLp') return parseUnits('20000', 18)
      if (functionName === 'paused') return false
      if (functionName === 'allowance') return parseUnits('100000', 6)
      if (functionName === 'balanceOf') {
        if (String(address).toLowerCase() === POOL_CONTRACTS.EURC.toLowerCase()) {
          eurcReadCount += 1
          return eurcReadCount === 1 ? 0n : parseUnits('49.9', 6)
        }
        if (String(address).toLowerCase() === pool.contractAddress.toLowerCase()) {
          return LP_MINTED
        }
        return parseUnits('500', 6)
      }
      return 0n
    })

    mockSendTransaction
      .mockResolvedValueOnce(SWAP_TX)
      .mockResolvedValueOnce(TX_HASH)
      .mockRejectedValueOnce(new Error('Forward gas estimation reverted'))

    mockWaitForTransactionReceipt.mockImplementation(async ({ hash }: any) => {
      if (hash === SWAP_TX) return { status: 'success', transactionHash: SWAP_TX, logs: [] }
      return {
        status: 'success',
        transactionHash: TX_HASH,
        logs: [
          buildLiquidityAddedLog(
            pool.contractAddress,
            ENCLAVE,
            parseUnits('50', 6),
            parseUnits('49.9', 6),
            LP_MINTED
          ),
        ],
      }
    })

    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Zap 100 USDC into USDC / EURC LP',
          data: {
            poolId: 'usdc-eurc-stable-pool',
            poolName: pool.name,
            poolAddress: pool.contractAddress,
            lpMode: 'zap',
            tokenA: 'USDC',
            tokenB: 'EURC',
            amountA: 100,
            slippageBps: 50,
            minLpSharesRaw: parseUnits('98', 18).toString(),
          },
        },
        activeWallet: WALLET,
        provider: { request: vi.fn() },
        budgetManaged: true,
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(receipt.txHash).toBe(TX_HASH)
    expect(receipt.subtitle).toContain('remain at enclave 0x3333...3333')
    // Must NOT fall back to connected wallet and double-deposit
    expect(mockWriteContract).not.toHaveBeenCalled()
  })

  it('routes EOA dual LP deposit to injected wallet even when a stale cached MSCA address exists (ARCO-03)', async () => {
    const STALE_MSCA = '0x9999999999999999999999999999999999999999' as const
    const pool = getCopilotLpPoolById('usdc-eurc-stable-pool')!
    mockReadContract.mockImplementation(async ({ functionName }: any) => {
      if (functionName === 'reserveA') return parseUnits('10000', 6)
      if (functionName === 'reserveB') return parseUnits('10000', 6)
      if (functionName === 'totalLp') return parseUnits('20000', 18)
      if (functionName === 'paused') return false
      if (functionName === 'balanceOf') return parseUnits('1000', 6)
      if (functionName === 'allowance') return parseUnits('1000', 6)
      return 0n
    })

    mockWriteContract.mockResolvedValue(TX_HASH)
    mockWaitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      transactionHash: TX_HASH,
      logs: [
        buildLiquidityAddedLog(
          pool.contractAddress,
          WALLET,
          parseUnits('50', 6),
          parseUnits('50', 6),
          parseUnits('100', 18)
        ),
      ],
    })

    const receipt = await executeCopilotLpDepositAction(
      {
        actionPayload: {
          type: 'interactive_lp_deposit',
          title: 'Add Liquidity: USDC / EURC',
          data: {
            poolId: 'usdc-eurc-stable-pool',
            poolName: pool.name,
            poolAddress: pool.contractAddress,
            lpMode: 'dual',
            tokenA: 'USDC',
            tokenB: 'EURC',
            amountA: 50,
            amountB: 50,
            slippageBps: 50,
            minLpSharesRaw: parseUnits('99', 18).toString(),
          },
        },
        activeWallet: WALLET,
        activeMsca: STALE_MSCA,
        ucwHandlers: { authSource: 'evm' },
        provider: { request: vi.fn() },
        startTime: Date.now(),
      },
      { isActive: true }
    )

    expect(receipt.status).toBe('SUCCESS')
    expect(mockSendModularUserOp).not.toHaveBeenCalled()
    expect(mockWriteContract).toHaveBeenCalledTimes(1)
  })
})
