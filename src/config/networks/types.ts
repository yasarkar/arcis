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

export interface NetworkConfig {
  /** Canonical key identifier (e.g. 'Arc_Testnet', 'Base_Sepolia', 'Ethereum_Sepolia') */
  key: string
  /** Human-readable display name */
  name: string
  /** EVM Chain ID (or pseudo chain ID for non-EVM) */
  chainId: number
  /** Whether this network is a testnet */
  testnet: boolean
  /** Circle CCTP domain ID if supported */
  cctpDomain?: number
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
