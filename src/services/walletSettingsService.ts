import { SpeedTier } from '../config/feeTiers'
import { POOL_MAX_SLIPPAGE_BPS, POOL_MIN_SLIPPAGE_BPS } from '../config/poolsConfig'
import {
  DEFAULT_WALLET_TRANSACTION_SETTINGS,
  SlippagePreset,
  WalletTransactionSettings,
} from '../types/walletSettings'

export const WALLET_SETTINGS_STORAGE_PREFIX = 'arcis_wallet_settings_v1_'
export const WALLET_SETTINGS_CHANGED_EVENT = 'arcis_wallet_settings_changed'

const VALID_SPEED_TIERS: ReadonlySet<SpeedTier> = new Set(['standard', 'fast', 'turbo'])
const VALID_SLIPPAGE_PRESETS: ReadonlySet<SlippagePreset> = new Set(['0.1', '0.5', '1.0', 'custom'])

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage
  }
  return null
}

function dispatchSettingsChangeEvent(detail: {
  walletAddress: string
  settings: WalletTransactionSettings
}): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(WALLET_SETTINGS_CHANGED_EVENT, { detail }))
    } catch {
      // ignore in environments where CustomEvent fails
    }
  }
}

/**
 * Normalizes a wallet address to lowercase and strips whitespace.
 * If empty or invalid, returns 'default'.
 */
export function normalizeWalletAddressKey(walletAddress?: string | null): string {
  const clean = (walletAddress || '').trim().toLowerCase()
  return clean || 'default'
}

/**
 * Generates the localStorage key scoped to the specific wallet address.
 */
export function getWalletSettingsStorageKey(walletAddress?: string | null): string {
  return `${WALLET_SETTINGS_STORAGE_PREFIX}${normalizeWalletAddressKey(walletAddress)}`
}

/**
 * Validates and sanitizes a raw settings object against schema constraints.
 */
export function sanitizeWalletSettings(raw: any): WalletTransactionSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_WALLET_TRANSACTION_SETTINGS }
  }

  const sendSpeedTier: SpeedTier = VALID_SPEED_TIERS.has(raw.sendSpeedTier)
    ? raw.sendSpeedTier
    : DEFAULT_WALLET_TRANSACTION_SETTINGS.sendSpeedTier

  const swapSpeedTier: SpeedTier = VALID_SPEED_TIERS.has(raw.swapSpeedTier)
    ? raw.swapSpeedTier
    : DEFAULT_WALLET_TRANSACTION_SETTINGS.swapSpeedTier

  const swapSlippageType: SlippagePreset = VALID_SLIPPAGE_PRESETS.has(raw.swapSlippageType)
    ? raw.swapSlippageType
    : DEFAULT_WALLET_TRANSACTION_SETTINGS.swapSlippageType

  const swapCustomSlippage =
    typeof raw.swapCustomSlippage === 'string'
      ? raw.swapCustomSlippage.trim()
      : DEFAULT_WALLET_TRANSACTION_SETTINGS.swapCustomSlippage

  const bridgeSpeedTier: SpeedTier = VALID_SPEED_TIERS.has(raw.bridgeSpeedTier)
    ? raw.bridgeSpeedTier
    : DEFAULT_WALLET_TRANSACTION_SETTINGS.bridgeSpeedTier

  const poolSlippageType: SlippagePreset = VALID_SLIPPAGE_PRESETS.has(raw.poolSlippageType)
    ? raw.poolSlippageType
    : DEFAULT_WALLET_TRANSACTION_SETTINGS.poolSlippageType

  const poolCustomSlippage =
    typeof raw.poolCustomSlippage === 'string'
      ? raw.poolCustomSlippage.trim()
      : DEFAULT_WALLET_TRANSACTION_SETTINGS.poolCustomSlippage

  let poolSlippage: number = DEFAULT_WALLET_TRANSACTION_SETTINGS.poolSlippage
  if (typeof raw.poolSlippage === 'number' && Number.isFinite(raw.poolSlippage) && raw.poolSlippage > 0) {
    const minPct = POOL_MIN_SLIPPAGE_BPS / 100
    const maxPct = POOL_MAX_SLIPPAGE_BPS / 100
    poolSlippage = Math.min(maxPct, Math.max(minPct, raw.poolSlippage))
  }

  return {
    sendSpeedTier,
    swapSpeedTier,
    swapSlippageType,
    swapCustomSlippage,
    bridgeSpeedTier,
    poolSlippageType,
    poolCustomSlippage,
    poolSlippage,
  }
}

export const walletSettingsService = {
  /**
   * Retrieves transaction and execution settings scoped to the specified wallet.
   */
  getWalletSettings(walletAddress?: string | null): WalletTransactionSettings {
    const storage = getStorage()
    if (!storage) {
      return { ...DEFAULT_WALLET_TRANSACTION_SETTINGS }
    }

    const key = getWalletSettingsStorageKey(walletAddress)
    try {
      const stored = storage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored)
        return sanitizeWalletSettings({ ...DEFAULT_WALLET_TRANSACTION_SETTINGS, ...parsed })
      }
    } catch (err) {
      console.error(`[walletSettingsService] Failed to read settings for key ${key}:`, err)
    }
    return { ...DEFAULT_WALLET_TRANSACTION_SETTINGS }
  },

  /**
   * Saves transaction and execution settings scoped to the specified wallet.
   * Dispatches a custom event so active UI components update reactively.
   */
  setWalletSettings(
    walletAddress: string | null | undefined,
    partial: Partial<WalletTransactionSettings>
  ): WalletTransactionSettings {
    const normalizedKey = normalizeWalletAddressKey(walletAddress)
    const storageKey = getWalletSettingsStorageKey(walletAddress)
    const current = this.getWalletSettings(walletAddress)
    const updated = sanitizeWalletSettings({ ...current, ...partial })

    const storage = getStorage()
    if (storage) {
      try {
        storage.setItem(storageKey, JSON.stringify(updated))
        dispatchSettingsChangeEvent({
          walletAddress: normalizedKey,
          settings: updated,
        })
      } catch (err) {
        console.error(`[walletSettingsService] Failed to persist settings for key ${storageKey}:`, err)
      }
    }

    return updated
  },

  /**
   * Resets settings for a specific wallet to defaults.
   */
  resetWalletSettings(walletAddress?: string | null): void {
    const normalizedKey = normalizeWalletAddressKey(walletAddress)
    const storageKey = getWalletSettingsStorageKey(walletAddress)
    const storage = getStorage()

    if (storage) {
      try {
        storage.removeItem(storageKey)
        dispatchSettingsChangeEvent({
          walletAddress: normalizedKey,
          settings: { ...DEFAULT_WALLET_TRANSACTION_SETTINGS },
        })
      } catch (err) {
        console.error(`[walletSettingsService] Failed to reset settings for key ${storageKey}:`, err)
      }
    }
  },
}
