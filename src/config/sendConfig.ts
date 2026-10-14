// src/config/sendConfig.ts
// Arcis Protocol Send Module Configuration (100% English)
// Backed dynamically by the Master Network Registry (src/config/networks/networkRegistry.ts).

import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainIconId,
  getChainDisplayName,
} from './chainMeta'
import {
  ACTIVE_NETWORKS,
  getNetwork,
  getNetworksByCapability,
  supportsCapability,
  IS_TESTNET,
  type NetworkConfig,
} from './networks/networkRegistry'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName }
export const SEND_CHAIN_META = CHAIN_META
export const SEND_CHAIN_DEFS = CHAIN_DEFS
export const getSendChainIconId = getChainIconId

export interface ChainConfig {
  chain: string
  name: string
  shortName: string
  tokens: string[]
  nativeSymbol: string
  explorerUrl: string
}

/**
 * Dynamically derived supported chains for Send / Transfer operations.
 * Single source of truth filtered by capability: 'send' from Master Network Registry.
 */
export const SUPPORTED_SEND_CHAINS: ChainConfig[] = getNetworksByCapability('send', IS_TESTNET).map((net) => {
  const explorerBase = net.blockExplorers?.url || 'https://testnet.arcscan.app'
  const isTxPath = net.key.toLowerCase().includes('injective') ? '/transaction/{hash}' : '/tx/{hash}'
  return {
    chain: net.key,
    name: net.name,
    shortName: net.shortName || net.name,
    tokens: Object.keys(net.tokens),
    nativeSymbol: net.nativeCurrency.symbol,
    explorerUrl: `${explorerBase}${isTxPath}`,
  }
})

/**
 * Helper to get the list of supported send tokens for a given chain from the Master Network Registry.
 */
export function getSendTokensForChain(chainKey: string): string[] {
  const net = getNetwork(chainKey)
  if (!net) return ['USDC']
  const tokenSet = new Set<string>(Object.keys(net.tokens))
  if (net.nativeCurrency?.symbol && net.nativeCurrency.symbol !== 'USDC') {
    tokenSet.add(net.nativeCurrency.symbol)
  }
  return Array.from(tokenSet)
}

/**
 * Check if a token symbol is supported for send on a given chain.
 */
export function isTokenSupportedOnSendChain(chainKey: string, tokenSymbol: string): boolean {
  return getSendTokensForChain(chainKey).includes(tokenSymbol)
}


/**
 * Resolves the transaction link on the appropriate block explorer for any chain.
 */
export function getExplorerTxUrl(chainKey?: string, txHash?: string): string {
  if (!txHash) return '#'
  const net = getNetwork(chainKey || 'Arc_Testnet')
  const baseUrl = net?.blockExplorers?.url || 'https://testnet.arcscan.app'

  if (net?.ui.isSolana) {
    return `${baseUrl}/tx/${txHash}?cluster=devnet`
  }
  if (net?.key.toLowerCase().includes('injective')) {
    return `${baseUrl}/transaction/${txHash}`
  }
  return `${baseUrl}/tx/${txHash}`
}

/**
 * Resolves the address link on the appropriate block explorer for any chain.
 */
export function getExplorerAddressUrl(chainKey?: string, address?: string): string {
  if (!address) return '#'
  const net = getNetwork(chainKey || 'Arc_Testnet')
  const baseUrl = net?.blockExplorers?.url || 'https://testnet.arcscan.app'

  if (net?.ui.isSolana) {
    return `${baseUrl}/address/${address}?cluster=devnet`
  }
  if (net?.key.toLowerCase().includes('injective')) {
    return `${baseUrl}/account/${address}`
  }
  return `${baseUrl}/address/${address}`
}

/**
 * Returns the human-readable block explorer name (e.g. ArcScan, Basescan, Arbiscan).
 */
export function getExplorerName(chainKey?: string): string {
  const net = getNetwork(chainKey || 'Arc_Testnet')
  return net?.blockExplorers?.name || 'ArcScan'
}
