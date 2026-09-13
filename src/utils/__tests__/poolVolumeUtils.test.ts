import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  POOL_TESTNET_BASE_VOLUME,
  recordClientSwapVolume,
  getRollingClientSwapVolume,
  startLiveVolumeSimulation,
  clearSwapVolumeCache,
} from '../poolVolumeUtils'

describe('poolVolumeUtils', () => {
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
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    clearSwapVolumeCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearSwapVolumeCache()
    vi.unstubAllGlobals()
  })

  describe('POOL_TESTNET_BASE_VOLUME', () => {
    it('has zero baseline volume for honest, non-synthetic reporting', () => {
      expect(POOL_TESTNET_BASE_VOLUME['usdc-eurc-stable-pool']).toBe(0)
      expect(POOL_TESTNET_BASE_VOLUME['usdc-cirbtc-pool']).toBe(0)
      expect(POOL_TESTNET_BASE_VOLUME['usdc-yield-vault']).toBe(0)
    })
  })

  describe('getRollingClientSwapVolume', () => {
    it('returns 0 when no trades are recorded', () => {
      const vol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(vol).toBe(0)
    })

    it('adds newly recorded trade volume to the base volume', () => {
      recordClientSwapVolume('usdc-eurc-stable-pool', 5.5, '0xabc123')
      const vol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(vol).toBeCloseTo(5.5, 2)
    })

    it('ignores trades older than 24 hours', () => {
      const now = Date.now()
      const dayAndHalfAgo = now - 36 * 60 * 60 * 1000

      // Seed old trade in localStorage
      localStorage.setItem(
        'arcis_swap_volume_history',
        JSON.stringify([
          {
            poolId: 'usdc-eurc-stable-pool',
            volumeUsd: 100,
            timestamp: dayAndHalfAgo,
            txHash: '0xold',
          },
        ])
      )

      const vol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(vol).toBe(0)
    })

    it('caps stored entries to max 100', () => {
      for (let i = 0; i < 110; i++) {
        recordClientSwapVolume('usdc-eurc-stable-pool', 0.1, `0x${i}`)
      }
      const raw = localStorage.getItem('arcis_swap_volume_history')
      const parsed = JSON.parse(raw || '[]')
      expect(parsed.length).toBeLessThanOrEqual(100)
    })
  })

  describe('startLiveVolumeSimulation', () => {
    it('returns a cleanup function without generating synthetic trades', () => {
      vi.useFakeTimers()
      const stopSim = startLiveVolumeSimulation()
      expect(typeof stopSim).toBe('function')

      const initialVol = getRollingClientSwapVolume('usdc-eurc-stable-pool')

      // Advance by 30 seconds
      vi.advanceTimersByTime(30000)

      const updatedVol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      // No synthetic volume added
      expect(updatedVol).toBe(initialVol)

      stopSim()
      vi.useRealTimers()
    })
  })
})
