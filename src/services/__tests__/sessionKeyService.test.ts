// src/services/__tests__/sessionKeyService.test.ts
// Unit tests verifying wallet-scoped session key isolation in Arcis

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getSessionKeyConfig,
  saveSessionKeyConfig,
  activateSessionKey,
  verifySessionLimits,
  deductSessionSpend,
  revokeSessionKey,
  normalizeWalletAddress,
  setActiveWalletForSession,
} from '../sessionKeyService'

describe('Wallet-Scoped Session Key Isolation', () => {
  const WALLET_A = '0x1111111111111111111111111111111111111111'
  const WALLET_B = '0x2222222222222222222222222222222222222222'

  let mockLocalStorage: Record<string, string> = {}
  let mockSessionStorage: Record<string, string> = {}

  beforeEach(() => {
    mockLocalStorage = {}
    mockSessionStorage = {}

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockLocalStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockLocalStorage[key] = val
      },
      removeItem: (key: string) => {
        delete mockLocalStorage[key]
      },
      clear: () => {
        mockLocalStorage = {}
      },
    })

    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mockSessionStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockSessionStorage[key] = val
      },
      removeItem: (key: string) => {
        delete mockSessionStorage[key]
      },
      clear: () => {
        mockSessionStorage = {}
      },
    })

    setActiveWalletForSession(null)
  })

  it('normalizes addresses consistently', () => {
    expect(normalizeWalletAddress(' 0xAbCdEf ')).toBe('0xabcdef')
    expect(normalizeWalletAddress(null)).toBe('default')
    expect(normalizeWalletAddress(undefined)).toBe('default')
  })

  it('maintains completely isolated configs and budgets for distinct wallets', async () => {
    // 1. Activate session for Wallet A with $250 cap
    const configA = await activateSessionKey({
      walletAddress: WALLET_A,
      maxSpendUsdc: 250,
      maxPerTxUsdc: 75,
      durationHours: 12,
    })

    // 2. Activate session for Wallet B with $50 cap
    const configB = await activateSessionKey({
      walletAddress: WALLET_B,
      maxSpendUsdc: 50,
      maxPerTxUsdc: 20,
      durationHours: 6,
    })

    expect(configA.maxSpendUsdc).toBe(250)
    expect(configB.maxSpendUsdc).toBe(50)
    expect(configA.sessionPublicKey).not.toBe(configB.sessionPublicKey)

    // Verify stored retrieval
    const loadedA = getSessionKeyConfig(WALLET_A)
    const loadedB = getSessionKeyConfig(WALLET_B)

    expect(loadedA.maxSpendUsdc).toBe(250)
    expect(loadedB.maxSpendUsdc).toBe(50)
  })

  it('deducts spend from the targeted wallet only without affecting others', async () => {
    await activateSessionKey({
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })

    await activateSessionKey({
      walletAddress: WALLET_B,
      maxSpendUsdc: 100,
    })

    // Spend 30 on Wallet A
    deductSessionSpend(30, WALLET_A)

    const stateA = getSessionKeyConfig(WALLET_A)
    const stateB = getSessionKeyConfig(WALLET_B)

    expect(stateA.spentUsdc).toBe(30)
    expect(stateB.spentUsdc).toBe(0)

    // Limits check: 80 USDC on A should fail (remaining is 70), on B it should pass single-tx threshold check
    const checkA = verifySessionLimits('send', 80, WALLET_A)
    expect(checkA.allowed).toBe(false)
  })

  it('revoking one wallet does not deactivate other wallets', async () => {
    await activateSessionKey({
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })
    await activateSessionKey({
      walletAddress: WALLET_B,
      maxSpendUsdc: 100,
    })

    revokeSessionKey(WALLET_A)

    const stateA = getSessionKeyConfig(WALLET_A)
    const stateB = getSessionKeyConfig(WALLET_B)

    expect(stateA.isActive).toBe(false)
    expect(stateB.isActive).toBe(true)
  })
})
