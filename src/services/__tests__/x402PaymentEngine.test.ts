import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import {
  settleX402Payment,
  getAccumulatedYieldVaultFees,
  getStoredProviderEarnings,
  incrementYieldVaultFees,
  withdrawProviderEarningsApi,
} from '../x402PaymentEngine'
import { executeX402Call } from '../x402Client'
import type { x402Service } from '../../types/marketplace'

// Mock RPC & modular wallet on-chain services
vi.mock('../rpc', () => ({
  getArcPublicClient: () => ({
    waitForTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) => ({
      blockNumber: 5042123n,
      transactionHash: hash,
      status: mockReceiptStatus,
    }),
    getBlockNumber: async () => 5042123n,
  }),
}))

let mockUserOpSuccess = true
let mockReceiptStatus: 'success' | 'reverted' = 'success'

vi.mock('../modularWalletService', () => ({
  getStoredMscaAddress: () => '0x9999999999999999999999999999999999999999',
  getActiveSmartAccount: () => (mockUserOpSuccess ? { address: '0x9999999999999999999999999999999999999999' } : null),
  restoreSmartAccount: async () => (mockUserOpSuccess ? { address: '0x9999999999999999999999999999999999999999' } : null),
  createModularUsdcTransferCall: (to: string, amount: number) => ({ to, data: '0x' }),
  sendModularUserOperation: async () => {
    if (!mockUserOpSuccess) {
      return { success: false, error: 'User rejected passkey authorization' }
    }
    return {
      success: true,
      txHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
    }
  },
}))

vi.mock('../../utils/history', () => ({
  addTransaction: vi.fn(),
}))

const mockService: x402Service = {
  id: 'test-arb-service',
  version: '1.0.0',
  name: 'Test DEX Arbitrage Service',
  tagline: 'Test Tagline',
  category: 'Arbitrage',
  engine: 'native',
  description: 'Test Description',
  listing: {
    kind: 'official',
    ownerAddress: '0x1111111111111111111111111111111111111111',
    createdAt: 1760000000000,
  },
  provider: {
    name: 'Arc Quantitative Test Labs',
    address: '0x1111111111111111111111111111111111111111',
    isVerified: true,
    reputationScore: 98,
  },
  pricing: {
    model: 'per_call',
    priceUsdc: 0.005,
    maxAmountUsdc: 0.01,
    protocolFeeBps: 100,
  },
  accepts: [
    {
      scheme: 'exact',
      network: 'arcTestnet',
      asset: 'USDC',
      payTo: '0x1111111111111111111111111111111111111111',
    },
  ],
  serve: {
    method: 'POST',
    path: '/api/x402/test-arb-service',
  },
  requestSchema: { type: 'object' },
  ui: { form: [] },
  examples: { request: {}, response: {} },
  sla: { p95LatencyMs: 120, uptimePct: 99.9, successRate: 99.9 },
  tags: ['Arbitrage', 'DEX'],
}

