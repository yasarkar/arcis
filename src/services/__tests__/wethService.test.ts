import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getWethAddress, canAutoWrapEth, wrapEth, unwrapWeth } from '../wethService'

const mockWaitForReceipt = vi.fn().mockResolvedValue({ status: 'success' })

vi.mock('../rpc', () => ({
  getResilientPublicClient: vi.fn(() => ({
    waitForTransactionReceipt: mockWaitForReceipt,
  })),
}))

describe('wethService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getWethAddress', () => {
    it('returns official canonical Sepolia WETH address', () => {
      const addr = getWethAddress('Ethereum_Sepolia')
      expect(addr).toBe('0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9')
    })

    it('returns official Base Sepolia WETH address', () => {
      const addr = getWethAddress('Base_Sepolia')
      expect(addr).toBe('0x4200000000000000000000000000000000000006')
    })

    it('returns Arc Testnet WETH address', () => {
      const addr = getWethAddress('Arc_Testnet')
      expect(addr).toBe('0x2c4047028a72803939b6fb674D01bC059B5C4961')
    })

    it('returns null for unknown chain or empty string', () => {
      expect(getWethAddress('')).toBeNull()
      expect(getWethAddress('NonExistent_Chain')).toBeNull()
    })
  })

  describe('canAutoWrapEth', () => {
    it('returns true for Ethereum Sepolia (EVM with native ETH)', () => {
      expect(canAutoWrapEth('Ethereum_Sepolia')).toBe(true)
    })

    it('returns true for Base Sepolia (EVM with native ETH)', () => {
      expect(canAutoWrapEth('Base_Sepolia')).toBe(true)
    })

    it('returns false for Arc Testnet (native gas is USDC, not ETH)', () => {
      expect(canAutoWrapEth('Arc_Testnet')).toBe(false)
      expect(canAutoWrapEth('Arc')).toBe(false)
    })

    it('returns false for unknown or invalid chains', () => {
      expect(canAutoWrapEth('')).toBe(false)
      expect(canAutoWrapEth('Solana_Devnet')).toBe(false)
    })
  })

  describe('wrapEth', () => {
    it('throws error when provider is missing or invalid', async () => {
      await expect(
        wrapEth({
          provider: null,
          chainKey: 'Ethereum_Sepolia',
          amount: '0.1',
        })
      ).rejects.toThrow('No wallet provider available')
    })

    it('throws error when amount is zero or negative', async () => {
      const mockProvider = { request: vi.fn() }
      await expect(
        wrapEth({
          provider: mockProvider,
          chainKey: 'Ethereum_Sepolia',
          amount: '0',
        })
      ).rejects.toThrow('Wrap amount must be greater than zero')
    })

    it('throws error when WETH is not configured on network', async () => {
      const mockProvider = { request: vi.fn() }
      await expect(
        wrapEth({
          provider: mockProvider,
          chainKey: 'UnknownChain',
          amount: '0.5',
        })
      ).rejects.toThrow('WETH contract is not configured')
    })

    it('successfully sends deposit() transaction and awaits receipt', async () => {
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockProvider = {
        request: vi.fn().mockImplementation(async ({ method }) => {
          if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111']
          if (method === 'eth_sendTransaction') return mockTxHash
          return null
        }),
      }

      const result = await wrapEth({
        provider: mockProvider,
        chainKey: 'Ethereum_Sepolia',
        amount: '0.25',
        fromAddress: '0x1111111111111111111111111111111111111111',
      })

      expect(result.txHash).toBe(mockTxHash)
      expect(result.wethAddress).toBe('0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9')
      expect(result.amount).toBe('0.25')

      expect(mockProvider.request).toHaveBeenCalledWith({
        method: 'eth_sendTransaction',
        params: [
          expect.objectContaining({
            from: '0x1111111111111111111111111111111111111111',
            to: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
            value: '0x3782dace9d90000', // 0.25 ETH in hex
            data: '0xd0e30db0', // deposit() function selector
          }),
        ],
      })

      expect(mockWaitForReceipt).toHaveBeenCalledWith({ hash: mockTxHash })
    })
  })

  describe('unwrapWeth', () => {
    it('successfully sends withdraw(wad) transaction', async () => {
      const mockTxHash = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      const mockProvider = {
        request: vi.fn().mockImplementation(async ({ method }) => {
          if (method === 'eth_accounts') return ['0x1111111111111111111111111111111111111111']
          if (method === 'eth_sendTransaction') return mockTxHash
          return null
        }),
      }

      const result = await unwrapWeth({
        provider: mockProvider,
        chainKey: 'Ethereum_Sepolia',
        amount: '0.1',
        fromAddress: '0x1111111111111111111111111111111111111111',
      })

      expect(result.txHash).toBe(mockTxHash)
      expect(mockProvider.request).toHaveBeenCalledWith({
        method: 'eth_sendTransaction',
        params: [
          expect.objectContaining({
            from: '0x1111111111111111111111111111111111111111',
            to: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
          }),
        ],
      })
    })
  })
})
