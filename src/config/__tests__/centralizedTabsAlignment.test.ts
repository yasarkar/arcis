// src/config/__tests__/centralizedTabsAlignment.test.ts
// Unit tests verifying that the Send and Unified Balance tabs are fed directly
// from the Centralized Master Network Registry (networkRegistry.ts) with zero drift.

import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_SEND_CHAINS,
  getSendTokensForChain,
  isTokenSupportedOnSendChain,
} from '../sendConfig'
import {
  GATEWAY_DOMAINS_TESTNET,
  GATEWAY_SUPPORTED_CHAINS,
  getGatewaySupportedNetworks,
  getGatewayNetworkFeatures,
} from '../gatewayConfig'
import {
  TESTNET_NETWORKS,
  getNetworksByCapability,
  supportsCapability,
} from '../networks/networkRegistry'

describe('Centralized Architecture Alignment: Send & Unified Balance Tabs', () => {
  describe('Send Tab Network & Token Registry Derivation', () => {
    it('derives SUPPORTED_SEND_CHAINS strictly from getNetworksByCapability("send")', () => {
      const sendNetworks = getNetworksByCapability('send', true)
      expect(SUPPORTED_SEND_CHAINS.length).toBe(sendNetworks.length)
      expect(SUPPORTED_SEND_CHAINS.length).toBe(26) // All 26 testnets (including Solana Devnet)

      for (const chain of SUPPORTED_SEND_CHAINS) {
        expect(supportsCapability(chain.chain, 'send')).toBe(true)
      }
      expect(SUPPORTED_SEND_CHAINS.some((c) => c.chain === 'Solana_Devnet')).toBe(true)
    })

    it('returns exact token list for chains via getSendTokensForChain', () => {
      // Arc Testnet: USDC, EURC, cirBTC
      const arcTokens = getSendTokensForChain('Arc_Testnet')
      expect(arcTokens).toContain('USDC')
      expect(arcTokens).toContain('EURC')
      expect(arcTokens).toContain('cirBTC')

      // Ethereum Sepolia: USDC, EURC, cirBTC, WETH, ETH
      const ethTokens = getSendTokensForChain('Ethereum_Sepolia')
      expect(ethTokens).toContain('USDC')
      expect(ethTokens).toContain('EURC')
      expect(ethTokens).toContain('cirBTC')
      expect(ethTokens).toContain('WETH')
      expect(ethTokens).toContain('ETH')

      // Injective Testnet: USDC, INJ (no EURC, no cirBTC)
      const injTokens = getSendTokensForChain('Injective_Testnet')
      expect(injTokens).toContain('USDC')
      expect(injTokens).toContain('INJ')
      expect(injTokens).not.toContain('EURC')
      expect(injTokens).not.toContain('cirBTC')

      // Codex Testnet: USDC, ETH (no EURC, no cirBTC)
      const cdxTokens = getSendTokensForChain('Codex_Testnet')
      expect(cdxTokens).toContain('USDC')
      expect(cdxTokens).toContain('ETH')
      expect(cdxTokens).not.toContain('EURC')
      expect(cdxTokens).not.toContain('cirBTC')
    })

    it('accurately verifies token support on send chains via isTokenSupportedOnSendChain', () => {
      expect(isTokenSupportedOnSendChain('Arc_Testnet', 'USDC')).toBe(true)
      expect(isTokenSupportedOnSendChain('Arc_Testnet', 'EURC')).toBe(true)
      expect(isTokenSupportedOnSendChain('Arc_Testnet', 'cirBTC')).toBe(true)

      expect(isTokenSupportedOnSendChain('Injective_Testnet', 'USDC')).toBe(true)
      expect(isTokenSupportedOnSendChain('Injective_Testnet', 'INJ')).toBe(true)
      expect(isTokenSupportedOnSendChain('Injective_Testnet', 'EURC')).toBe(false)
      expect(isTokenSupportedOnSendChain('Injective_Testnet', 'cirBTC')).toBe(false)
    })
  })

  describe('Unified Balance Tab Network & Capabilities Derivation', () => {
    it('strictly confines GATEWAY_DOMAINS_TESTNET to the 13 official Circle Gateway domains', () => {
      expect(Object.keys(GATEWAY_DOMAINS_TESTNET).length).toBe(13)
      expect(GATEWAY_SUPPORTED_CHAINS.length).toBe(13)

      const expectedChains = [
        'Arbitrum_Sepolia',
        'Arc_Testnet',
        'Avalanche_Fuji',
        'Base_Sepolia',
        'Ethereum_Sepolia',
        'HyperEVM_Testnet',
        'Optimism_Sepolia',
        'Polygon_Amoy_Testnet',
        'Sei_Testnet',
        'Solana_Devnet',
        'Sonic_Testnet',
        'Unichain_Sepolia',
        'World_Chain_Sepolia',
      ]

      for (const chainKey of expectedChains) {
        expect(GATEWAY_DOMAINS_TESTNET[chainKey]).toBeDefined()
        expect(GATEWAY_SUPPORTED_CHAINS).toContain(chainKey)
      }

      // New testnets not supported by Gateway must not leak into GATEWAY_DOMAINS_TESTNET
      const nonGatewayTestnets = ['Codex_Testnet', 'Cronos_Testnet', 'Edge_Testnet', 'Morph_Testnet', 'Pharos_Testnet', 'Plasma_Testnet', 'X_Layer_Testnet']
      for (const nonGateway of nonGatewayTestnets) {
        expect(GATEWAY_DOMAINS_TESTNET[nonGateway]).toBeUndefined()
        expect(GATEWAY_SUPPORTED_CHAINS).not.toContain(nonGateway)
      }
    })

    it('returns 13 NetworkConfig items via getGatewaySupportedNetworks() matching capability: "unifiedBalance"', () => {
      const networks = getGatewaySupportedNetworks()
      expect(networks.length).toBe(13)
      for (const net of networks) {
        expect(supportsCapability(net.key, 'unifiedBalance')).toBe(true)
        expect(net.cctpDomain).toBeDefined()
        expect(net.tokens.USDC).toBeDefined()
      }
    })

    it('returns rich feature descriptors for every Gateway network via getGatewayNetworkFeatures()', () => {
      const features = getGatewayNetworkFeatures()
      expect(features.length).toBe(13)

      for (const item of features) {
        expect(item.chainKey).toBeTruthy()
        expect(item.name).toBeTruthy()
        expect(item.shortName).toBeTruthy()
        expect(typeof item.domainId).toBe('number')
        expect(item.token).toBe('USDC')
        expect(item.settlementSpeed).toBe('< 1s Instant')
        expect(item.feeTier).toBe('0% Platform Fee')
        expect(item.iconId).toBeTruthy()

        if (item.chainKey === 'Solana_Devnet') {
          expect(item.isSolana).toBe(true)
          expect(item.canDeposit).toBe(false)
        } else {
          expect(item.isSolana).toBe(false)
          expect(item.canDeposit).toBe(true)
        }
      }
    })
  })
})