describe('x402PaymentEngine & x402Client Unit Tests', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    mockUserOpSuccess = true
    mockReceiptStatus = 'success'
    const localStorageMock = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    }
    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('sessionStorage', localStorageMock)
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'false')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('Realistic 0-Baseline & YieldVault Share', () => {
    it('initializes YieldVault accumulated fees to 0 without legacy 24.15 mock baseline', () => {
      const initialVaultFees = getAccumulatedYieldVaultFees()
      expect(initialVaultFees).toBe(0)
    })

    it('accurately increments YieldVault fees on verified payments', () => {
      incrementYieldVaultFees(0.00005)
      expect(getAccumulatedYieldVaultFees()).toBe(0.00005)
    })
  })

  describe('Wallet Guard & Rejection Handling', () => {
    it('fails settlement and returns x402 challenge when no wallet or payment can be made', async () => {
      mockUserOpSuccess = false
      const result = await settleX402Payment(mockService, undefined)

      expect(result.success).toBe(false)
      expect(result.costUsdc).toBe(0)
      expect(result.challenge).toBeDefined()
      expect(result.challenge.statusCode).toBe(402)
      expect(result.challenge.amountUsdc).toBe(0.005)
      expect(result.error).toBeDefined()
    })
  })

  describe('Legacy direct transfer is not an x402 ledger settlement', () => {
    it('fails closed without signing or sending any direct transfer when no facilitator is configured', async () => {
      mockUserOpSuccess = true
      const initialVaultFees = getAccumulatedYieldVaultFees()
      const result = await settleX402Payment(mockService, '0x9999999999999999999999999999999999999999')

      expect(result.success).toBe(false)
      expect(result.costUsdc).toBe(0)
      expect(result.protocolFeeUsdc).toBe(0)
      expect(result.providerEarnedUsdc).toBe(0)
      expect(result.authProof).toBeUndefined()
      expect(result.executionMode).toBeUndefined()
      expect(result.error).toMatch(/no trusted payment settlement/i)
      expect(getAccumulatedYieldVaultFees()).toBe(initialVaultFees)
      expect(getStoredProviderEarnings()[mockService.provider.address.toLowerCase()]).toBeUndefined()
    })

    it('does not prompt a connected wallet when no trusted settlement is available', async () => {
      const provider = { request: vi.fn() }
      const result = await settleX402Payment(mockService, '0x9999999999999999999999999999999999999999', provider)

      expect(result.success).toBe(false)
      expect(provider.request).not.toHaveBeenCalled()
    })

    it('does not credit or report success even when a direct-transfer receipt could succeed', async () => {
      mockUserOpSuccess = true
      const initialVaultFees = getAccumulatedYieldVaultFees()
      const initialProviderRecord = getStoredProviderEarnings()[mockService.provider.address.toLowerCase()]
      const result = await settleX402Payment(mockService, '0x9999999999999999999999999999999999999999')

      expect(result.success).toBe(false)
      expect(result.costUsdc).toBe(0)
      expect(result.error).toMatch(/no trusted payment settlement/i)
      expect(result.txHash).toBeUndefined()
      expect(result.explorerUrl).toBeUndefined()
      expect(getAccumulatedYieldVaultFees()).toBe(initialVaultFees)
      expect(getStoredProviderEarnings()[mockService.provider.address.toLowerCase()]).toEqual(initialProviderRecord)
    })
  })

  describe('executeX402Call End-to-End Orchestration', () => {
    it('fails closed without a trusted facilitator settlement result', async () => {
      mockUserOpSuccess = true
      const result = await executeX402Call(
        mockService,
        { pair: 'USDC/EURC', tradeSizeUsdc: 10000 },
        '0x9999999999999999999999999999999999999999'
      )

      expect(result.statusCode).toBe(503)
      expect(result.success).toBe(false)
      expect(result.costUsdc).toBe(0)
      expect(result.executionTimeMs).toBe(0)
      expect(result.data).toBeUndefined()
      expect(result.explorerUrl).toBeUndefined()
      expect(result.txHash).toBeUndefined()
      expect(result.payment).toBeUndefined()
    })

    it('fails closed without prompting the wallet when a trusted settlement path is unavailable', async () => {
      const rejectingProvider = {
        request: vi.fn().mockRejectedValue(new Error('User rejected authorization request')),
      }
      const result = await executeX402Call(
        mockService,
        { pair: 'USDC/EURC', tradeSizeUsdc: 10000 },
        '0x9999999999999999999999999999999999999999',
        rejectingProvider
      )

      expect(result.statusCode).toBe(503)
      expect(result.success).toBe(false)
      expect(result.costUsdc).toBe(0)
      expect(result.error).toMatch(/no trusted payment settlement/i)
      expect(rejectingProvider.request.mock.calls.map(([request]) => request.method)).not.toContain('eth_signTypedData_v4')
      expect(rejectingProvider.request.mock.calls.map(([request]) => request.method)).not.toContain('eth_sendTransaction')
    })
  })

  describe('withdrawProviderEarningsApi (W3-01 verification)', () => {
    it('returns error when no wallet provider is available', async () => {
      const res = await withdrawProviderEarningsApi('0x1111111111111111111111111111111111111111', 10, null)
      expect(res.success).toBe(false)
      expect(res.error).toMatch(/Connect the provider wallet/i)
    })

    it('creates wallet client and signs ledger withdrawal without ReferenceError', async () => {
      const mockRequest = vi.fn().mockImplementation(async ({ method }) => {
        if (method === 'eth_chainId') return '0x4cef52' // 5042002 in hex
        if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111']
        if (method === 'eth_signTypedData_v4') return '0x' + 'a'.repeat(130)
        return null
      })
      const mockSigner = { request: mockRequest }

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true, remainingBalanceUsdc: 0, totalWithdrawnUsdc: 10 }), { status: 200 })
      )

      try {
        const res = await withdrawProviderEarningsApi('0x1111111111111111111111111111111111111111', 10, mockSigner)
        expect(res.success).toBe(true)
        expect(mockRequest).toHaveBeenCalled()
      } finally {
        fetchSpy.mockRestore()
      }
    })
  })
})
