// src/services/injectiveWalletStorage.ts
// Lightweight storage helpers and install URLs for Injective wallets.
// Kept separate from injectiveWalletService so initial synchronous state reads
// do not eagerly pull in the full wallet adapter or Cosmos SDK dependencies.

import type { InjectiveWalletProvider } from '../types/multiChainWallet'

export const INJECTIVE_STORAGE_KEYS = {
  ADDRESS: 'arcis_injective_wallet_address',
  PROVIDER: 'arcis_injective_wallet_provider',
  LEGACY_ADDRESS: 'arcis_injective_wallet_address',
  LEGACY_PROVIDER: 'arcis_injective_wallet_provider',
}

export const INJECTIVE_WALLET_INSTALL_URLS: Record<InjectiveWalletProvider, string> = {
  keplr: 'https://www.keplr.app/download',
  leap: 'https://www.leapwallet.io/download',
  cosmostation: 'https://cosmostation.io/wallet',
  unknown: 'https://injective.com/ecosystem',
}

export function getStoredInjectiveWallet(): { address: string; provider: InjectiveWalletProvider } | null {
  try {
    const address = localStorage.getItem(INJECTIVE_STORAGE_KEYS.ADDRESS) || localStorage.getItem(INJECTIVE_STORAGE_KEYS.LEGACY_ADDRESS)
    const provider =
      (localStorage.getItem(INJECTIVE_STORAGE_KEYS.PROVIDER) as InjectiveWalletProvider) ||
      (localStorage.getItem(INJECTIVE_STORAGE_KEYS.LEGACY_PROVIDER) as InjectiveWalletProvider) ||
      'keplr'
    if (address) {
      return { address, provider }
    }
    return null
  } catch {
    return null
  }
}

export function saveStoredInjectiveWallet(address: string, provider: InjectiveWalletProvider): void {
  try {
    localStorage.setItem(INJECTIVE_STORAGE_KEYS.ADDRESS, address)
    localStorage.setItem(INJECTIVE_STORAGE_KEYS.PROVIDER, provider)
  } catch {
    // quota error
  }
}

export function clearStoredInjectiveWallet(): void {
  try {
    localStorage.removeItem(INJECTIVE_STORAGE_KEYS.ADDRESS)
    localStorage.removeItem(INJECTIVE_STORAGE_KEYS.PROVIDER)
    localStorage.removeItem(INJECTIVE_STORAGE_KEYS.LEGACY_ADDRESS)
    localStorage.removeItem(INJECTIVE_STORAGE_KEYS.LEGACY_PROVIDER)
  } catch {
    // ignore
  }
}
