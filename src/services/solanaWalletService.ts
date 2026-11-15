// Solana Browser Wallet Adapter Service for Phantom, Solflare, Backpack, and OKX
import type { SolanaWalletProvider } from '../types/multiChainWallet'
export type { SolanaWalletProvider }

const STORAGE_KEYS = {
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
      if (win.backpack?.solana) return win.backpack.solana
      if (win.backpack?.isBackpack) return win.backpack
      if (win.solana?.isBackpack) return win.solana
      return win.backpack || null

    case 'okx':
      if (win.okxwallet?.solana) return win.okxwallet.solana
      return null

    case 'coinbase':
      if (win.coinbaseSolana) return win.coinbaseSolana
      if (win.coinbaseWalletExtension?.solana) return win.coinbaseWalletExtension.solana
      return null

    case 'trust':
      if (win.trustwallet?.solana) return win.trustwallet.solana
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
    let msg = err?.message
    if (err?.code === 4001 || msg.includes('User canceled')) {
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

// ── Solana Web3.js RPC & Balance Integration ──────────────────────────────
export const SOLANA_DEVNET_RPC = 'https://api.devnet.solana.com'
export const SOLANA_DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

export interface SolanaBalances {
  sol: string
  usdc: string
}

let cachedConnection: any = null

export async function getSolanaConnection(rpcUrl = SOLANA_DEVNET_RPC) {
  if (!cachedConnection) {
    const { Connection } = await import('@solana/web3.js')
    cachedConnection = new Connection(rpcUrl, 'confirmed')
  }
  return cachedConnection
}

/**
 * Fetches native SOL and Devnet USDC balances for a Solana address.
 * Uses dynamic import of @solana/web3.js to keep critical path lightweight.
 */
export async function fetchSolanaBalances(
  address: string,
  rpcUrl = SOLANA_DEVNET_RPC
): Promise<SolanaBalances> {
  if (!address) return { sol: '0.0000', usdc: '0.00' }
  try {
    const { PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js')
    const connection = await getSolanaConnection(rpcUrl)
    const pubKey = new PublicKey(address)

    // 1. Native SOL balance
    const lamports = await connection.getBalance(pubKey)
    const sol = (lamports / LAMPORTS_PER_SOL).toFixed(4)

    // 2. SPL Token USDC balance
    let usdc = '0.00'
    try {
      const usdcMint = new PublicKey(SOLANA_DEVNET_USDC_MINT)
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubKey, {
        mint: usdcMint,
      })
      if (tokenAccounts?.value?.length > 0) {
        const total = tokenAccounts.value.reduce((acc: number, item: any) => {
          const val = item.account?.data?.parsed?.info?.tokenAmount?.uiAmount
          return acc + (Number(val) || 0)
        }, 0)
        usdc = total.toFixed(2)
      }
    } catch (tokenErr) {
      console.warn('[SolanaWallet] SPL USDC balance read notice:', tokenErr)
    }

    return { sol, usdc }
  } catch (err) {
    console.warn('[SolanaWallet] Failed to fetch Solana balances:', err)
    return { sol: '0.0000', usdc: '0.00' }
  }
}

/**
 * Prepares and signs/sends a Solana transaction with Phantom / Backpack.
 */
export async function signAndSendSolanaTransaction(
  providerType: SolanaWalletProvider,
  instructions: any[],
  rpcUrl = SOLANA_DEVNET_RPC
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    const provider = getSolanaProvider(providerType)
    if (!provider) throw new Error('Solana provider not found')

    const { Transaction } = await import('@solana/web3.js')
    const connection = await getSolanaConnection(rpcUrl)

    const transaction = new Transaction().add(...instructions)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = provider.publicKey

    if (typeof provider.signAndSendTransaction === 'function') {
      const res = await provider.signAndSendTransaction(transaction)
      const signature = res?.signature || res
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      })
      return { success: true, signature }
    } else if (typeof provider.signTransaction === 'function') {
      const signed = await provider.signTransaction(transaction)
      const rawTx = signed.serialize()
      const signature = await connection.sendRawTransaction(rawTx)
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      })
      return { success: true, signature }
    } else {
      throw new Error('Cüzdan işlem imzalamayı desteklemiyor.')
    }
  } catch (err: any) {
    console.error('[SolanaWallet] Transaction send error:', err)
    return { success: false, error: err?.message || 'Transaction failed.' }
  }
}
