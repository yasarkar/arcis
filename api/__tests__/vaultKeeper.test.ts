// api/__tests__/vaultKeeper.test.ts
import { describe, it, expect, vi } from 'vitest'
import { getKeeperStatus } from '../_utils/vaultKeeper'

describe('VaultKeeper diagnostics & status', () => {
  it('exposes initial keeper status with defaults', () => {
    const status = getKeeperStatus()
    expect(status).toBeDefined()
    expect(typeof status.enabled).toBe('boolean')
    expect(typeof status.isRunning).toBe('boolean')
    expect(typeof status.intervalMinutes).toBe('number')
    expect(status.intervalMinutes).toBeGreaterThan(0)
    expect(typeof status.distributeAmountUsdc).toBe('number')
    expect(status.distributeAmountUsdc).toBeGreaterThan(0)
  })
})
