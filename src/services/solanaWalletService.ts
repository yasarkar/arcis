// src/services/solanaWalletService.ts
// Solana Browser Wallet Adapter Service for Phantom, Solflare, Backpack, and OKX

import type { SolanaWalletProvider } from '../types/multiChainWallet'

const STORAGE_KEYS = {
  ADDRESS: 'arcflow_solana_wallet_address',
  PROVIDER: 'arcflow_solana_wallet_provider',
}

export const SOLANA_WALLET_INSTALL_URLS: Record<SolanaWalletProvider, string> = {
  phantom: 'https://phantom.app/download',
  solflare: 'https://solflare.com/download',
  backpack: 'https://backpack.app/download',
  okx: 'https://www.okx.com/web3',
  unknown: 'https://solana.com/ecosystem/explore?categories=wallet',
}

export function getSolanaProvider(providerType: SolanaWalletProvider): any | null {
  if (typeof window === 'undefined') return null

  const win = window as any

  switch (providerType) {
    case 'phantom':
      if (win.phantom?.solana?.isPhantom) return win.phantom.solana
      if (win.solana?.isPhantom) return win.solana
      return null

    case 'solflare':
      if (win.solflare?.isSolflare) return win.solflare
      return null

    case 'backpack':
      if (win.backpack?.isBackpack) return win.backpack
      return null

    case 'okx':
      if (win.okxwallet?.solana) return win.okxwallet.solana
      return null

    case 'unknown':
    default:
      if (win.phantom?.solana) return win.phantom.solana
      if (win.solflare) return win.solflare
      if (win.backpack) return win.backpack
      if (win.solana) return win.solana
      return null
  }
}

export function isSolanaWalletInstalled(providerType: SolanaWalletProvider): boolean {
  return Boolean(getSolanaProvider(providerType))
}

export function getStoredSolanaWallet(): { address: string; provider: SolanaWalletProvider } | null {
  try {
    const address = localStorage.getItem(STORAGE_KEYS.ADDRESS)
    const provider = (localStorage.getItem(STORAGE_KEYS.PROVIDER) as SolanaWalletProvider) || 'phantom'
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
    localStorage.setItem(STORAGE_KEYS.ADDRESS, address)
    localStorage.setItem(STORAGE_KEYS.PROVIDER, provider)
  } catch {
    // quota error
  }
}

export function clearStoredSolanaWallet(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.ADDRESS)
    localStorage.removeItem(STORAGE_KEYS.PROVIDER)
  } catch {
    // ignore
  }
}

export async function connectSolanaWallet(
  providerType: SolanaWalletProvider = 'phantom',
  onlyIfTrusted = false
): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    const provider = getSolanaProvider(providerType)
    if (!provider) {
      return {
        success: false,
        error: `${providerType.toUpperCase()} cüzdanı tarayıcınızda bulunamadı. Lütfen eklentiyi yükleyin.`,
      }
    }

    const response = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined)
    const pubKey = response?.publicKey || provider.publicKey

    if (!pubKey) {
      throw new Error('Solana cüzdan adresi alınamadı.')
    }

    const address = pubKey.toString ? pubKey.toString() : String(pubKey)
    saveStoredSolanaWallet(address, providerType)

    return { success: true, address }
  } catch (err: any) {
    if (onlyIfTrusted) {
      // Silent fail during auto-reconnect
      return { success: false, error: 'Auto-reconnect trusted session not found.' }
    }
    console.error('[SolanaWallet] Connection error:', err)
    let msg = err?.message || 'Solana cüzdanına bağlanılamadı.'
    if (err?.code === 4001 || msg.includes('User rejected')) {
      msg = 'Bağlantı isteği kullanıcı tarafından reddedildi.'
    }
    return { success: false, error: msg }
  }
}

export async function disconnectSolanaWallet(providerType: SolanaWalletProvider = 'phantom'): Promise<void> {
  try {
    const provider = getSolanaProvider(providerType)
    if (provider && typeof provider.disconnect === 'function') {
      await provider.disconnect()
    }
  } catch (err) {
    console.warn('[SolanaWallet] Disconnect notice:', err)
  } finally {
    clearStoredSolanaWallet()
  }
}
