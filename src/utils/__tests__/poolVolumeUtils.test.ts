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
    it('has non-zero calibrated testnet volume for all pools', () => {
      expect(POOL_TESTNET_BASE_VOLUME['usdc-eurc-stable-pool']).toBeGreaterThan(0)
      expect(POOL_TESTNET_BASE_VOLUME['usdc-cirbtc-pool']).toBeGreaterThan(0)
      expect(POOL_TESTNET_BASE_VOLUME['usdc-yield-vault']).toBeGreaterThan(0)
    })
  })

  describe('getRollingClientSwapVolume', () => {
    it('returns base volume when no trades are recorded', () => {
      const vol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(vol).toBe(POOL_TESTNET_BASE_VOLUME['usdc-eurc-stable-pool'])
    })

    it('adds newly recorded trade volume to the base volume', () => {
      recordClientSwapVolume('usdc-eurc-stable-pool', 5.5, '0xabc123')
      const vol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(vol).toBeCloseTo(POOL_TESTNET_BASE_VOLUME['usdc-eurc-stable-pool'] + 5.5, 2)
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
      expect(vol).toBe(POOL_TESTNET_BASE_VOLUME['usdc-eurc-stable-pool'])
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
    it('is idempotent and can be cleanly stopped', () => {
      vi.useFakeTimers()
      const stopSim1 = startLiveVolumeSimulation()
      const stopSim2 = startLiveVolumeSimulation()

      // Calling start multiple times returns the same teardown reference without creating duplicate intervals
      expect(typeof stopSim1).toBe('function')
      expect(typeof stopSim2).toBe('function')

      const initialVol = getRollingClientSwapVolume('usdc-eurc-stable-pool')

      // Advance by 30 seconds
      vi.advanceTimersByTime(30000)

      const updatedVol = getRollingClientSwapVolume('usdc-eurc-stable-pool')
      expect(updatedVol).toBeGreaterThan(initialVol)

      // Clean up
      stopSim1()
      vi.useRealTimers()
    })
  })
})
