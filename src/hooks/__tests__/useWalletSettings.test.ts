import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { useWalletSettings } from '../useWalletSettings'

const hookSource = readFileSync(new URL('../useWalletSettings.ts', import.meta.url), 'utf8')

describe('useWalletSettings hook structure & contract', () => {
  it('exports useWalletSettings function', () => {
    expect(typeof useWalletSettings).toBe('function')
  })

  it('binds to walletSettingsService and reacts to wallet address changes', () => {
    expect(hookSource).toContain('walletSettingsService.getWalletSettings(walletAddress)')
    expect(hookSource).toContain('WALLET_SETTINGS_CHANGED_EVENT')
    expect(hookSource).toContain('normalizeWalletAddressKey')
  })

  it('exposes all transaction, swap, bridge, and pool setting properties', () => {
    expect(hookSource).toContain('sendSpeedTier')
    expect(hookSource).toContain('swapSpeedTier')
    expect(hookSource).toContain('swapSlippageType')
    expect(hookSource).toContain('swapCustomSlippage')
    expect(hookSource).toContain('bridgeSpeedTier')
    expect(hookSource).toContain('poolSlippageType')
    expect(hookSource).toContain('poolCustomSlippage')
    expect(hookSource).toContain('poolSlippage')
    expect(hookSource).toContain('updateSettings')
    expect(hookSource).toContain('resetSettings')
  })
})
