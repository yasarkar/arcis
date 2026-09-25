import { describe, it, expect, vi } from 'vitest'
import {
  normalizeCircleBlockchain,
  resolveUcwTokenAddress,
} from '../../components/SendModal'
import { USDC_ADDRESSES, EURC_ADDRESSES } from '../../config/gatewayConfig'
import { mapChainKeyToCircleBlockchain } from '../gatewayUcwService'
import { getExplorerTxUrl } from '../../config/sendConfig'

describe('SendModal UCW Multi-Chain & Token Resolution Tests', () => {
  describe('normalizeCircleBlockchain & mapChainKeyToCircleBlockchain', () => {
    it('accurately resolves Circle blockchain identifiers for all EVM networks', () => {
      expect(normalizeCircleBlockchain('Arc_Testnet')).toBe('ARC-TESTNET')
      expect(normalizeCircleBlockchain('Base_Sepolia')).toBe('BASE-SEPOLIA')
      expect(normalizeCircleBlockchain('Ethereum_Sepolia')).toBe('ETH-SEPOLIA')
      expect(normalizeCircleBlockchain('Arbitrum_Sepolia')).toBe('ARB-SEPOLIA')
      expect(normalizeCircleBlockchain('Optimism_Sepolia')).toBe('OP-SEPOLIA')
      expect(normalizeCircleBlockchain('Avalanche_Fuji')).toBe('AVAX-FUJI')
      expect(normalizeCircleBlockchain('Polygon_Amoy_Testnet')).toBe('MATIC-AMOY')
      expect(normalizeCircleBlockchain('Polygon_Amoy')).toBe('MATIC-AMOY')
    })

    it('prevents substring collision (e.g. Arbitrum_Sepolia does not resolve to ETH-SEPOLIA)', () => {
      expect(normalizeCircleBlockchain('Arbitrum_Sepolia')).not.toBe('ETH-SEPOLIA')
      expect(normalizeCircleBlockchain('Arbitrum_Sepolia')).toBe('ARB-SEPOLIA')

      expect(normalizeCircleBlockchain('Optimism_Sepolia')).not.toBe('ETH-SEPOLIA')
      expect(normalizeCircleBlockchain('Optimism_Sepolia')).toBe('OP-SEPOLIA')
    })

    it('defaults safely to ARC-TESTNET when undefined or empty', () => {
      expect(normalizeCircleBlockchain()).toBe('ARC-TESTNET')
      expect(normalizeCircleBlockchain('')).toBe('ARC-TESTNET')
    })
  })

  describe('resolveUcwTokenAddress', () => {
    it('resolves empty string for native USDC on Arc Testnet', () => {
      const address = resolveUcwTokenAddress('Arc_Testnet', 'USDC', false)
      expect(address).toBe('')
    })

    it('resolves actual ERC-20 contract address for USDC on Base Sepolia', () => {
      const address = resolveUcwTokenAddress('Base_Sepolia', 'USDC', false)
      expect(address).toBe(USDC_ADDRESSES['Base_Sepolia'])
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(address).not.toBe('')
    })

    it('resolves actual ERC-20 contract address for USDC on Ethereum Sepolia', () => {
      const address = resolveUcwTokenAddress('Ethereum_Sepolia', 'USDC', false)
      expect(address).toBe(USDC_ADDRESSES['Ethereum_Sepolia'])
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('resolves actual ERC-20 contract address for USDC on Arbitrum Sepolia', () => {
      const address = resolveUcwTokenAddress('Arbitrum_Sepolia', 'USDC', false)
      expect(address).toBe(USDC_ADDRESSES['Arbitrum_Sepolia'])
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })

    it('resolves EURC token contract address when EURC is selected', () => {
      const address = resolveUcwTokenAddress('Base_Sepolia', 'EURC', false)
      expect(address).toBe(EURC_ADDRESSES['Base_Sepolia'])
    })

    it('resolves empty string for NATIVE currency (e.g. Sepolia ETH, POL)', () => {
      const address = resolveUcwTokenAddress('Base_Sepolia', 'NATIVE', false)
      expect(address).toBe('')
    })

    it('returns custom token address verbatim when isCustomToken is true', () => {
      const customAddr = '0x1234567890123456789012345678901234567890'
      const address = resolveUcwTokenAddress('Arc_Testnet', 'CUSTOM', true, customAddr)
      expect(address).toBe(customAddr)
    })
  })

  describe('UCW Multi-chain Transfer Workflow Simulation', () => {
    it('simulates Arc Testnet transfer parameter payload', async () => {
      const mockExecuteUcw = vi.fn().mockResolvedValue({
        success: true,
        txHash: '0xabc1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcd',
      })

      const chain = 'Arc_Testnet'
      const token = 'USDC'
      const amount = '25.5'
      const recipient = '0x2222222222222222222222222222222222222222'

      const circleBlockchain = normalizeCircleBlockchain(chain)
      const tokenAddress = resolveUcwTokenAddress(chain, token, false)

      const result = await mockExecuteUcw({
        destinationAddress: recipient,
        amount,
        tokenSymbol: token,
        tokenAddress,
        blockchain: circleBlockchain,
        feeLevel: 'HIGH',
      })

      expect(mockExecuteUcw).toHaveBeenCalledWith({
        destinationAddress: recipient,
        amount: '25.5',
        tokenSymbol: 'USDC',
        tokenAddress: '', // Native USDC gas on Arc
        blockchain: 'ARC-TESTNET',
        feeLevel: 'HIGH',
      })
      expect(result.success).toBe(true)
      expect(result.txHash).toBeDefined()
    })

    it('simulates Base Sepolia transfer parameter payload with ERC-20 contract address', async () => {
      const mockExecuteUcw = vi.fn().mockResolvedValue({
        success: true,
        txHash: '0xdef9876543210fedcba9876543210fedcba9876543210fedcba9876543210fedc',
      })

      const chain = 'Base_Sepolia'
      const token = 'USDC'
      const amount = '50'
      const recipient = '0x3333333333333333333333333333333333333333'

      const circleBlockchain = normalizeCircleBlockchain(chain)
      const tokenAddress = resolveUcwTokenAddress(chain, token, false)

      const result = await mockExecuteUcw({
        destinationAddress: recipient,
        amount,
        tokenSymbol: token,
        tokenAddress,
        blockchain: circleBlockchain,
        feeLevel: 'MEDIUM',
      })

      expect(mockExecuteUcw).toHaveBeenCalledWith({
        destinationAddress: recipient,
        amount: '50',
        tokenSymbol: 'USDC',
        tokenAddress: USDC_ADDRESSES['Base_Sepolia'], // ERC-20 token address
        blockchain: 'BASE-SEPOLIA',
        feeLevel: 'MEDIUM',
      })
      expect(result.success).toBe(true)

      const explorerUrl = getExplorerTxUrl(chain, result.txHash)
      expect(explorerUrl).toContain(result.txHash)
    })
  })
})
