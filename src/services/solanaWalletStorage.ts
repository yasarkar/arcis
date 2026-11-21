// src/services/solanaWalletStorage.ts
// Lightweight storage helpers and install URLs for Solana wallets.
// Kept separate from solanaWalletService so initial synchronous state reads
// do not eagerly pull in the full wallet adapter or @solana/web3.js.

import type { SolanaWalletProvider } from '../types/multiChainWallet'

export const SOLANA_STORAGE_KEYS = {
  ADDRESS: 'arcis_solana_wallet_address',
  PROVIDER: 'arcis_solana_wallet_provider',
}

export const SOLANA_WALLET_INSTALL_URLS: Record<SolanaWalletProvider, string> = {
  phantom: 'https://phantom.app/download',
  solflare: 'https://solflare.com/download',
  backpack: 'https://backpack.app/download',
  okx: 'https://www.okx.com/web3',
  coinbase: 'https://www.coinbase.com/wallet',
  trust: 'https://trustwallet.com/download',
  unknown: 'https://solana.com/ecosystem/explore?categories=wallet',
}

export function getStoredSolanaWallet(): { address: string; provider: SolanaWalletProvider } | null {
  try {
    const address = localStorage.getItem(SOLANA_STORAGE_KEYS.ADDRESS)
    const provider = (localStorage.getItem(SOLANA_STORAGE_KEYS.PROVIDER) as SolanaWalletProvider) || 'phantom'
    if (address) {
      return { address, provider }
    }
    return null
  } catch {
    return null
  }
}

export function saveStoredSolanaWallet(address: string, provider: SolanaWalletProvider): void {
  try {
    localStorage.setItem(SOLANA_STORAGE_KEYS.ADDRESS, address)
    localStorage.setItem(SOLANA_STORAGE_KEYS.PROVIDER, provider)
  } catch {
    // quota error
  }
}

export function clearStoredSolanaWallet(): void {
  try {
    localStorage.removeItem(SOLANA_STORAGE_KEYS.ADDRESS)
    localStorage.removeItem(SOLANA_STORAGE_KEYS.PROVIDER)
  } catch {
    // ignore
  }
}
