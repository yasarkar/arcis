// src/config/networks/types.ts
// TypeScript interfaces and types for the Centralized Blockchain Network Registry

import type { Chain } from 'viem'

export interface NetworkNativeCurrency {
  name: string
  symbol: string
  decimals: number
}

export interface NetworkRpcConfig {
  primary: string
  fallbacks: string[]
  ws?: string
}

export interface NetworkBlockExplorer {
  name: string
  url: string
}

export interface NetworkUiConfig {
  iconId: string
  name?: string
  color: string
  gradient: string
  isSolana?: boolean
}

export interface NetworkCapabilities {
  /** Peer-to-peer / direct send operations via SendModal */
  send: boolean
  /** Cross-chain bridge via Circle CCTP / App Kit */
  bridge: boolean
  /** AMM / DEX liquidity & swap operations (Arcis StableSwap on Arc Testnet; DEX mainnets) */
  swap: boolean
  /** Circle Gateway unified cross-chain balance & instant settlement */
  gateway: boolean
  /** Direct alias for gateway matching Arc documentation */
  unifiedBalance?: boolean
  /** Circle User-Controlled Wallet challenge signing support */
  ucw: boolean
  /** Circle Onramp widget support (Arc) */
  onramp?: boolean
  /** Circle Earn protocol support (Arc) */
  earn?: boolean
  /** Circle Borrow protocol support (cirBTC collateral) (Arc) */
  borrow?: boolean
  /** Dedicated testnet faucet availability */
  faucet?: boolean
  /** Privacy / stealth transfer support */
  privacy?: boolean
}

export interface NetworkAdapters {
  /** Viem client & account adapter (EVM) */
  viem: boolean
  /** Ethers.js v6 provider & signer adapter (EVM) */
  ethers: boolean
  /** Circle User-Controlled & Developer-Controlled programmable wallets */
  circleWallets: boolean
  /** Solana web3.js adapter */
  solana: boolean
}

export interface NetworkConfig {
  /** Canonical key identifier (e.g. 'Arc_Testnet', 'Base_Sepolia', 'Monad_Testnet') */
  key: string
  /** Human-readable display name */
  name: string
  /** Short abbreviation / ticker for badges and compact UI (e.g. 'ARC', 'MON', 'BASE') */
  shortName: string
  /** EVM Chain ID (or pseudo chain ID for non-EVM) */
  chainId: number
  /** Whether this network is a testnet */
  testnet: boolean
  /** Circle CCTP domain ID if supported */
  cctpDomain?: number
  /** Circle API token blockchain identifier (e.g. 'ARC-TESTNET', 'ETH-SEPOLIA') */
  circleBlockchain?: string
  /** Supported capabilities and feature flags for this network */
  capabilities: NetworkCapabilities
  /** Supported wallet adapters matching Arc documentation matrix */
  adapters: NetworkAdapters
  /** Native gas currency configuration including decimals */
  nativeCurrency: NetworkNativeCurrency
  /** High-availability RPC endpoints */
  rpcUrls: NetworkRpcConfig
  /** Block explorer information */
  blockExplorers: NetworkBlockExplorer
  /** Known token contract addresses on this network (USDC, EURC, etc.) */
  tokens: {
    USDC?: `0x${string}` | string
    EURC?: `0x${string}` | string
    cirBTC?: `0x${string}` | string
    [tokenSymbol: string]: `0x${string}` | string | undefined
  }
  /** Token decimal overrides (default for USDC/EURC is 6) */
  tokenDecimals?: Record<string, number>
  /** Circle Gateway contract addresses if deployed on this network */
  gatewayContracts?: {
    gatewayWallet?: `0x${string}`
    gatewayMinter?: `0x${string}`
  }
  /** Visual identity for UI rendering (Web3 icon, colors, gradients) */
  ui: NetworkUiConfig
  /** Pure Viem Chain definition object for client initialization */
  viemChain: Chain
}
