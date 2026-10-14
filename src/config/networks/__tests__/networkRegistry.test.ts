import { describe, it, expect } from 'vitest'
import {
  TESTNET_NETWORKS,
  MAINNET_NETWORKS,
  ALL_NETWORKS,
  getNetwork,
  getNetworkByChainId,
  getNetworksByCapability,
  supportsCapability,
  getNetworksByAdapter,
  supportsAdapter,
  getNetworkAdapters,
  getNetworkShortName,
  getNetworkCapabilities,
} from '../networkRegistry'

describe('Centralized Master Network Registry', () => {
  describe('Data Integrity & Schema Completeness', () => {
    it('defines shortName, capabilities, adapters, and ui for every testnet network', () => {
      for (const [key, net] of Object.entries(TESTNET_NETWORKS)) {
        expect(net.key).toBe(key)
        expect(net.name).toBeTruthy()
        expect(net.shortName).toBeTruthy()
        expect(typeof net.shortName).toBe('string')
        expect(net.shortName.length).toBeGreaterThanOrEqual(2)
        expect(net.chainId).toBeGreaterThan(0)
        expect(net.testnet).toBe(true)
        expect(net.capabilities).toBeDefined()
        expect(typeof net.capabilities.send).toBe('boolean')
        expect(typeof net.capabilities.bridge).toBe('boolean')
        expect(typeof net.capabilities.swap).toBe('boolean')
        expect(typeof net.capabilities.gateway).toBe('boolean')
        expect(typeof net.capabilities.ucw).toBe('boolean')
        expect(net.adapters).toBeDefined()
        expect(typeof net.adapters.viem).toBe('boolean')
        expect(typeof net.adapters.ethers).toBe('boolean')
        expect(typeof net.adapters.circleWallets).toBe('boolean')
        expect(typeof net.adapters.solana).toBe('boolean')
        expect(net.ui).toBeDefined()
        expect(net.ui.iconId).toBeTruthy()
        expect(net.rpcUrls?.primary).toBeTruthy()
        expect(net.viemChain?.id).toBe(net.chainId)
      }
    })

    it('defines shortName, capabilities, adapters, and ui for every mainnet network', () => {
      for (const [key, net] of Object.entries(MAINNET_NETWORKS)) {
        expect(net.key).toBe(key)
        expect(net.name).toBeTruthy()
        expect(net.shortName).toBeTruthy()
        expect(net.chainId).toBeGreaterThan(0)
        expect(net.testnet).toBe(false)
        expect(net.capabilities).toBeDefined()
        expect(typeof net.capabilities.send).toBe('boolean')
        expect(typeof net.capabilities.swap).toBe('boolean')
        expect(net.adapters).toBeDefined()
        expect(typeof net.adapters.viem).toBe('boolean')
        expect(typeof net.adapters.ethers).toBe('boolean')
        expect(typeof net.adapters.circleWallets).toBe('boolean')
        expect(typeof net.adapters.solana).toBe('boolean')
        expect(net.ui).toBeDefined()
        expect(net.ui.iconId).toBeTruthy()
        expect(net.viemChain?.id).toBe(net.chainId)
      }
    })

    it('contains all 26 testnet networks matching official Arc documentation', () => {
      const expectedKeys = [
        'Arc_Testnet',
        'Ethereum_Sepolia',
        'Base_Sepolia',
        'Arbitrum_Sepolia',
        'Optimism_Sepolia',
        'Polygon_Amoy_Testnet',
        'Avalanche_Fuji',
        'HyperEVM_Testnet',
        'Sei_Testnet',
        'Sonic_Testnet',
        'Unichain_Sepolia',
        'World_Chain_Sepolia',
        'Solana_Devnet',
        'Monad_Testnet',
        'Ink_Testnet',
        'Linea_Sepolia',
        'Plume_Testnet',
        'Injective_Testnet',
        'XDC_Apothem',
        'Codex_Testnet',
        'Cronos_Testnet',
        'Edge_Testnet',
        'Morph_Testnet',
        'Pharos_Testnet',
        'Plasma_Testnet',
        'X_Layer_Testnet',
      ]

      expect(Object.keys(TESTNET_NETWORKS).length).toBe(26)
      for (const key of expectedKeys) {
        expect(TESTNET_NETWORKS[key]).toBeDefined()
        expect(TESTNET_NETWORKS[key].key).toBe(key)
      }
    })
  })

  describe('Capabilities Matrix', () => {
    it('correctly isolates swap capability on testnet to Arc Testnet', () => {
      const testnetSwapChains = getNetworksByCapability('swap', true)
      expect(testnetSwapChains.map((n) => n.key)).toEqual(['Arc_Testnet'])

      expect(supportsCapability('Arc_Testnet', 'swap')).toBe(true)
      expect(supportsCapability('Ethereum_Sepolia', 'swap')).toBe(false)
      expect(supportsCapability('Base_Sepolia', 'swap')).toBe(false)
      expect(supportsCapability('Monad_Testnet', 'swap')).toBe(false)
    })

    it('marks onramp, earn, and borrow on Arc network', () => {
      expect(supportsCapability('Arc_Testnet', 'onramp')).toBe(true)
      expect(supportsCapability('Arc_Testnet', 'earn')).toBe(true)
      expect(supportsCapability('Arc_Testnet', 'borrow')).toBe(true)
      expect(supportsCapability('Ethereum_Sepolia', 'onramp')).toBe(false)
    })

    it('filters send-capable networks', () => {
      const sendNetworks = getNetworksByCapability('send', true)
      expect(sendNetworks.length).toBe(26)
      expect(sendNetworks.some((n) => n.key === 'Solana_Devnet')).toBe(true)
      expect(supportsCapability('Arc_Testnet', 'send')).toBe(true)
      expect(supportsCapability('Monad_Testnet', 'send')).toBe(true)
      expect(supportsCapability('Codex_Testnet', 'send')).toBe(true)
      expect(supportsCapability('Plasma_Testnet', 'send')).toBe(true)
      expect(supportsCapability('Solana_Devnet', 'send')).toBe(true)
    })

    it('filters gateway and unifiedBalance capable networks (13 chains)', () => {
      const gatewayNetworks = getNetworksByCapability('gateway', true)
      const unifiedNetworks = getNetworksByCapability('unifiedBalance', true)
      // Gateway & Unified Balance are strictly available on the 13 official gateway testnet domains
      expect(gatewayNetworks.length).toBe(13)
      expect(unifiedNetworks.length).toBe(13)
      expect(gatewayNetworks.some((n) => n.key === 'Arc_Testnet')).toBe(true)
      expect(gatewayNetworks.some((n) => n.key === 'Ethereum_Sepolia')).toBe(true)
      expect(gatewayNetworks.some((n) => n.key === 'Solana_Devnet')).toBe(true)
      expect(gatewayNetworks.some((n) => n.key === 'Codex_Testnet')).toBe(false)
      expect(gatewayNetworks.some((n) => n.key === 'Plasma_Testnet')).toBe(false)
    })

    it('filters ucw-capable networks', () => {
      const ucwNetworks = getNetworksByCapability('ucw', true)
      expect(ucwNetworks.some((n) => n.key === 'Arc_Testnet')).toBe(true)
      expect(ucwNetworks.some((n) => n.key === 'Base_Sepolia')).toBe(true)
      expect(ucwNetworks.some((n) => n.key === 'Monad_Testnet')).toBe(true)
      expect(ucwNetworks.some((n) => n.key === 'Cronos_Testnet')).toBe(true)
      expect(ucwNetworks.some((n) => n.key === 'Plasma_Testnet')).toBe(true)
      expect(ucwNetworks.some((n) => n.key === 'Ink_Testnet')).toBe(false)
    })
  })

  describe('Adapters Matrix', () => {
    it('accurately resolves Circle Wallets adapter support', () => {
      const circleWalletChains = getNetworksByAdapter('circleWallets', true)
      const expectedCircleWalletChains = [
        'Arc_Testnet',
        'Ethereum_Sepolia',
        'Base_Sepolia',
        'Arbitrum_Sepolia',
        'Optimism_Sepolia',
        'Polygon_Amoy_Testnet',
        'Avalanche_Fuji',
        'Unichain_Sepolia',
        'Solana_Devnet',
        'Cronos_Testnet',
        'Plasma_Testnet',
      ]

      expect(circleWalletChains.length).toBe(11)
      for (const k of expectedCircleWalletChains) {
        expect(supportsAdapter(k, 'circleWallets')).toBe(true)
      }
      expect(supportsAdapter('Codex_Testnet', 'circleWallets')).toBe(false)
      expect(supportsAdapter('Monad_Testnet', 'circleWallets')).toBe(false)
    })

    it('accurately resolves Viem and Ethers adapter support across all EVM chains', () => {
      const viemChains = getNetworksByAdapter('viem', true)
      const ethersChains = getNetworksByAdapter('ethers', true)
      expect(viemChains.length).toBe(25)
      expect(ethersChains.length).toBe(25)
      expect(supportsAdapter('Solana_Devnet', 'viem')).toBe(false)
      expect(supportsAdapter('Solana_Devnet', 'ethers')).toBe(false)
      expect(supportsAdapter('Codex_Testnet', 'viem')).toBe(true)
      expect(supportsAdapter('X_Layer_Testnet', 'ethers')).toBe(true)
    })

    it('accurately isolates Solana adapter to Solana networks', () => {
      const solanaChains = getNetworksByAdapter('solana', true)
      expect(solanaChains.map((c) => c.key)).toEqual(['Solana_Devnet'])
      expect(supportsAdapter('Solana_Devnet', 'solana')).toBe(true)
      expect(supportsAdapter('Arc_Testnet', 'solana')).toBe(false)
    })

    it('retrieves full adapters configuration object', () => {
      const arcAdapters = getNetworkAdapters('Arc_Testnet')
      expect(arcAdapters).toEqual({
        viem: true,
        ethers: true,
        circleWallets: true,
        solana: false,
      })
    })
  })

  describe('Runtime Helpers', () => {
    it('retrieves shortName accurately', () => {
      expect(getNetworkShortName('Arc_Testnet')).toBe('ARC')
      expect(getNetworkShortName('Ethereum_Sepolia')).toBe('ETH')
      expect(getNetworkShortName('Base_Sepolia')).toBe('BASE')
      expect(getNetworkShortName('Monad_Testnet')).toBe('MON')
      expect(getNetworkShortName('Ink_Testnet')).toBe('INK')
      expect(getNetworkShortName('Linea_Sepolia')).toBe('LINEA')
      expect(getNetworkShortName('Plume_Testnet')).toBe('PLUME')
      expect(getNetworkShortName('Injective_Testnet')).toBe('INJ')
      expect(getNetworkShortName('XDC_Apothem')).toBe('XDC')
      expect(getNetworkShortName('Codex_Testnet')).toBe('CDX')
      expect(getNetworkShortName('Cronos_Testnet')).toBe('CRO')
      expect(getNetworkShortName('Edge_Testnet')).toBe('EDGE')
      expect(getNetworkShortName('Morph_Testnet')).toBe('MORPH')
      expect(getNetworkShortName('Pharos_Testnet')).toBe('PHAROS')
      expect(getNetworkShortName('Plasma_Testnet')).toBe('PLASM')
      expect(getNetworkShortName('X_Layer_Testnet')).toBe('XLAYER')
    })

    it('retrieves network by numeric chain ID', () => {
      expect(getNetworkByChainId(5042002)?.key).toBe('Arc_Testnet')
      expect(getNetworkByChainId(11155111)?.key).toBe('Ethereum_Sepolia')
      expect(getNetworkByChainId(84532)?.key).toBe('Base_Sepolia')
      expect(getNetworkByChainId(812242)?.key).toBe('Codex_Testnet')
      expect(getNetworkByChainId(338)?.key).toBe('Cronos_Testnet')
      expect(getNetworkByChainId(33431)?.key).toBe('Edge_Testnet')
      expect(getNetworkByChainId(2910)?.key).toBe('Morph_Testnet')
      expect(getNetworkByChainId(688689)?.key).toBe('Pharos_Testnet')
      expect(getNetworkByChainId(9746)?.key).toBe('Plasma_Testnet')
      expect(getNetworkByChainId(1952)?.key).toBe('X_Layer_Testnet')
    })

    it('safely handles non-existent or undefined chain queries', () => {
      expect(getNetwork('')).toBeUndefined()
      expect(getNetwork(undefined)).toBeUndefined()
      expect(getNetwork('Unknown_Chain_12345')).toBeUndefined()
      expect(supportsCapability(undefined, 'send')).toBe(false)
      expect(supportsCapability('NonExistent', 'send')).toBe(false)
      expect(supportsAdapter(undefined, 'viem')).toBe(false)
      expect(supportsAdapter('NonExistent', 'viem')).toBe(false)
      expect(getNetworkShortName(undefined)).toBe('')
      expect(getNetworkCapabilities(undefined)).toBeUndefined()
      expect(getNetworkAdapters(undefined)).toBeUndefined()
    })
  })
})
