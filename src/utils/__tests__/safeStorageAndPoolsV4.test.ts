import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as poolsData from '../../hooks/usePoolsData'
import { safeStorage } from '../../hooks/usePoolsData'
import { STABLE_SWAP_ABI, YIELD_VAULT_ABI } from '../../config/poolsConfig'

// Phase 1: per-user reward balances live on-chain (`pendingFees` / `pendingYield`) and the
// localStorage checkpoints were removed entirely. `safeStorage` itself is still used for the
// first-paint pool-state cache, so its resilience guarantees are still covered here.
describe('safeStorage Resilience & Phase 1 V4 wiring', () => {
  beforeEach(() => {
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
      safeStorage.set('test:fallback:key', 'memory-backed-val')
      expect(safeStorage.get('test:fallback:key')).toBe('memory-backed-val')

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

  describe('localStorage checkpoints are gone', () => {
    const removedHelpers = [
      'getPoolStakingTimestamp',
      'setPoolStakingTimestamp',
      'getPoolClaimFeeCheckpoint',
      'setPoolClaimFeeCheckpoint',
      'getPoolYieldClaimCheckpoint',
      'setPoolYieldClaimCheckpoint',
      'resetPoolCheckpointsForTesting',
    ]

    it('no longer exports any per-user checkpoint helper', () => {
      for (const name of removedHelpers) {
        expect((poolsData as Record<string, unknown>)[name]).toBeUndefined()
      }
    })
  })

  describe('V4 harvest ABI surface', () => {
    const callNames = (abi: readonly { name?: string }[]) => abi.map((entry) => entry.name).filter(Boolean)

    it('exposes harvest + pendingFees on LP pools and harvest + pendingYield on the vault', () => {
      expect(callNames(STABLE_SWAP_ABI)).toContain('harvest')
      expect(callNames(STABLE_SWAP_ABI)).toContain('pendingFees')
      expect(callNames(YIELD_VAULT_ABI)).toContain('harvest')
      expect(callNames(YIELD_VAULT_ABI)).toContain('pendingYield')
    })

  })

  // The V4 switch is env-driven, so these cases must not depend on whatever `.env` happens to
  // hold (a real deployment sets VITE_POOL_VERSION=v4). Each case loads a fresh module copy with
  // a stubbed pool env and asserts how the active contract set resolves.
  describe('V4 wiring resolves from the pool env', () => {
    const ZERO = '0x0000000000000000000000000000000000000000'
    const CONFIGURED = {
      STABLE: '0x1111111111111111111111111111111111111111',
      CONSTANT_PRODUCT: '0x2222222222222222222222222222222222222222',
      YIELD_VAULT: '0x3333333333333333333333333333333333333333',
    }
    const POOL_ENV_KEYS = [
      'VITE_POOL_VERSION',
      'VITE_POOL_V4_STABLE_SWAP',
      'VITE_POOL_V4_CONSTANT_PRODUCT',
      'VITE_POOL_V4_YIELD_VAULT',
    ] as const

    /** Re-evaluate poolsConfig against `env` (unset keys are blanked) and return the fresh module. */
    async function loadPoolsConfigWith(env: Partial<Record<(typeof POOL_ENV_KEYS)[number], string>>) {
      for (const key of POOL_ENV_KEYS) vi.stubEnv(key, env[key] ?? '')
      vi.resetModules()
      const fresh = await import('../../config/poolsConfig')
      vi.unstubAllEnvs()
      return fresh
    }

    it('reads VITE_POOL_VERSION directly from env and sets POOL_VERSION / POOL_VERSION_V4 accordingly', async () => {
      const freshV3 = await loadPoolsConfigWith({ VITE_POOL_VERSION: 'v3' })
      expect(freshV3.POOL_VERSION).toBe('v3')
      expect(freshV3.POOL_VERSION_V4).toBe(false)

      const freshV4 = await loadPoolsConfigWith({ VITE_POOL_VERSION: 'v4' })
      expect(freshV4.POOL_VERSION).toBe('v4')
      expect(freshV4.POOL_VERSION_V4).toBe(true)

      const freshDefault = await loadPoolsConfigWith({})
      expect(freshDefault.POOL_VERSION).toBe('v4')
      expect(freshDefault.POOL_VERSION_V4).toBe(true)
    })

    it('respects configured pool addresses from environment variables', async () => {
      const fresh = await loadPoolsConfigWith({
        VITE_POOL_VERSION: 'v4',
        VITE_POOL_V4_STABLE_SWAP: CONFIGURED.STABLE,
        VITE_POOL_V4_CONSTANT_PRODUCT: CONFIGURED.CONSTANT_PRODUCT,
        VITE_POOL_V4_YIELD_VAULT: CONFIGURED.YIELD_VAULT,
      })
      expect(fresh.POOL_VERSION_V4).toBe(true)
      expect(fresh.POOL_CONTRACTS.STABLE_SWAP_POOL).toBe(CONFIGURED.STABLE)
      expect(fresh.POOL_CONTRACTS.CONSTANT_PRODUCT_POOL).toBe(CONFIGURED.CONSTANT_PRODUCT)
      expect(fresh.POOL_CONTRACTS.YIELD_VAULT).toBe(CONFIGURED.YIELD_VAULT)
      expect(fresh.POOL_CONTRACTS.USDC).toBe(fresh.POOL_USDC)
      expect(fresh.POOL_CONTRACTS.EURC).toBe(fresh.POOL_EURC)
      expect(fresh.POOL_CONTRACTS.cirBTC).toBe(fresh.POOL_CIRBTC)
    })

    it('falls back to canonical Arc Testnet deployed addresses when environment address is empty or malformed', async () => {
      const fresh = await loadPoolsConfigWith({
        VITE_POOL_VERSION: 'v4',
        VITE_POOL_V4_STABLE_SWAP: '0xnot-an-address',
        VITE_POOL_V4_CONSTANT_PRODUCT: '',
        VITE_POOL_V4_YIELD_VAULT: 'invalid',
      })
      expect(fresh.POOL_VERSION_V4).toBe(true)
      expect(fresh.POOL_CONTRACTS.STABLE_SWAP_POOL).toBe('0xC3EdDA15AdfaC31ADfC23aC86dC96d791f72bE8a')
      expect(fresh.POOL_CONTRACTS.CONSTANT_PRODUCT_POOL).toBe('0xf0e5f1d5C36a8362D96A8a43a441c6bb29416349')
      expect(fresh.POOL_CONTRACTS.YIELD_VAULT).toBe('0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A')
    })
  })
})
