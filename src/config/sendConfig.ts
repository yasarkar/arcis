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
  type NetworkConfig,
} from './networks/networkRegistry'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName }
export const SEND_CHAIN_META = CHAIN_META
export const SEND_CHAIN_DEFS = CHAIN_DEFS
export const getSendChainIconId = getChainIconId

export interface ChainConfig {
  chain: string
  name: string
  tokens: string[]
  nativeSymbol: string
  explorerUrl: string
}

/**
 * Dynamically derived supported chains for Send / Transfer operations.
 * Single source of truth from ACTIVE_NETWORKS.
 */
export const SUPPORTED_SEND_CHAINS: ChainConfig[] = Object.values(ACTIVE_NETWORKS).map((net) => {
  const explorerBase = net.blockExplorers?.url || 'https://testnet.arcscan.app'
  const isTxPath = net.key.toLowerCase().includes('injective') ? '/transaction/{hash}' : '/tx/{hash}'
  return {
    chain: net.key,
    name: net.name,
    tokens: Object.keys(net.tokens),
    nativeSymbol: net.nativeCurrency.symbol,
    explorerUrl: `${explorerBase}${isTxPath}`,
  }
})

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
