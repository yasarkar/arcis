// Centralized Chain Metadata, Web3 Icons, and Viem Chain Definitions
// Backwards-compatible adapter backed by src/config/networks/networkRegistry.ts
// (Decoupled from Wagmi/RainbowKit to prevent SSR module leaks)
import {
  CHAIN_META as REGISTRY_CHAIN_META,
  CHAIN_DEFS as REGISTRY_CHAIN_DEFS,
  getNetwork,
  type NetworkConfig,
} from './networks/networkRegistry'
import type { NetworkUiConfig } from './networks/types'

export type ChainMetaItem = NetworkUiConfig

// ── Master Mapping of Supported Testnets & Chains ──────────────────────────
export const CHAIN_META: Record<string, ChainMetaItem> = REGISTRY_CHAIN_META

// ── Viem Chain Definitions Map ──────────────────────────────────────────────
export const CHAIN_DEFS: Record<string, any> = REGISTRY_CHAIN_DEFS

// ── Robust Chain Icon Resolver ──────────────────────────────────────────────
export function getChainIconId(chainKey?: string): string {
  if (!chainKey) return 'arc'
  const trimmed = chainKey.trim()
  if (CHAIN_META[trimmed]?.iconId) return CHAIN_META[trimmed].iconId

  const lower = trimmed.toLowerCase()
  if (CHAIN_META[lower]?.iconId) return CHAIN_META[lower].iconId

  const clean = lower.replace(/[\s_-]+/g, '')
  for (const [k, v] of Object.entries(CHAIN_META)) {
    if (clean === k.toLowerCase().replace(/[\s_-]+/g, '')) return v.iconId
  }

  if (clean.includes('arc')) return 'arc'
  if (clean.includes('arbitrum')) return 'arbitrum-sepolia'
  if (clean.includes('base')) return 'base-sepolia'
  if (clean.includes('optimism') || clean.includes('op')) return 'optimism-sepolia'
  if (clean.includes('polygon') || clean.includes('amoy')) return 'polygon-amoy'
  if (clean.includes('avalanche') || clean.includes('fuji')) return 'avalanche-fuji'
  if (clean.includes('hyper')) return 'hyper-evm'
  if (clean.includes('sei')) return 'sei-network'
  if (clean.includes('solana')) return 'solana'
  if (clean.includes('sonic')) return 'sonic'
  if (clean.includes('unichain')) return 'unichain'
  if (clean.includes('world')) return 'world'
  if (clean.includes('injective')) return 'injective'
  if (clean.includes('ink')) return 'ink'
  if (clean.includes('linea')) return 'linea-sepolia'
  if (clean.includes('monad')) return 'monad-testnet'
  if (clean.includes('plume')) return 'plume'
  if (clean.includes('xdc') || clean.includes('apothem')) return 'xdc'
  if (clean.includes('sepolia') || clean.includes('ether')) return 'ethereum'

  return 'ethereum'
}

// ── Robust Chain Display Name Resolver ──────────────────────────────────────
export function getChainDisplayName(chainKey?: string): string {
  if (!chainKey) return ''
  const trimmed = chainKey.trim()
  if (CHAIN_META[trimmed]?.name) return CHAIN_META[trimmed].name

  const lower = trimmed.toLowerCase()
  const clean = lower.replace(/[\s_-]+/g, '')
  for (const [k, v] of Object.entries(CHAIN_META)) {
    if (clean === k.toLowerCase().replace(/[\s_-]+/g, '')) return v.name || ''
  }

  return chainKey.replace(/_/g, ' ')
}

export function isSolanaChain(chainKey?: string): boolean {
  if (!chainKey) return false
  return chainKey.toLowerCase().includes('solana')
}

// ── Check if a string is a recognized blockchain network ───────────────────
export function isKnownChain(chainKey?: string): boolean {
  if (!chainKey) return false
  const trimmed = chainKey.trim()
  // Reject Ethereum addresses, hashes, or common token symbols
  if (trimmed.startsWith('0x') || trimmed.length > 35) return false
  if (['usdc', 'eurc', 'cirbtc', 'usdt', 'btc', 'eth', 'sol'].includes(trimmed.toLowerCase())) return false
  
  if (CHAIN_META[trimmed]) return true
  const lower = trimmed.toLowerCase()
  if (CHAIN_META[lower]) return true

  const clean = lower.replace(/[\s_-]+/g, '')
  for (const [k, v] of Object.entries(CHAIN_META)) {
    if (clean === k.toLowerCase().replace(/[\s_-]+/g, '')) return true
    if (v.name && clean === v.name.toLowerCase().replace(/[\s_-]+/g, '')) return true
  }

  const knownKeywords = [
    'arc', 'arbitrum', 'base', 'optimism', 'polygon', 'amoy', 'avalanche',
    'fuji', 'hyper', 'sei', 'solana', 'sonic', 'unichain', 'world',
    'injective', 'ink', 'linea', 'monad', 'plume', 'xdc', 'apothem', 'sepolia'
  ]
  return knownKeywords.some(kw => clean.includes(kw))
}

// ── Canonical Chain Key Resolver (SDK Bridge & Gateway) ────────────────────
export function resolveCanonicalChainKey(chainNameOrKey?: string): string {
  if (!chainNameOrKey) return 'Arc_Testnet'
  const trimmed = chainNameOrKey.trim()
  if (CHAIN_META[trimmed]) return trimmed

  const lower = trimmed.toLowerCase()
  const clean = lower.replace(/[\s_-]+/g, '')

  for (const k of Object.keys(CHAIN_META)) {
    if (clean === k.toLowerCase().replace(/[\s_-]+/g, '')) return k
    if (CHAIN_META[k].name && clean === CHAIN_META[k].name.toLowerCase().replace(/[\s_-]+/g, '')) return k
  }

  if (clean.includes('arc')) return 'Arc_Testnet'
  if (clean.includes('arbitrum') || clean.includes('arb')) return 'Arbitrum_Sepolia'
  if (clean.includes('base')) return 'Base_Sepolia'
  if (clean.includes('optimism') || clean.includes('op')) return 'Optimism_Sepolia'
  if (clean.includes('polygon') || clean.includes('amoy')) return 'Polygon_Amoy_Testnet'
  if (clean.includes('avalanche') || clean.includes('fuji') || clean.includes('avax')) return 'Avalanche_Fuji'
  if (clean.includes('hyper')) return 'HyperEVM_Testnet'
  if (clean.includes('sei')) return 'Sei_Testnet'
  if (clean.includes('solana') || clean.includes('sol')) return 'Solana_Devnet'
  if (clean.includes('sonic')) return 'Sonic_Testnet'
  if (clean.includes('unichain')) return 'Unichain_Sepolia'
  if (clean.includes('world')) return 'World_Chain_Sepolia'
  if (clean.includes('injective')) return 'Injective_Testnet'
  if (clean.includes('ink')) return 'Ink_Testnet'
  if (clean.includes('linea')) return 'Linea_Sepolia'
  if (clean.includes('monad')) return 'Monad_Testnet'
  if (clean.includes('plume')) return 'Plume_Testnet'
  if (clean.includes('xdc') || clean.includes('apothem')) return 'XDC_Apothem'
  if (clean.includes('sepolia') || clean.includes('ether') || clean.includes('eth')) return 'Ethereum_Sepolia'

  return 'Arc_Testnet'
}

export { getNetwork, type NetworkConfig }
