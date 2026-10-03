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
  reserveSessionSpend,
  releaseSessionSpend,
  commitSessionSpend,
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

  it('maintains isolated local caps without provisioning executable session keys', async () => {
    // 1. Activate session for Wallet A with $250 cap
    const configA = await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 250,
      maxPerTxUsdc: 75,
      durationHours: 12,
    })

    // 2. Activate session for Wallet B with $50 cap
    const configB = await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_B,
      maxSpendUsdc: 50,
      maxPerTxUsdc: 20,
      durationHours: 6,
    })

    expect(configA.maxSpendUsdc).toBe(250)
    expect(configB.maxSpendUsdc).toBe(50)
    expect(configA.sessionPublicKey).toBe('')
    expect(configB.sessionPublicKey).toBe('')
    expect(configA.ephemeralPrivateKey).toBeUndefined()
    expect(configB.ephemeralPrivateKey).toBeUndefined()
    expect(Object.keys(mockSessionStorage)).toHaveLength(0)

    // Verify stored retrieval
    const loadedA = getSessionKeyConfig(WALLET_A)
    const loadedB = getSessionKeyConfig(WALLET_B)

    expect(loadedA.maxSpendUsdc).toBe(250)
    expect(loadedB.maxSpendUsdc).toBe(50)
  })

  it('deducts spend from the targeted wallet only without affecting others', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })

    await activateSessionKey({
      userApproved: true,
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
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_B,
      maxSpendUsdc: 100,
    })

    revokeSessionKey(WALLET_A)

    const stateA = getSessionKeyConfig(WALLET_A)
    const stateB = getSessionKeyConfig(WALLET_B)

    expect(stateA.isActive).toBe(false)
    expect(stateB.isActive).toBe(true)
  })

  it('migrates legacy session metadata without hydrating keys', () => {
    const storageKey = `arcis_session_meta_v3_${WALLET_A}`
    mockLocalStorage[storageKey] = JSON.stringify({
      sessionId: 'legacy-session', sessionPublicKey: '0x3333333333333333333333333333333333333333',
      walletAddress: WALLET_A, expiresAt: Date.now() + 60_000, maxSpendUsdc: 100,
      spentUsdc: 0, maxPerTxUsdc: 50, allowedActions: ['send'], isActive: true,
      autoExecute: false, createdAt: Date.now(),
    })
    mockSessionStorage[`arcis_session_priv_key_v3_${WALLET_A}`] = '0xlegacy-private-key'

    const migrated = getSessionKeyConfig(WALLET_A)
    expect(migrated.ephemeralPrivateKey).toBeUndefined()
    expect(mockSessionStorage[`arcis_session_priv_key_v3_${WALLET_A}`]).toBe('0xlegacy-private-key')
  })

  it('never activates a session without explicit user approval', async () => {
    const refused = await activateSessionKey({
      userApproved: false,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })

    expect(refused.isActive).toBe(false)
    expect(refused.autoExecute).toBe(false)
    expect(verifySessionLimits('send', 1, WALLET_A).allowed).toBe(false)

    // A freshly provisioned config must also be unconfigured (no phantom session in storage).
    const fresh = getSessionKeyConfig(WALLET_B)
    expect(fresh.isActive).toBe(false)
    expect(fresh.autoExecute).toBe(false)
    expect(fresh.maxSpendUsdc).toBe(0)
    expect(mockLocalStorage[`arcis_session_meta_v3_${WALLET_B}`]).toBeUndefined()
  })

  it('activates local session with user approval and enforces limits without creating a signing key', async () => {
    const approved = await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
      maxPerTxUsdc: 50,
      autoExecute: true,
    })

    expect(approved.isActive).toBe(true)
    expect(approved.autoExecute).toBe(true)
    expect(approved.sessionPublicKey).toBe('')
    expect(approved.ephemeralPrivateKey).toBeUndefined()
    expect(Object.keys(mockSessionStorage)).toHaveLength(0)
    expect(verifySessionLimits('send', 1, WALLET_A).allowed).toBe(true)
  })

  it('does not persist phantom sessions to storage on read', () => {
    const fresh = getSessionKeyConfig(WALLET_A)
    expect(fresh.isActive).toBe(false)
    expect(fresh.maxSpendUsdc).toBe(0)
    expect(mockLocalStorage[`arcis_session_meta_v3_${WALLET_A}`]).toBeUndefined()
  })

  it('completely removes session from storage on revocation', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })
    expect(mockLocalStorage[`arcis_session_meta_v3_${WALLET_A}`]).toBeDefined()

    revokeSessionKey(WALLET_A)
    expect(mockLocalStorage[`arcis_session_meta_v3_${WALLET_A}`]).toBeUndefined()
    const current = getSessionKeyConfig(WALLET_A)
    expect(current.isActive).toBe(false)
    expect(current.maxSpendUsdc).toBe(0)
  })

  it('rejects NaN, negative, and infinite spend amounts (W3-04)', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
    })
    expect(verifySessionLimits('send', NaN, WALLET_A).allowed).toBe(false)
    expect(verifySessionLimits('send', -10, WALLET_A).allowed).toBe(false)
    expect(verifySessionLimits('send', Infinity, WALLET_A).allowed).toBe(false)
  })

  it('prevents concurrent overspend via reservation mechanism (W3-04)', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET_A,
      maxSpendUsdc: 100,
      maxPerTxUsdc: 100,
    })

    // Action 1 checks 80 USDC -> allowed
    expect(verifySessionLimits('send', 80, WALLET_A).allowed).toBe(true)
    expect(reserveSessionSpend(80, WALLET_A)).toBe(true)

    // Action 2 tries 80 USDC concurrently -> rejected because 80 is reserved
    expect(verifySessionLimits('send', 80, WALLET_A).allowed).toBe(false)
    expect(reserveSessionSpend(80, WALLET_A)).toBe(false)

    // Action 1 fails -> releases reservation
    releaseSessionSpend(80, WALLET_A)
    expect(verifySessionLimits('send', 80, WALLET_A).allowed).toBe(true)

    // Action 1 succeeds -> commits spend
    reserveSessionSpend(80, WALLET_A)
    commitSessionSpend(80, WALLET_A)
    expect(getSessionKeyConfig(WALLET_A).spentUsdc).toBe(80)
    expect(verifySessionLimits('send', 25, WALLET_A).allowed).toBe(false)
  })
})
