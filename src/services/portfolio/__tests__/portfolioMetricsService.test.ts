import { describe, it, expect } from 'vitest'
import {
  ORDERED_CHAIN_KEYS,
  getNativeGasPrice,
  calculatePortfolioStats,
  calculateAggregatedAssets,
  getChainTotalUsd,
  filterAndSortChains,
} from '../portfolioMetricsService'

describe('portfolioMetricsService', () => {
  describe('getNativeGasPrice', () => {
    it('returns 1.0 for USDC', () => {
      expect(getNativeGasPrice('USDC')).toBe(1.0)
    })

    it('returns custom or fallback prices for known tokens', () => {
      expect(getNativeGasPrice('ETH', { ETH: 3000 })).toBe(3000)
      expect(getNativeGasPrice('ETH', null)).toBe(2500)
      expect(getNativeGasPrice('POL', null)).toBe(0.4)
      expect(getNativeGasPrice('AVAX', null)).toBe(26.5)
      expect(getNativeGasPrice('SEI', null)).toBe(0.35)
      expect(getNativeGasPrice('S', null)).toBe(0.65)
    })

    it('returns fallback or 0 for unknown tokens', () => {
      expect(getNativeGasPrice('CUSTOM', { CUSTOM: 42 })).toBe(42)
      expect(getNativeGasPrice('UNKNOWN', null)).toBe(0)
    })
  })

  describe('calculatePortfolioStats', () => {
    it('accurately sums multi-chain assets', () => {
      const mockBalances = {
        Arc_Testnet: {
          chainName: 'Arc Testnet',
          usdc: '100.00',
          eurc: '50.00',
          cirbtc: '0.01',
          weth: '0.5',
          nativeAmount: '100.00', // On Arc, native is USDC - not counted towards native amounts
          nativeSymbol: 'USDC',
        },
        Base_Sepolia: {
          chainName: 'Base Sepolia',
          usdc: '25.00',
          nativeAmount: '0.1',
          nativeSymbol: 'ETH',
        },
      }

      const mockPrices = {
        EURC: 1.10,
        cirBTC: 80000,
        WETH: 2000,
        ETH: 2000,
      }

      const stats = calculatePortfolioStats(mockBalances, mockPrices)

      expect(stats.totalUsdc).toBe(125)
      expect(stats.totalEurc).toBe(50)
      expect(stats.totalCirbtc).toBe(0.01)
      expect(stats.totalWeth).toBe(0.5)
      expect(stats.chainsWithBalance).toBe(2)

      // 125*1 + 50*1.10 + 0.01*80000 + 0.5*2000 + 0.1*2000 = 125 + 55 + 800 + 1000 + 200 = 2180
      expect(stats.totalUsd).toBe(2180)
    })
  })

  describe('calculateAggregatedAssets', () => {
    it('computes percentage allocations sorted by USD value descending', () => {
      const stats = {
        totalUsdc: 1000,
        totalEurc: 0,
        totalCirbtc: 0,
        totalWeth: 0,
        totalNativeUsd: 0,
        nativeAmounts: {},
        totalUsd: 1000,
        chainsWithBalance: 1,
      }

      const assets = calculateAggregatedAssets(stats, null)
      expect(assets[0].symbol).toBe('USDC')
      expect(assets[0].usdValue).toBe(1000)
      expect(assets[0].percentage).toBe(100)
    })
  })

  describe('getChainTotalUsd', () => {
    it('calculates chain valuation without double counting Arc native USDC', () => {
      const mockBalances = {
        Arc_Testnet: {
          usdc: '50.00',
          nativeAmount: '50.00',
          nativeSymbol: 'USDC',
        },
      }
      const total = getChainTotalUsd('Arc_Testnet', mockBalances, null)
      expect(total).toBe(50.00)
    })

    it('includes native gas valuation on non-Arc chains', () => {
      const mockBalances = {
        Ethereum_Sepolia: {
          usdc: '10.00',
          nativeAmount: '1.0',
          nativeSymbol: 'ETH',
        },
      }
      const prices = { ETH: 2500 }
      const total = getChainTotalUsd('Ethereum_Sepolia', mockBalances, prices)
      expect(total).toBe(2510) // 10 + 2500
    })
  })

  describe('filterAndSortChains', () => {
    it('filters by search query', () => {
      const mockBalances = {
        Arc_Testnet: { chainName: 'Arc Testnet', usdc: '10' },
        Base_Sepolia: { chainName: 'Base Sepolia', usdc: '20' },
      }

      const filtered = filterAndSortChains({
        chainKeys: ORDERED_CHAIN_KEYS,
        walletBalances: mockBalances,
        searchQuery: 'base',
        onlyNonZero: false,
      })

      expect(filtered).toContain('Base_Sepolia')
      expect(filtered).not.toContain('Arc_Testnet')
    })

    it('sorts chains by total USD valuation descending', () => {
      const mockBalances = {
        Arc_Testnet: { chainName: 'Arc Testnet', usdc: '10' },
        Base_Sepolia: { chainName: 'Base Sepolia', usdc: '500' },
        Ethereum_Sepolia: { chainName: 'Ethereum Sepolia', usdc: '50' },
      }

      const sorted = filterAndSortChains({
        chainKeys: ORDERED_CHAIN_KEYS,
        walletBalances: mockBalances,
        searchQuery: '',
        onlyNonZero: false,
      })

      expect(sorted[0]).toBe('Base_Sepolia')
      expect(sorted[1]).toBe('Ethereum_Sepolia')
      expect(sorted[2]).toBe('Arc_Testnet')
    })
  })
})
