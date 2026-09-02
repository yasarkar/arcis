import { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName, type ChainMetaItem } from './chainMeta'

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

// Arc Testnet only supports USDC and EURC (cirBTC is NOT supported on Arc Testnet)
const ARC_TESTNET_TOKENS = ['USDC', 'EURC']

// Other testnets that support USDC, EURC, and cirBTC
const FULL_TOKENS = ['USDC', 'EURC', 'cirBTC']

export const SUPPORTED_SEND_CHAINS: ChainConfig[] = [
  {
    chain: 'Arbitrum_Sepolia',
    name: 'Arbitrum Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.arbiscan.io/tx/{hash}'
  },
  {
    chain: 'Arc_Testnet',
    name: 'Arc Testnet',
    tokens: ARC_TESTNET_TOKENS,
    nativeSymbol: 'USDC',
    explorerUrl: 'https://testnet.arcscan.app/tx/{hash}'
  },
  {
    chain: 'Avalanche_Fuji',
    name: 'Avalanche Fuji',
    tokens: FULL_TOKENS,
    nativeSymbol: 'AVAX',
    explorerUrl: 'https://testnet.snowtrace.io/tx/{hash}'
  },
  {
    chain: 'Base_Sepolia',
    name: 'Base Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org/tx/{hash}'
  },
  {
    chain: 'Ethereum_Sepolia',
    name: 'Ethereum Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.etherscan.io/tx/{hash}'
  },
  {
    chain: 'HyperEVM_Testnet',
    name: 'HyperEVM Testnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'HYPER',
    explorerUrl: 'https://testnet.hyperscan.io/tx/{hash}'
  },
  {
    chain: 'Injective_Testnet',
    name: 'Injective Testnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'INJ',
    explorerUrl: 'https://testnet.explorer.injective.network/transaction/{hash}'
  },
  {
    chain: 'Ink_Testnet',
    name: 'Ink Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://explorer.inkonchain.com/tx/{hash}'
  },
  {
    chain: 'Linea_Sepolia',
    name: 'Linea Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.lineascan.build/tx/{hash}'
  },
  {
    chain: 'Monad_Testnet',
    name: 'Monad Testnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'MONAD',
    explorerUrl: 'https://testnet.monadexplorer.com/tx/{hash}'
  },
  {
    chain: 'Optimism_Sepolia',
    name: 'Optimism Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia-optimistic.etherscan.io/tx/{hash}'
  },
  {
    chain: 'Plume_Testnet',
    name: 'Plume Testnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'PLUME',
    explorerUrl: 'https://testnet-explorer.plumenetwork.xyz/tx/{hash}'
  },
  {
    chain: 'Polygon_Amoy_Testnet',
    name: 'Polygon PoS Amoy',
    tokens: FULL_TOKENS,
    nativeSymbol: 'POL',
    explorerUrl: 'https://amoy.polygonscan.com/tx/{hash}'
  },
  {
    chain: 'Sei_Testnet',
    name: 'Sei Testnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'SEI',
    explorerUrl: 'https://seitrace.com/tx/{hash}?cluster=testnet'
  },
  {
    chain: 'Solana_Devnet',
    name: 'Solana Devnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'SOL',
    explorerUrl: 'https://explorer.solana.com/tx/{hash}?cluster=devnet'
  },
  {
    chain: 'Sonic_Testnet',
    name: 'Sonic Testnet',
    tokens: FULL_TOKENS,
    nativeSymbol: 'S',
    explorerUrl: 'https://testnet.sonicscan.org/tx/{hash}'
  },
  {
    chain: 'Unichain_Sepolia',
    name: 'Unichain Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.unichainscan.io/tx/{hash}'
  },
  {
    chain: 'World_Chain_Sepolia',
    name: 'World Chain Sepolia',
    tokens: FULL_TOKENS,
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.worldscan.org/tx/{hash}'
  },
  {
    chain: 'XDC_Apothem',
    name: 'Apothem Network',
    tokens: FULL_TOKENS,
    nativeSymbol: 'XDC',
    explorerUrl: 'https://apothem.xdcscan.io/tx/{hash}'
  }
]

export function getExplorerTxUrl(chainKey?: string, txHash?: string): string {
  if (!txHash) return '#'
  const target = (chainKey || 'Arc_Testnet').toLowerCase()
  const found = SUPPORTED_SEND_CHAINS.find(
    c => c.chain.toLowerCase() === target || c.name.toLowerCase() === target || target.includes(c.chain.toLowerCase())
  )
  if (found?.explorerUrl) {
    return found.explorerUrl.replace('{hash}', txHash)
  }
  return `https://testnet.arcscan.app/tx/${txHash}`
}

export function getExplorerAddressUrl(chainKey?: string, address?: string): string {
  if (!address) return '#'
  const target = (chainKey || 'Arc_Testnet').toLowerCase()
  const found = SUPPORTED_SEND_CHAINS.find(
    c => c.chain.toLowerCase() === target || c.name.toLowerCase() === target || target.includes(c.chain.toLowerCase())
  )
  if (found?.explorerUrl) {
    if (found.explorerUrl.includes('/transaction/')) {
      return found.explorerUrl.replace('/transaction/{hash}', `/account/${address}`)
    }
    return found.explorerUrl.replace('/tx/{hash}', `/address/${address}`)
  }
  return `https://testnet.arcscan.app/address/${address}`
}
