// src/types/multiChainWallet.ts
// Multi-Chain Wallet Type Definitions for Solana, Injective / Cosmos, and EVM ecosystems

export type SolanaWalletProvider = 'phantom' | 'solflare' | 'backpack' | 'okx' | 'unknown'

export interface SolanaWalletState {
  isConnected: boolean
  address: string
  providerName: SolanaWalletProvider
  isConnecting: boolean
  error: string | null
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
  isSolanaInstalled: (provider: SolanaWalletProvider) => boolean

  // Injective State & Actions
  injective: InjectiveWalletState
  connectInjective: (provider: InjectiveWalletProvider) => Promise<{ success: boolean; address?: string; error?: string }>
  disconnectInjective: () => void
  isInjectiveInstalled: (provider: InjectiveWalletProvider) => boolean

  // General controls
  disconnectAllNonEvm: () => void
}
