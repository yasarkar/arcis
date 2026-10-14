import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  walletSettingsService,
  normalizeWalletAddressKey,
  getWalletSettingsStorageKey,
  WALLET_SETTINGS_STORAGE_PREFIX,
  WALLET_SETTINGS_CHANGED_EVENT,
} from '../walletSettingsService'
import { DEFAULT_WALLET_TRANSACTION_SETTINGS } from '../../types/walletSettings'

describe('walletSettingsService', () => {
  let mockStorage: Record<string, string> = {}
  let eventDispatched: any = null

  beforeEach(() => {
    mockStorage = {}
    eventDispatched = null

    const localStorageMock = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key]
      }),
      clear: vi.fn(() => {
        mockStorage = {}
      }),
    }

    const windowMock = {
      localStorage: localStorageMock,
      dispatchEvent: vi.fn((event: any) => {
        eventDispatched = event
        return true
      }),
    }

    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('window', windowMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes wallet addresses consistently (case-insensitive & trimmed)', () => {
    expect(normalizeWalletAddressKey(' 0xAbC123 ')).toBe('0xabc123')
    expect(normalizeWalletAddressKey('')).toBe('default')
    expect(normalizeWalletAddressKey(null)).toBe('default')
    expect(normalizeWalletAddressKey(undefined)).toBe('default')
  })

  it('generates wallet-scoped storage keys', () => {
    expect(getWalletSettingsStorageKey('0x1234567890abcdef1234567890abcdef12345678')).toBe(
      `${WALLET_SETTINGS_STORAGE_PREFIX}0x1234567890abcdef1234567890abcdef12345678`
    )
    expect(getWalletSettingsStorageKey(null)).toBe(`${WALLET_SETTINGS_STORAGE_PREFIX}default`)
  })

  it('returns default settings when a wallet has no saved preferences', () => {
    const settings = walletSettingsService.getWalletSettings('0x1111111111111111111111111111111111111111')
    expect(settings).toEqual(DEFAULT_WALLET_TRANSACTION_SETTINGS)
  })

  it('maintains strict isolation between different wallets', () => {
    const walletA = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const walletB = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

    // Configure Wallet A
    walletSettingsService.setWalletSettings(walletA, {
      sendSpeedTier: 'turbo',
      swapSlippageType: '0.1',
      swapSpeedTier: 'standard',
      bridgeSpeedTier: 'turbo',
      poolSlippage: 1.5,
    })

    // Configure Wallet B differently
    walletSettingsService.setWalletSettings(walletB, {
      sendSpeedTier: 'standard',
      swapSlippageType: '1.0',
      swapSpeedTier: 'turbo',
      bridgeSpeedTier: 'standard',
      poolSlippage: 0.2,
    })

    const settingsA = walletSettingsService.getWalletSettings(walletA)
    const settingsB = walletSettingsService.getWalletSettings(walletB)

    // Wallet A checks
    expect(settingsA.sendSpeedTier).toBe('turbo')
    expect(settingsA.swapSlippageType).toBe('0.1')
    expect(settingsA.swapSpeedTier).toBe('standard')
    expect(settingsA.bridgeSpeedTier).toBe('turbo')
    expect(settingsA.poolSlippage).toBe(1.5)

    // Wallet B checks
    expect(settingsB.sendSpeedTier).toBe('standard')
    expect(settingsB.swapSlippageType).toBe('1.0')
    expect(settingsB.swapSpeedTier).toBe('turbo')
    expect(settingsB.bridgeSpeedTier).toBe('standard')
    expect(settingsB.poolSlippage).toBe(0.2)
  })

  it('gracefully handles corrupted JSON in localStorage', () => {
    const wallet = '0x123'
    const key = getWalletSettingsStorageKey(wallet)
    mockStorage[key] = 'invalid-json{{{'

    const settings = walletSettingsService.getWalletSettings(wallet)
    expect(settings).toEqual(DEFAULT_WALLET_TRANSACTION_SETTINGS)
  })

  it('sanitizes invalid speed tiers and clamps slippage to protocol bounds', () => {
    const wallet = '0x456'
    walletSettingsService.setWalletSettings(wallet, {
      // @ts-expect-error invalid tier
      sendSpeedTier: 'ultra_mega_fast',
      // @ts-expect-error invalid preset
      swapSlippageType: '999%',
      poolSlippage: 50.0, // Exceeds POOL_MAX_SLIPPAGE_BPS (2%)
    })

    const settings = walletSettingsService.getWalletSettings(wallet)
    expect(settings.sendSpeedTier).toBe('fast') // Fallback to default
    expect(settings.swapSlippageType).toBe('0.5') // Fallback to default
    expect(settings.poolSlippage).toBe(2.0) // Clamped to 2.0%
  })

  it('dispatches a window event when settings are updated or reset', () => {
    const wallet = '0x789'

    walletSettingsService.setWalletSettings(wallet, { sendSpeedTier: 'turbo' })
    expect(eventDispatched?.type).toBe(WALLET_SETTINGS_CHANGED_EVENT)
    expect(eventDispatched?.detail?.walletAddress).toBe('0x789')
    expect(eventDispatched?.detail?.settings?.sendSpeedTier).toBe('turbo')

    walletSettingsService.resetWalletSettings(wallet)
    expect(eventDispatched?.type).toBe(WALLET_SETTINGS_CHANGED_EVENT)
    expect(eventDispatched?.detail?.settings?.sendSpeedTier).toBe('fast')
  })
})
