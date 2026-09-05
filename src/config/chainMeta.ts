// src/config/chainMeta.ts
// Centralized Chain Metadata, Web3 Icons, and Viem Chain Definitions

import { arcTestnet } from './arcChain'
import {
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  polygonAmoy,
  avalancheFuji,
} from 'wagmi/chains'
import {
  hyperEVMTestnet,
  seiTestnet,
  sonicTestnet,
  unichainSepolia,
  worldChainSepolia,
} from './wagmi'

export interface ChainMetaItem {
  iconId: string
  name: string
  color: string
  gradient: string
  isSolana?: boolean
}

// ── Master Mapping of Supported Testnets & Chains ──────────────────────────
export const CHAIN_META: Record<string, ChainMetaItem> = {
  Arc_Testnet: {
    iconId: 'arc',
    name: 'Arc Testnet',
    color: '#4f7de8',
    gradient: 'linear-gradient(135deg, #9896ff 0%, #6366f1 50%, #3b82f6 100%)',
  },
  Ethereum_Sepolia: {
    iconId: 'ethereum',
    name: 'Ethereum Sepolia',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  },
  Base_Sepolia: {
    iconId: 'base-sepolia',
    name: 'Base Sepolia',
    color: '#3b82f6',
    gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
  },
  Arbitrum_Sepolia: {
    iconId: 'arbitrum-sepolia',
    name: 'Arbitrum Sepolia',
    color: '#22d3ee',
    gradient: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
  },
  Optimism_Sepolia: {
    iconId: 'optimism-sepolia',
    name: 'Optimism Sepolia',
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
  },
  Polygon_Amoy_Testnet: {
    iconId: 'polygon-amoy',
    name: 'Polygon PoS Amoy',
    color: '#a855f7',
    gradient: 'linear-gradient(135deg, #a855f7, #9333ea)',
  },
  Avalanche_Fuji: {
    iconId: 'avalanche-fuji',
    name: 'Avalanche Fuji',
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
  },
  HyperEVM_Testnet: {
    iconId: 'hyper-evm',
    name: 'HyperEVM Testnet',
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
  },
  Sei_Testnet: {
    iconId: 'sei-network',
    name: 'Sei Testnet',
    color: '#eab308',
    gradient: 'linear-gradient(135deg, #eab308, #ca8a04)',
  },
  Solana_Devnet: {
    iconId: 'solana',
    name: 'Solana Devnet',
    color: '#14b8a6',
    gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)',
    isSolana: true,
  },
  Sonic_Testnet: {
    iconId: 'sonic',
    name: 'Sonic Testnet',
    color: '#84cc16',
    gradient: 'linear-gradient(135deg, #84cc16, #65a30d)',
  },
  Unichain_Sepolia: {
    iconId: 'unichain',
    name: 'Unichain Sepolia',
    color: '#f472b6',
    gradient: 'linear-gradient(135deg, #f472b6, #db2777)',
  },
  World_Chain_Sepolia: {
    iconId: 'world',
    name: 'World Chain Sepolia',
    color: '#0ea5e9',
    gradient: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
  },
  Injective_Testnet: {
    iconId: 'injective',
    name: 'Injective Testnet',
    color: '#06b6d4',
    gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
  },
  Ink_Testnet: {
    iconId: 'ink',
    name: 'Ink Sepolia',
    color: '#a855f7',
    gradient: 'linear-gradient(135deg, #a855f7, #7e22ce)',
  },
  Linea_Sepolia: {
    iconId: 'linea-sepolia',
    name: 'Linea Sepolia',
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1, #4338ca)',
  },
  Monad_Testnet: {
    iconId: 'monad-testnet',
    name: 'Monad Testnet',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  },
  Plume_Testnet: {
    iconId: 'plume',
    name: 'Plume Testnet',
    color: '#ec4899',
    gradient: 'linear-gradient(135deg, #ec4899, #be185d)',
  },
  XDC_Apothem: {
    iconId: 'xdc',
    name: 'Apothem Network',
    color: '#0284c7',
    gradient: 'linear-gradient(135deg, #0284c7, #0369a1)',
  },
}

// ── Viem Chain Definitions Map ──────────────────────────────────────────────
export const CHAIN_DEFS: Record<string, any> = {
  Arc_Testnet: arcTestnet,
  Ethereum_Sepolia: sepolia,
  Base_Sepolia: baseSepolia,
  Arbitrum_Sepolia: arbitrumSepolia,
  Optimism_Sepolia: optimismSepolia,
  Polygon_Amoy_Testnet: polygonAmoy,
  Avalanche_Fuji: avalancheFuji,
  HyperEVM_Testnet: hyperEVMTestnet,
  Sei_Testnet: seiTestnet,
  Sonic_Testnet: sonicTestnet,
  Unichain_Sepolia: unichainSepolia,
  World_Chain_Sepolia: worldChainSepolia,
}

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
    if (clean === k.toLowerCase().replace(/[\s_-]+/g, '')) return v.name
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
