import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  approximateSwapVolumeUsd,
  poolIdForSwapPair,
  recordClientSwapVolumeForPair,
  loadStoredSwapVolume,
  clearSwapVolumeCache,
} from '../poolVolumeUtils'
import { DEFAULT_TOKEN_PRICES } from '../../services/tokenPriceService'

describe('approximateSwapVolumeUsd (single FX source — audit: hardcoded FX)', () => {
  it('prices USDC at par and derives every other asset from DEFAULT_TOKEN_PRICES', () => {
    expect(approximateSwapVolumeUsd('USDC', '10')).toBe(10)
    expect(approximateSwapVolumeUsd('EURC', '10')).toBeCloseTo(10 * DEFAULT_TOKEN_PRICES.EURC, 10)
    expect(approximateSwapVolumeUsd('cirBTC', '0.001')).toBeCloseTo(
      0.001 * DEFAULT_TOKEN_PRICES.CIRBTC,
      10
    )
    // 'BTC' alias maps to the cirBTC price instead of a duplicated literal.
    expect(approximateSwapVolumeUsd('BTC', '1')).toBe(DEFAULT_TOKEN_PRICES.CIRBTC)
  })

  it('returns 0 for unknown assets and unusable amounts', () => {
    expect(approximateSwapVolumeUsd('USDT', '5')).toBe(0)
    expect(approximateSwapVolumeUsd('USDC', '0')).toBe(0)
    expect(approximateSwapVolumeUsd('USDC', '-3')).toBe(0)
    expect(approximateSwapVolumeUsd('USDC', 'not-a-number')).toBe(0)
    expect(approximateSwapVolumeUsd('', '10')).toBe(0)
  })
})

describe('poolIdForSwapPair', () => {
  it('routes cirBTC pairs to the constant-product pool and everything else to stable', () => {
    expect(poolIdForSwapPair('USDC', 'cirBTC')).toBe('usdc-cirbtc-pool')
    expect(poolIdForSwapPair('cirBTC', 'USDC')).toBe('usdc-cirbtc-pool')
    expect(poolIdForSwapPair('BTC', 'USDC')).toBe('usdc-cirbtc-pool')
    expect(poolIdForSwapPair('USDC', 'EURC')).toBe('usdc-eurc-stable-pool')
    expect(poolIdForSwapPair('EURC', 'USDC')).toBe('usdc-eurc-stable-pool')
  })
})

describe('recordClientSwapVolumeForPair', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const localStorageMock = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    }
    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('window', {
      // poolVolumeUtils reads window.localStorage (not the bare global) for persistence.
      localStorage: localStorageMock,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    clearSwapVolumeCache()
  })

  afterEach(() => {
    clearSwapVolumeCache()
    vi.unstubAllGlobals()
  })

  it('records volume against the pair pool and skips unusable inputs', () => {
    recordClientSwapVolumeForPair('USDC', 'EURC', '25', '0xabc')
    const entry = loadStoredSwapVolume().find(
      (e) => e.poolId === 'usdc-eurc-stable-pool' && e.txHash === '0xabc'
    )
    expect(entry).toBeTruthy()
    expect(entry!.volumeUsd).toBeCloseTo(25, 10)

    const before = loadStoredSwapVolume().length
    recordClientSwapVolumeForPair('USDT', 'USDC', '100', '0xdef')
    expect(loadStoredSwapVolume().length).toBe(before)
  })

  it('uses the shared FX table for non-USDC inputs (EURC volume is amount × 1.08)', () => {
    recordClientSwapVolumeForPair('EURC', 'USDC', '10', '0x123')
    const entry = loadStoredSwapVolume().find((e) => e.txHash === '0x123')
    expect(entry).toBeTruthy()
    expect(entry!.volumeUsd).toBeCloseTo(10 * DEFAULT_TOKEN_PRICES.EURC, 10)
  })
})
