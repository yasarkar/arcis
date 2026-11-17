if (typeof (globalThis as any).document === 'undefined') {
  ;(globalThis as any).document = { body: {} }
}

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  activateSessionKey,
  getSessionKeyConfig,
  deductSessionSpend,
  reserveSessionSpend,
  releaseSessionSpend,
  revokeSessionKey,
  verifySessionLimits,
  getEphemeralSessionAccount,
  clearEphemeralSessionAccount,
  COPILOT_SESSION_UPDATED_EVENT,
  MARKETPLACE_SESSION_UPDATED_EVENT,
} from '../sessionKeyService'

const WALLET = '0x1111111111111111111111111111111111111111'

const mockLocalStorage: Record<string, string> = {}
const mockSessionStorage: Record<string, string> = {}

const listeners: Record<string, Function[]> = {}

const mockWindow = {
  addEventListener: (event: string, fn: Function) => {
    listeners[event] = listeners[event] || []
    listeners[event].push(fn)
  },
  removeEventListener: (event: string, fn: Function) => {
    if (!listeners[event]) return
    listeners[event] = listeners[event].filter((f) => f !== fn)
  },
  dispatchEvent: (event: any) => {
    const arr = listeners[event?.type] || []
    arr.forEach((fn) => fn(event))
    return true
  },
}
;(globalThis as any).window = mockWindow
;(globalThis as any).CustomEvent = class CustomEvent {
  type: string
  detail: any
  constructor(type: string, init?: any) {
    this.type = type
    this.detail = init?.detail
  }
}

