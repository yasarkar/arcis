// src/services/injectiveWalletService.ts
// Injective & Cosmos Browser Wallet Adapter Service for Keplr, Leap, and Cosmostation

import type { InjectiveWalletProvider } from '../types/multiChainWallet'

const STORAGE_KEYS = {
  ADDRESS: 'arcflow_injective_wallet_address',
  PROVIDER: 'arcflow_injective_wallet_provider',
}

export const INJECTIVE_TESTNET_CHAIN_ID = 'injective-888'
export const INJECTIVE_MAINNET_CHAIN_ID = 'injective-1'

export const INJECTIVE_WALLET_INSTALL_URLS: Record<InjectiveWalletProvider, string> = {
  keplr: 'https://www.keplr.app/download',
  leap: 'https://www.leapwallet.io/download',
  cosmostation: 'https://cosmostation.io/wallet',
  unknown: 'https://injective.com/ecosystem',
}

// Injective Testnet chain configuration for Keplr experimentalSuggestChain
export const INJECTIVE_TESTNET_CHAIN_INFO = {
  chainId: INJECTIVE_TESTNET_CHAIN_ID,
  chainName: 'Injective Testnet',
  rpc: 'https://testnet.sentry.tm.injective.network:443',
  rest: 'https://testnet.sentry.lcd.injective.network:443',
  bip44: {
    coinType: 60,
  },
  bech32Config: {
    bech32PrefixAccAddr: 'inj',
    bech32PrefixAccPub: 'injpub',
    bech32PrefixValAddr: 'injvaloper',
    bech32PrefixValPub: 'injvaloperpub',
    bech32PrefixConsAddr: 'injvalcons',
    bech32PrefixConsPub: 'injvalconspub',
  },
  currencies: [
    {
      coinDenom: 'INJ',
      coinMinimalDenom: 'inj',
      coinDecimals: 18,
      coinGeckoId: 'injective-protocol',
    },
    {
      coinDenom: 'USDC',
      coinMinimalDenom: 'peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5',
      coinDecimals: 6,
    },
  ],
  feeCurrencies: [
    {
      coinDenom: 'INJ',
      coinMinimalDenom: 'inj',
      coinDecimals: 18,
      coinGeckoId: 'injective-protocol',
      gasPriceStep: {
        low: 500000000,
        average: 1000000000,
        high: 1500000000,
      },
    },
  ],
  stakeCurrency: {
    coinDenom: 'INJ',
    coinMinimalDenom: 'inj',
    coinDecimals: 18,
    coinGeckoId: 'injective-protocol',
  },
  features: ['eth-address-gen', 'eth-key-sign'],
}

export function getInjectiveProvider(providerType: InjectiveWalletProvider): any | null {
  if (typeof window === 'undefined') return null

  const win = window as any

  switch (providerType) {
    case 'keplr':
      return win.keplr || null

    case 'leap':
      return win.leap || null

    case 'cosmostation':
      return win.cosmostation?.cosmos || win.cosmostation || null

    case 'unknown':
    default:
      return win.keplr || win.leap || win.cosmostation?.cosmos || null
  }
}

export function isInjectiveWalletInstalled(providerType: InjectiveWalletProvider): boolean {
  return Boolean(getInjectiveProvider(providerType))
}

export function getStoredInjectiveWallet(): { address: string; provider: InjectiveWalletProvider } | null {
  try {
    const address = localStorage.getItem(STORAGE_KEYS.ADDRESS)
    const provider = (localStorage.getItem(STORAGE_KEYS.PROVIDER) as InjectiveWalletProvider) || 'keplr'
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
    localStorage.setItem(STORAGE_KEYS.ADDRESS, address)
    localStorage.setItem(STORAGE_KEYS.PROVIDER, provider)
  } catch {
    // quota error
  }
}

export function clearStoredInjectiveWallet(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.ADDRESS)
    localStorage.removeItem(STORAGE_KEYS.PROVIDER)
  } catch {
    // ignore
  }
}

export async function connectInjectiveWallet(
  providerType: InjectiveWalletProvider = 'keplr'
): Promise<{ success: boolean; address?: string; error?: string }> {
  try {
    const provider = getInjectiveProvider(providerType)
    if (!provider) {
      return {
        success: false,
        error: `${providerType.toUpperCase()} cüzdanı tarayıcınızda bulunamadı. Lütfen eklentiyi yükleyin.`,
      }
    }

    // Attempt to register/suggest Injective Testnet to Keplr/Leap if experimentalSuggestChain exists
    if (typeof provider.experimentalSuggestChain === 'function') {
      try {
        await provider.experimentalSuggestChain(INJECTIVE_TESTNET_CHAIN_INFO)
      } catch (suggestErr) {
        console.warn('[InjectiveWallet] Suggest chain notice (already exists or skipped):', suggestErr)
      }
    }

    // Enable chain connection
    try {
      await provider.enable(INJECTIVE_TESTNET_CHAIN_ID)
    } catch (enableErr) {
      // Fallback: try mainnet chain if testnet fails
      try {
        await provider.enable(INJECTIVE_MAINNET_CHAIN_ID)
      } catch (mainnetErr) {
        throw enableErr
      }
    }

    // Get offline signer accounts
    const offlineSigner = provider.getOfflineSigner
      ? provider.getOfflineSigner(INJECTIVE_TESTNET_CHAIN_ID)
      : provider.getOfflineSignerAuto
      ? await provider.getOfflineSignerAuto(INJECTIVE_TESTNET_CHAIN_ID)
      : null

    if (!offlineSigner) {
      throw new Error('Injective Signer alınamadı.')
    }

    const accounts = await offlineSigner.getAccounts()
    if (!accounts || accounts.length === 0 || !accounts[0].address) {
      throw new Error('Injective hesabı bulunamadı.')
    }

    const address = accounts[0].address
    saveStoredInjectiveWallet(address, providerType)

    return { success: true, address }
  } catch (err: any) {
    console.error('[InjectiveWallet] Connection error:', err)
    let msg = err?.message || 'Injective cüzdanına bağlanılamadı.'
    if (msg.includes('rejected') || msg.includes('declined') || msg.includes('User rejected')) {
      msg = 'Bağlantı isteği kullanıcı tarafından reddedildi.'
    }
    return { success: false, error: msg }
  }
}

export function disconnectInjectiveWallet(): void {
  clearStoredInjectiveWallet()
}
