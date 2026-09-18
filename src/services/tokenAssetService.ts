// src/services/tokenAssetService.ts
// EIP-747 Asset Registration Service for Arc Network & EVM Wallets
// Registers Arc Testnet tokens (USDC, EURC, cirBTC) with symbols, decimals, and logos in MetaMask/Web3 wallets
// Prevents MetaMask from displaying tokens as "Bilinmeyen / Unknown"

import { ARC_TESTNET_TOKENS } from '../config/arcChain'

export interface ArcTokenAssetMetadata {
  address: `0x${string}`
  symbol: string
  decimals: number
  image: string
  name: string
}

export const ARC_TOKEN_ASSETS: Record<string, ArcTokenAssetMetadata> = {
  USDC: {
    address: ARC_TESTNET_TOKENS.USDC,
    symbol: 'USDC',
    decimals: 6,
    name: 'USD Coin',
    image: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  },
  EURC: {
    address: ARC_TESTNET_TOKENS.EURC,
    symbol: 'EURC',
    decimals: 6,
    name: 'Euro Coin',
    image: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c/logo.png',
  },
  cirBTC: {
    address: ARC_TESTNET_TOKENS.cirBTC,
    symbol: 'cirBTC',
    decimals: 8,
    name: 'Circle Wrapped Bitcoin',
    image: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png',
  },
}

const STORAGE_KEY_PREFIX = 'arcis_watched_asset_'
const SESSION_DECLINED_PREFIX = 'arcis_declined_asset_'

/**
 * Resolves an active EIP-1193 provider from parameters or window.ethereum.
 */
function resolveProvider(provider?: any): any {
  if (provider?.request) return provider
  if (typeof window !== 'undefined' && (window as any).ethereum?.request) {
    return (window as any).ethereum
  }
  return null
}

/**
 * Checks whether an asset has already been added to the wallet or declined in the current session.
 */
export function isAssetWatched(address: string): boolean {
  if (typeof window === 'undefined') return false
  const addr = address.toLowerCase()
  try {
    // 1. Check if permanently added to wallet
    if (window.localStorage && localStorage.getItem(`${STORAGE_KEY_PREFIX}${addr}`) === 'true') {
      return true
    }
    // 2. Check if declined during the current browser session
    if (window.sessionStorage && sessionStorage.getItem(`${SESSION_DECLINED_PREFIX}${addr}`) === 'true') {
      return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * Marks an asset as permanently added in local storage.
 */
export function markAssetAsWatched(address: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${address.toLowerCase()}`, 'true')
  } catch {
    // Ignore localStorage errors
  }
}

/**
 * Marks an asset as dismissed for the current session to prevent annoying repeated popups.
 */
export function markAssetAsDeclined(address: string): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    sessionStorage.setItem(`${SESSION_DECLINED_PREFIX}${address.toLowerCase()}`, 'true')
  } catch {
    // Ignore sessionStorage errors
  }
}

/**
 * Prompts the user's Web3 wallet (MetaMask, etc.) via EIP-747 wallet_watchAsset
 * to register the token with its official symbol, decimals, and icon.
 */
export async function watchArcToken(
  tokenSymbol: string,
  customProvider?: any,
  forcePrompt: boolean = false
): Promise<boolean> {
  const provider = resolveProvider(customProvider)
  if (!provider) return false

  const asset = ARC_TOKEN_ASSETS[tokenSymbol.toUpperCase()] || ARC_TOKEN_ASSETS[tokenSymbol]
  if (!asset) return false

  // Skip if already marked as watched unless forced
  if (!forcePrompt && isAssetWatched(asset.address)) {
    return true
  }

  try {
    const wasAdded = await provider.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: asset.address,
          symbol: asset.symbol,
          decimals: asset.decimals,
          image: asset.image,
        },
      },
    })

    if (wasAdded) {
      markAssetAsWatched(asset.address)
      return true
    } else {
      // User cancelled in MetaMask
      markAssetAsDeclined(asset.address)
      return false
    }
  } catch (err: any) {
    console.debug(`[tokenAssetService] wallet_watchAsset result for ${tokenSymbol}:`, err?.message || err)
    // If user rejected or cancelled, mark for this session only
    if (err?.code === 4001 || err?.message?.includes('rejected') || err?.message?.includes('User rejected')) {
      markAssetAsDeclined(asset.address)
    }
    return false
  }
}

/**
 * Ensures a specific token address is watched by the wallet.
 */
export async function ensureTokenWatched(
  tokenAddress: string,
  symbol: string,
  decimals: number,
  imageUrl?: string,
  customProvider?: any
): Promise<boolean> {
  const provider = resolveProvider(customProvider)
  if (!provider || !tokenAddress) return false

  if (isAssetWatched(tokenAddress)) return true

  try {
    const wasAdded = await provider.request({
      method: 'wallet_watchAsset',
      params: {
        type: 'ERC20',
        options: {
          address: tokenAddress,
          symbol,
          decimals,
          image: imageUrl || ARC_TOKEN_ASSETS[symbol]?.image || '',
        },
      },
    })
    if (wasAdded) {
      markAssetAsWatched(tokenAddress)
    }
    return !!wasAdded
  } catch (err) {
    console.debug('[tokenAssetService] ensureTokenWatched skipped:', err)
    return false
  }
}
