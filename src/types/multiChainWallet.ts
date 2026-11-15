// src/types/multiChainWallet.ts
// Multi-Chain Wallet Type Definitions for Solana, Injective / Cosmos, and EVM ecosystems

export type SolanaWalletProvider = 'phantom' | 'solflare' | 'backpack' | 'okx' | 'coinbase' | 'trust' | 'unknown'

export interface SolanaWalletBalance {
  sol: string
  usdc: string
  isLoading: boolean
}

export interface SolanaWalletState {
  isConnected: boolean
  address: string
  providerName: SolanaWalletProvider
  isConnecting: boolean
  error: string | null
  balance: SolanaWalletBalance
}

export type InjectiveWalletProvider = 'keplr' | 'leap' | 'cosmostation' | 'unknown'

export interface InjectiveWalletState {
  isConnected: boolean
  address: string
  providerName: InjectiveWalletProvider
  isConnecting: boolean
  error: string | null
}

export interface MultiChainWalletContextValue {
  // Solana State & Actions
  solana: SolanaWalletState
  connectSolana: (provider: SolanaWalletProvider) => Promise<{ success: boolean; address?: string; error?: string }>
  disconnectSolana: () => void
  // P03: async because the wallet service module loads on demand.
  isSolanaInstalled: (provider: SolanaWalletProvider) => Promise<boolean>
  refreshSolanaBalance: () => Promise<void>

  // Injective State & Actions
  injective: InjectiveWalletState
  connectInjective: (provider: InjectiveWalletProvider) => Promise<{ success: boolean; address?: string; error?: string }>
  disconnectInjective: () => void
  // P03: async because the wallet service module loads on demand.
  isInjectiveInstalled: (provider: InjectiveWalletProvider) => Promise<boolean>

  // General controls
  disconnectAllNonEvm: () => void
}
