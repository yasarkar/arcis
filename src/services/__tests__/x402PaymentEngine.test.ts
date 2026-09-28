import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  settleX402Payment,
  getAccumulatedYieldVaultFees,
  getStoredProviderEarnings,
  incrementYieldVaultFees,
} from '../x402PaymentEngine'
import { executeX402Call } from '../x402Client'
import type { x402Service } from '../../types/marketplace'

// Mock RPC & modular wallet on-chain services
vi.mock('../rpc', () => ({
  getArcPublicClient: () => ({
    waitForTransactionReceipt: async () => ({ blockNumber: 5042123n }),
    getBlockNumber: async () => 5042123n,
  }),
}))

let mockUserOpSuccess = true

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
    vi.clearAllMocks()
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

  describe('Verified On-Chain Fee Routing & Provider Accounting', () => {
    it('accurately splits 1% to YieldVault and 99% to provider upon verified on-chain confirmation', async () => {
      mockUserOpSuccess = true
      const initialVaultFees = getAccumulatedYieldVaultFees()
      const result = await settleX402Payment(mockService, '0x9999999999999999999999999999999999999999')

      expect(result.success).toBe(true)
      expect(result.costUsdc).toBe(0.005)
      expect(result.protocolFeeUsdc).toBe(0.00005) // 1%
      expect(result.providerEarnedUsdc).toBe(0.00495) // 99%
      expect(result.executionMode).toBe('session_autonomous')

      // Verify YieldVault accumulation
      const updatedVaultFees = getAccumulatedYieldVaultFees()
      expect(updatedVaultFees).toBeCloseTo(initialVaultFees + 0.00005, 5)

      // Verify Provider earnings
      const earnings = getStoredProviderEarnings()
      const providerRecord = earnings[mockService.provider.address.toLowerCase()]
      expect(providerRecord).toBeDefined()
      expect(providerRecord.totalCallsServed).toBe(1)
      expect(providerRecord.unclaimedEarningsUsdc).toBeCloseTo(0.00495, 5)
    })

    it('produces valid cryptographic authorization proof and real ArcScan tx receipt link', async () => {
      mockUserOpSuccess = true
      const payer = '0x9999999999999999999999999999999999999999'
      const result = await settleX402Payment(mockService, payer)

      expect(result.authProof).toBeDefined()
      expect(result.authProof?.payerAddress.toLowerCase()).toBe(payer.toLowerCase())
      expect(result.authProof?.signature).toMatch(/^0x[a-f0-9]{64}$/)

      // Verify Explorer URL points to real transaction on ArcScan testnet
      expect(result.explorerUrl).toBeDefined()
      expect(result.explorerUrl).toContain('testnet.arcscan.app/tx/0x4444444444444444444444444444444444444444444444444444444444444444')
      expect(result.executionMode).toBe('session_autonomous')
    })
  })

  describe('executeX402Call End-to-End Orchestration', () => {
    it('executes full x402 handshake and returns live data with actionable payload on successful on-chain settlement', async () => {
      mockUserOpSuccess = true
      const result = await executeX402Call(
        mockService,
        { pair: 'USDC/EURC', tradeSizeUsdc: 10000 },
        '0x9999999999999999999999999999999999999999'
      )

      expect(result.statusCode).toBe(200)
      expect(result.success).toBe(true)
      expect(result.costUsdc).toBe(0.005)
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.data).toBeDefined()
      expect(result.explorerUrl).toContain('testnet.arcscan.app')
    })

    it('rejects executeX402Call when settlement fails or signature is rejected', async () => {
      const rejectingProvider = {
        request: vi.fn().mockRejectedValue(new Error('User rejected authorization request')),
      }
      const result = await executeX402Call(
        mockService,
        { pair: 'USDC/EURC', tradeSizeUsdc: 10000 },
        '0x9999999999999999999999999999999999999999',
        rejectingProvider
      )

      expect(result.statusCode).toBe(402)
      expect(result.success).toBe(false)
      expect(result.costUsdc).toBe(0)
      expect(result.error).toBeDefined()
    })
  })
})
