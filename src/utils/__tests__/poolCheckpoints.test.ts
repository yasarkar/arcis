import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  safeStorage,
  getPoolStakingTimestamp,
  setPoolStakingTimestamp,
  getPoolClaimFeeCheckpoint,
  setPoolClaimFeeCheckpoint,
  getPoolYieldClaimCheckpoint,
  setPoolYieldClaimCheckpoint,
  resetPoolCheckpointsForTesting,
} from '../../hooks/usePoolsData'

describe('Pool Checkpoints & safeStorage Resilience', () => {
  const testUser = '0x1234567890abcdef1234567890abcdef12345678'
  const poolId = 'usdc-eurc-stable-pool'

  beforeEach(() => {
    resetPoolCheckpointsForTesting()
    try {
      if (typeof window !== 'undefined') {
        window.localStorage?.clear()
        window.sessionStorage?.clear()
      }
    } catch {}
  })

  describe('safeStorage', () => {
    it('stores and retrieves values accurately', () => {
      safeStorage.set('test:key', 'test-value')
      expect(safeStorage.get('test:key')).toBe('test-value')
    })

    it('returns null for non-existent keys', () => {
      expect(safeStorage.get('non-existent-key')).toBeNull()
    })

    it('removes keys properly', () => {
      safeStorage.set('test:key:remove', 'to-be-removed')
      expect(safeStorage.get('test:key:remove')).toBe('to-be-removed')
      safeStorage.remove('test:key:remove')
      expect(safeStorage.get('test:key:remove')).toBeNull()
    })

    it('falls back to memory storage when localStorage throws or window is absent', () => {
      // SSR / Node environment: memory storage operates reliably
      safeStorage.set('test:fallback:key', 'memory-backed-val')
      expect(safeStorage.get('test:fallback:key')).toBe('memory-backed-val')

      // Simulate browser window where localStorage and sessionStorage throw QuotaExceededError
      const mockStorage = {
        getItem: () => {
          throw new Error('QuotaExceeded')
        },
        setItem: () => {
          throw new Error('QuotaExceeded')
        },
        removeItem: () => {
          throw new Error('QuotaExceeded')
        },
      }

      const originalWindow = (globalThis as any).window
      try {
        ;(globalThis as any).window = {
          localStorage: mockStorage,
          sessionStorage: mockStorage,
        }
        safeStorage.set('test:mock-throw:key', 'resilient-val')
        expect(safeStorage.get('test:mock-throw:key')).toBe('resilient-val')
      } finally {
        if (originalWindow === undefined) {
          delete (globalThis as any).window
        } else {
          ;(globalThis as any).window = originalWindow
        }
      }
    })
  })

  describe('Staking Timestamps', () => {
    it('returns 0 when no timestamp is registered', () => {
      expect(getPoolStakingTimestamp(testUser, poolId)).toBe(0)
    })

    it('records and retrieves user staking timestamp', () => {
      const now = Date.now()
      setPoolStakingTimestamp(testUser, poolId, now)
      expect(getPoolStakingTimestamp(testUser, poolId)).toBe(now)
    })

    it('handles case-insensitivity of user address', () => {
      const now = Date.now()
      setPoolStakingTimestamp(testUser.toLowerCase(), poolId, now)
      expect(getPoolStakingTimestamp(testUser.toUpperCase(), poolId)).toBe(now)
    })
  })

  describe('Pool Fee Claim Checkpoints', () => {
    it('returns 0 for unrecorded checkpoints', () => {
      expect(getPoolClaimFeeCheckpoint(testUser, poolId)).toBe(0)
    })

    it('stores and retrieves fee claim checkpoints', () => {
      setPoolClaimFeeCheckpoint(testUser, poolId, 14.52)
      expect(getPoolClaimFeeCheckpoint(testUser, poolId)).toBe(14.52)
    })
  })

  describe('Yield Vault Claim Checkpoints', () => {
    it('returns 0 for unrecorded vault claim checkpoints', () => {
      expect(getPoolYieldClaimCheckpoint(testUser, 'usdc-yield-vault')).toBe(0)
    })

    it('stores and retrieves vault claim checkpoints', () => {
      setPoolYieldClaimCheckpoint(testUser, 'usdc-yield-vault', 55.75)
      expect(getPoolYieldClaimCheckpoint(testUser, 'usdc-yield-vault')).toBe(55.75)
    })
  })
})
