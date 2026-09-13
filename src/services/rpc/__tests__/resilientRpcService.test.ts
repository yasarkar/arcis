import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getResilientPublicClient,
  getArcPublicClient,
  resilientReadContract,
  resilientGetBalance,
  resilientMulticall,
  resilientWriteContract,
  markEndpointCooldown,
  isEndpointInCooldown,
  resetEndpointCooldowns,
  getOrderedRpcUrls,
  getFromMicroCache,
  setInMicroCache,
  invalidateRpcCache,
} from '../resilientRpcService'
import { arcActiveChain } from '../../../config/arcChain'

describe('resilientRpcService Unit & Integration Tests', () => {
  beforeEach(() => {
    resetEndpointCooldowns()
    invalidateRpcCache()
    vi.clearAllMocks()
  })

  // ─────────────────────────────────────────────────────────────
  // 1. SINGLETON CONNECTION POOLING
  // ─────────────────────────────────────────────────────────────
  describe('Singleton Client Pooling', () => {
    it('returns the identical singleton instance on repeated calls for the same chain', () => {
      const client1 = getResilientPublicClient(arcActiveChain.id)
      const client2 = getResilientPublicClient(arcActiveChain.id)
      const client3 = getArcPublicClient()

      expect(client1).toBe(client2)
      expect(client1).toBe(client3)
    })

    it('returns valid chain ID and transport configuration', () => {
      const client = getArcPublicClient()
      expect(client.chain?.id).toBe(arcActiveChain.id)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 2. READ MICRO-CACHE & IN-FLIGHT DEDUPLICATION
  // ─────────────────────────────────────────────────────────────
  describe('Read Micro-Cache & Deduplication', () => {
    it('stores and retrieves values within TTL, and expires after TTL', async () => {
      setInMicroCache('test-key', { balance: '100.5' }, 50)
      expect(getFromMicroCache('test-key')).toEqual({ balance: '100.5' })

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60))
      expect(getFromMicroCache('test-key')).toBeUndefined()
    })

    it('invalidates cache matching pattern or completely', () => {
      setInMicroCache('read:5042002:0xabc:balanceOf:[]', 100n)
      setInMicroCache('read:5042002:0xdef:balanceOf:[]', 200n)
      setInMicroCache('bal:5042002:0xabc:latest', 500n)

      invalidateRpcCache('0xabc')
      expect(getFromMicroCache('read:5042002:0xabc:balanceOf:[]')).toBeUndefined()
      expect(getFromMicroCache('bal:5042002:0xabc:latest')).toBeUndefined()
      expect(getFromMicroCache('read:5042002:0xdef:balanceOf:[]')).toBe(200n)

      invalidateRpcCache()
      expect(getFromMicroCache('read:5042002:0xdef:balanceOf:[]')).toBeUndefined()
    })

    it('resilientReadContract serves subsequent call within TTL directly from micro-cache', async () => {
      const mockReadContract = vi.fn().mockResolvedValue(123456789n)
      const mockClient: any = {
        chain: { id: 5042002 },
        readContract: mockReadContract,
      }

      const params: any = {
        address: '0x3600000000000000000000000000000000000000',
        abi: [],
        functionName: 'balanceOf',
        args: ['0x1111111111111111111111111111111111111111'],
      }

      const res1 = await resilientReadContract(mockClient, params)
      const res2 = await resilientReadContract(mockClient, params)

      expect(res1).toBe(123456789n)
      expect(res2).toBe(123456789n)
      expect(mockReadContract).toHaveBeenCalledTimes(1) // Only 1 actual RPC query fired!
    })

    it('resilientGetBalance serves subsequent call within TTL directly from micro-cache', async () => {
      const mockGetBalance = vi.fn().mockResolvedValue(5000000000000000000n)
      const mockClient: any = {
        chain: { id: 5042002 },
        getBalance: mockGetBalance,
      }

      const params: any = {
        address: '0x1111111111111111111111111111111111111111',
      }

      const bal1 = await resilientGetBalance(mockClient, params)
      const bal2 = await resilientGetBalance(mockClient, params)

      expect(bal1).toBe(5000000000000000000n)
      expect(bal2).toBe(5000000000000000000n)
      expect(mockGetBalance).toHaveBeenCalledTimes(1)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 3. RESILIENT MULTICALL3
  // ─────────────────────────────────────────────────────────────
  describe('Resilient Multicall3', () => {
    it('returns empty array when contracts array is empty without calling RPC', async () => {
      const mockMulticall = vi.fn()
      const mockClient: any = { chain: { id: 5042002 }, multicall: mockMulticall }

      const result = await resilientMulticall(mockClient, [])
      expect(result).toEqual([])
      expect(mockMulticall).not.toHaveBeenCalled()
    })

    it('batches contract calls into client.multicall with allowFailure = true and micro-caches result', async () => {
      const mockResults = [
        { status: 'success', result: 1000n },
        { status: 'success', result: 2000n },
      ]
      const mockMulticall = vi.fn().mockResolvedValue(mockResults)
      const mockClient: any = { chain: { id: 5042002 }, multicall: mockMulticall }

      const contracts: any = [
        { address: '0xPool1', abi: [], functionName: 'reserveA' },
        { address: '0xPool1', abi: [], functionName: 'reserveB' },
      ]

      const res1 = await resilientMulticall(mockClient, contracts)
      const res2 = await resilientMulticall(mockClient, contracts)

      expect(res1).toEqual(mockResults)
      expect(res2).toEqual(mockResults)
      expect(mockMulticall).toHaveBeenCalledTimes(1)
      expect(mockMulticall).toHaveBeenCalledWith({
        contracts,
        allowFailure: true,
      })
    })

    it('retries on rate-limiting before resolving successfully', async () => {
      let attempts = 0
      const mockMulticall = vi.fn().mockImplementation(async () => {
        attempts++
        if (attempts === 1) {
          const err: any = new Error('Too many requests')
          err.code = 429
          throw err
        }
        return [{ status: 'success', result: 42n }]
      })

      const mockClient: any = { chain: { id: 5042002 }, multicall: mockMulticall }
      const contracts: any = [{ address: '0xPool1', abi: [], functionName: 'reserveA' }]

      const res = await resilientMulticall(mockClient, contracts)
      expect(res).toEqual([{ status: 'success', result: 42n }])
      expect(attempts).toBe(2)
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 4. CIRCUIT BREAKER & ENDPOINT COOLDOWN
  // ─────────────────────────────────────────────────────────────
  describe('Circuit Breaker & Endpoint Cooldown', () => {
    it('marks and checks endpoint in cooldown until expiration', async () => {
      const testUrl = 'https://rpc.degraded-node.test'
      expect(isEndpointInCooldown(testUrl)).toBe(false)

      markEndpointCooldown(testUrl, 40) // 40ms cooldown
      expect(isEndpointInCooldown(testUrl)).toBe(true)

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(isEndpointInCooldown(testUrl)).toBe(false)
    })

    it('reorders endpoints so healthy URLs precede cooldown URLs', () => {
      const urls = [
        'https://rpc1.test',
        'https://rpc2.test',
        'https://rpc3.test',
      ]

      // Mark rpc1 in cooldown
      markEndpointCooldown('https://rpc1.test', 10000)

      const ordered = getOrderedRpcUrls(urls)
      expect(ordered[0]).toBe('https://rpc2.test')
      expect(ordered[1]).toBe('https://rpc3.test')
      expect(ordered[2]).toBe('https://rpc1.test') // Quarantined URL placed last
    })
  })

  // ─────────────────────────────────────────────────────────────
  // 5. CACHE INVALIDATION ON WRITE TRANSACTIONS
  // ─────────────────────────────────────────────────────────────
  describe('Cache Invalidation on Write', () => {
    it('invalidates micro-cache when resilientWriteContract succeeds', async () => {
      setInMicroCache('read:balance', 1000n)
      expect(getFromMicroCache('read:balance')).toBe(1000n)

      const mockWalletClient: any = {
        writeContract: vi.fn().mockResolvedValue('0xTxHash123'),
      }

      const tx = await resilientWriteContract(mockWalletClient, {
        address: '0x123',
        abi: [],
        functionName: 'transfer',
      })

      expect(tx).toBe('0xTxHash123')
      expect(getFromMicroCache('read:balance')).toBeUndefined()
    })
  })
})
