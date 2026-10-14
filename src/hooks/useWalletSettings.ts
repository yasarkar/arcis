import { useState, useEffect, useCallback } from 'react'
import {
  walletSettingsService,
  WALLET_SETTINGS_CHANGED_EVENT,
  normalizeWalletAddressKey,
} from '../services/walletSettingsService'
import {
  WalletTransactionSettings,
  DEFAULT_WALLET_TRANSACTION_SETTINGS,
} from '../types/walletSettings'

export function useWalletSettings(walletAddress?: string | null) {
  const [settings, setSettings] = useState<WalletTransactionSettings>(() =>
    walletSettingsService.getWalletSettings(walletAddress)
  )

  // Re-read settings whenever the connected wallet address changes
  useEffect(() => {
    setSettings(walletSettingsService.getWalletSettings(walletAddress))
  }, [walletAddress])

  // Listen for settings change events to stay in sync across components/modals
  useEffect(() => {
    const handleSettingsChange = (event: Event) => {
      const customEvent = event as CustomEvent<{
        walletAddress: string
        settings: WalletTransactionSettings
      }>
      if (!customEvent.detail) return

      const currentKey = normalizeWalletAddressKey(walletAddress)
      const eventKey = normalizeWalletAddressKey(customEvent.detail.walletAddress)

      if (eventKey === currentKey) {
        setSettings(customEvent.detail.settings)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(WALLET_SETTINGS_CHANGED_EVENT, handleSettingsChange)
      return () => {
        window.removeEventListener(WALLET_SETTINGS_CHANGED_EVENT, handleSettingsChange)
      }
    }
  }, [walletAddress])

  const updateSettings = useCallback(
    (partial: Partial<WalletTransactionSettings>) => {
      const updated = walletSettingsService.setWalletSettings(walletAddress, partial)
      setSettings(updated)
      return updated
    },
    [walletAddress]
  )

  const resetSettings = useCallback(() => {
    walletSettingsService.resetWalletSettings(walletAddress)
    setSettings({ ...DEFAULT_WALLET_TRANSACTION_SETTINGS })
  }, [walletAddress])

  return {
    settings,
    updateSettings,
    resetSettings,
    sendSpeedTier: settings.sendSpeedTier,
    swapSpeedTier: settings.swapSpeedTier,
    swapSlippageType: settings.swapSlippageType,
    swapCustomSlippage: settings.swapCustomSlippage,
    bridgeSpeedTier: settings.bridgeSpeedTier,
    poolSlippageType: settings.poolSlippageType,
    poolCustomSlippage: settings.poolCustomSlippage,
    poolSlippage: settings.poolSlippage,
  }
}