describe('Dual-Scope Session Isolation (Ask Arco Copilot vs Marketplace)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    for (const key of Object.keys(mockLocalStorage)) delete mockLocalStorage[key]
    for (const key of Object.keys(mockSessionStorage)) delete mockSessionStorage[key]

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockLocalStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockLocalStorage[key] = val
      },
      removeItem: (key: string) => {
        delete mockLocalStorage[key]
      },
      clear: () => {
        for (const k of Object.keys(mockLocalStorage)) delete mockLocalStorage[k]
      },
    })

    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mockSessionStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockSessionStorage[key] = val
      },
      removeItem: (key: string) => {
        delete mockSessionStorage[key]
      },
    })

    clearEphemeralSessionAccount(WALLET, 'copilot')
    clearEphemeralSessionAccount(WALLET, 'marketplace')
  })

  it('allows concurrent active sessions for the same wallet with independent budgets and actions', async () => {
    // 1. Activate Copilot session (DeFi commands: swap, deposit, etc., 100 USDC)
    const copilot = await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      maxPerTxUsdc: 50,
      allowedActions: ['swap', 'deposit', 'bridge', 'send'],
      enableEnclave: true,
      scope: 'copilot',
    })

    // 2. Activate Marketplace session (x402 AI Services, 2 USDC)
    const marketplace = await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 2,
      maxPerTxUsdc: 2,
      allowedActions: ['ai_service'],
      enableEnclave: true,
      scope: 'marketplace',
    })

    expect(copilot.isActive).toBe(true)
    expect(copilot.maxSpendUsdc).toBe(100)
    expect(copilot.scope).toBe('copilot')
    expect(copilot.allowedActions).toEqual(['swap', 'deposit', 'bridge', 'send'])

    expect(marketplace.isActive).toBe(true)
    expect(marketplace.maxSpendUsdc).toBe(2)
    expect(marketplace.scope).toBe('marketplace')
    expect(marketplace.allowedActions).toEqual(['ai_service'])

    // Ephemeral enclave addresses must be isolated
    expect(copilot.sessionPublicKey).not.toBe(marketplace.sessionPublicKey)
    expect(copilot.sessionPublicKey).toMatch(/^0x[a-fA-F0-9]{40}$/)
    expect(marketplace.sessionPublicKey).toMatch(/^0x[a-fA-F0-9]{40}$/)

    // Stored keys must be separate
    expect(mockLocalStorage[`arcis_session_meta_v3_${WALLET}`]).toBeDefined()
    expect(mockLocalStorage[`arcis_marketplace_session_v1_${WALLET}`]).toBeDefined()
  })

  it('deducts spend independently without cross-leakage between scopes', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      scope: 'copilot',
    })

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 5,
      scope: 'marketplace',
    })

    // Spend 0.05 USDC in Marketplace
    deductSessionSpend(0.05, WALLET, 'marketplace')

    const marketState = getSessionKeyConfig(WALLET, 'marketplace')
    const copilotState = getSessionKeyConfig(WALLET, 'copilot')

    expect(marketState.spentUsdc).toBe(0.05)
    expect(copilotState.spentUsdc).toBe(0)

    // Spend 20 USDC in Copilot
    deductSessionSpend(20, WALLET, 'copilot')

    const marketState2 = getSessionKeyConfig(WALLET, 'marketplace')
    const copilotState2 = getSessionKeyConfig(WALLET, 'copilot')

    expect(marketState2.spentUsdc).toBe(0.05)
    expect(copilotState2.spentUsdc).toBe(20)
  })

  it('enforces action permissions per scope', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      allowedActions: ['swap', 'deposit'],
      scope: 'copilot',
    })

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 5,
      allowedActions: ['ai_service'],
      scope: 'marketplace',
    })

    // Copilot scope
    expect(verifySessionLimits('swap', 10, WALLET, 'copilot').allowed).toBe(true)
    expect(verifySessionLimits('ai_service', 1, WALLET, 'copilot').allowed).toBe(false)

    // Marketplace scope
    expect(verifySessionLimits('ai_service', 1, WALLET, 'marketplace').allowed).toBe(true)
    expect(verifySessionLimits('swap', 1, WALLET, 'marketplace').allowed).toBe(false)
  })

  it('reserves and releases spend per scope independently', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 5,
      scope: 'marketplace',
    })

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      scope: 'copilot',
    })

    // Reserve 4 USDC in marketplace (max is 5)
    expect(reserveSessionSpend(4, WALLET, 'marketplace')).toBe(true)
    // Another 2 USDC in marketplace must fail (4 + 2 > 5)
    expect(reserveSessionSpend(2, WALLET, 'marketplace')).toBe(false)

    // Copilot has 100 USDC budget, so 10 USDC reservation must succeed
    expect(reserveSessionSpend(10, WALLET, 'copilot')).toBe(true)

    releaseSessionSpend(4, WALLET, 'marketplace')
    // After release, 2 USDC in marketplace should succeed
    expect(reserveSessionSpend(2, WALLET, 'marketplace')).toBe(true)
    releaseSessionSpend(2, WALLET, 'marketplace')
    releaseSessionSpend(10, WALLET, 'copilot')
  })

  it('revoking copilot session leaves marketplace session active and intact', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      scope: 'copilot',
    })

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 5,
      scope: 'marketplace',
    })

    revokeSessionKey(WALLET, 'copilot')

    const copilot = getSessionKeyConfig(WALLET, 'copilot')
    const marketplace = getSessionKeyConfig(WALLET, 'marketplace')

    expect(copilot.isActive).toBe(false)
    expect(copilot.maxSpendUsdc).toBe(0)

    expect(marketplace.isActive).toBe(true)
    expect(marketplace.maxSpendUsdc).toBe(5)
  })

  it('revoking marketplace session leaves copilot session active and intact', async () => {
    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      scope: 'copilot',
    })

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 5,
      scope: 'marketplace',
    })

    revokeSessionKey(WALLET, 'marketplace')

    const copilot = getSessionKeyConfig(WALLET, 'copilot')
    const marketplace = getSessionKeyConfig(WALLET, 'marketplace')

    expect(marketplace.isActive).toBe(false)
    expect(marketplace.maxSpendUsdc).toBe(0)

    expect(copilot.isActive).toBe(true)
    expect(copilot.maxSpendUsdc).toBe(100)
  })

  it('dispatches scoped custom events for listeners', async () => {
    const copilotListener = vi.fn()
    const marketplaceListener = vi.fn()

    window.addEventListener(COPILOT_SESSION_UPDATED_EVENT, copilotListener)
    window.addEventListener(MARKETPLACE_SESSION_UPDATED_EVENT, marketplaceListener)

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 100,
      scope: 'copilot',
    })

    expect(copilotListener).toHaveBeenCalled()
    expect(marketplaceListener).not.toHaveBeenCalled()

    copilotListener.mockClear()
    marketplaceListener.mockClear()

    await activateSessionKey({
      userApproved: true,
      walletAddress: WALLET,
      maxSpendUsdc: 5,
      scope: 'marketplace',
    })

    expect(copilotListener).not.toHaveBeenCalled()
    expect(marketplaceListener).toHaveBeenCalled()

    window.removeEventListener(COPILOT_SESSION_UPDATED_EVENT, copilotListener)
    window.removeEventListener(MARKETPLACE_SESSION_UPDATED_EVENT, marketplaceListener)
  })
})
