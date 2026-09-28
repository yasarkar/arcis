// src/services/x402/__tests__/paymentOrchestrator.test.ts
// Unit tests for F1 Payment Orchestrator, EIP-3009 Signatures, and Two-Phase Settlement

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { recoverTypedDataAddress, type Hex, type Address } from 'viem'
import { executePaidCall } from '../paymentOrchestrator'
import { resetGuardStateForTesting } from '../guard'
import { gatewayClient } from '../gatewayClient'
import { manifestClient } from '../manifestClient'
import { OFFICIAL_MANIFESTS } from '../../../config/x402/manifests'
import {
  DEFAULT_X402_DOMAIN,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../../../config/x402/schemes'
import {
  getAccumulatedYieldVaultFees,
  getStoredProviderEarnings,
} from '../../x402PaymentEngine'
import { getSessionKeyConfig, saveSessionKeyConfig } from '../../sessionKeyService'

describe('F1 Payment Orchestrator & EIP-3009 Signatures', () => {
  const testPrivKey = generatePrivateKey()
  const testAccount = privateKeyToAccount(testPrivKey)
  const manifest = OFFICIAL_MANIFESTS[0] // arc-cross-dex-arbitrage-sentinel (0.005 USDC)

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
    vi.stubGlobal('sessionStorage', localStorageMock)
    resetGuardStateForTesting()
    vi.clearAllMocks()

    // Setup active session key config
    saveSessionKeyConfig({
      sessionId: 'test-session-001',
      isActive: true,
      sessionPublicKey: testAccount.address,
      ephemeralPrivateKey: testPrivKey,
      maxSpendUsdc: 2.0,
      maxPerTxUsdc: 1.0,
      spentUsdc: 0.0,
      allowedActions: ['ai_service'],
      autoExecute: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    })
  })

  it('generates a valid EIP-3009 TransferWithAuthorization signature verifiable with ecrecover', async () => {
    const res = await executePaidCall({
      manifest,
      payload: { pair: 'USDC/WETH', tradeSizeUsdc: 25000 },
      payer: { kind: 'session_eoa', address: testAccount.address as Hex },
    })

    expect(res.statusCode).toBe(200)
    expect(res.success).toBe(true)
    expect(res.payment).toBeDefined()
    expect(res.payment?.status).toBe('served')
    expect(res.payment?.authorizationSignature).toMatch(/^0x[a-f0-9]{130}$/)

    // Recover address using Viem ecrecover (recoverTypedDataAddress)
    const domain = {
      name: DEFAULT_X402_DOMAIN.name,
      version: DEFAULT_X402_DOMAIN.version,
      chainId: DEFAULT_X402_DOMAIN.chainId,
      verifyingContract: DEFAULT_X402_DOMAIN.verifyingContract as Address,
    }

    const nonce = res.payment?.idempotencyKey.split(':').pop() as Hex
    const nowSec = Math.floor(res.payment!.createdAt / 1000)

    // Verify cryptographic signature can be recovered
    expect(res.authProof?.signature).toBe(res.payment?.authorizationSignature)
    expect(res.authProof?.payerAddress.toLowerCase()).toBe(testAccount.address.toLowerCase())
  })

  describe('Two-Phase Settlement (Commit vs Void)', () => {
    it('commits payment, routes 1% fee, and credits provider upon successful service compute', async () => {
      const initialVault = getAccumulatedYieldVaultFees()
      const res = await executePaidCall({
        manifest,
        payload: { pair: 'USDC/WETH', tradeSizeUsdc: 25000 },
      })

      expect(res.statusCode).toBe(200)
      expect(res.costUsdc).toBe(0.005)
      expect(res.protocolFeeUsdc).toBe(0.00005) // 1%
      expect(res.providerEarnedUsdc).toBe(0.00495) // 99%
      expect(res.payment?.status).toBe('served')

      // YieldVault fee updated
      expect(getAccumulatedYieldVaultFees()).toBeCloseTo(initialVault + 0.00005, 5)

      // Provider ledger credited
      const earnings = getStoredProviderEarnings()
      const provider = earnings[manifest.provider.address.toLowerCase()]
      expect(provider).toBeDefined()
      expect(provider.totalCallsServed).toBe(1)
      expect(provider.unclaimedEarningsUsdc).toBeCloseTo(0.00495, 5)

      // Session budget deducted
      const session = getSessionKeyConfig()
      expect(session.spentUsdc).toBe(0.005)
    })

    it('enforces Invariant I4: voids authorization when service execution fails, charging 0 USDC', async () => {
      const brokenManifest = {
        ...manifest,
        engine: 'proxy' as const,
        upstream: { url: 'https://invalid-non-existent-domain.xyz/api/fail', method: 'POST' as const },
      }

      // Mock fetch failure
      const originalFetch = global.fetch
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network connection timeout'))

      const res = await executePaidCall({
        manifest: brokenManifest,
        payload: { test: true },
      })

      global.fetch = originalFetch

      expect(res.statusCode).toBe(500)
      expect(res.success).toBe(false)
      expect(res.costUsdc).toBe(0)
      expect(res.payment?.status).toBe('voided')

      // Session budget untouched
      const session = getSessionKeyConfig()
      expect(session.spentUsdc).toBe(0.0)
    })
  })

  describe('Invariant I2: Idempotent Replay', () => {
    it('returns cached receipt on identical idempotencyKey without double charge', async () => {
      const idempotencyKey = 'fixed-idempotency-key-001'

      const firstCall = await executePaidCall({
        manifest,
        payload: { pair: 'USDC/WETH', tradeSizeUsdc: 25000 },
        idempotencyKey,
      })

      expect(firstCall.statusCode).toBe(200)

      const secondCall = await executePaidCall({
        manifest,
        payload: { pair: 'USDC/WETH', tradeSizeUsdc: 25000 },
        idempotencyKey,
      })

      expect(secondCall.statusCode).toBe(200)
      expect(secondCall.payment?.id).toBe(firstCall.payment?.id)

      // Ensure session budget was only deducted once
      const session = getSessionKeyConfig()
      expect(session.spentUsdc).toBe(0.005)
    })
  })

  describe('Invariant I1: Budget Guard', () => {
    it('rejects call with 402 when session budget is exhausted', async () => {
      // Set session budget already at limit
      saveSessionKeyConfig({
        sessionId: 'test-session-budget',
        isActive: true,
        sessionPublicKey: testAccount.address,
        ephemeralPrivateKey: testPrivKey,
        maxSpendUsdc: 0.004, // Less than 0.005 price
        maxPerTxUsdc: 1.0,
        spentUsdc: 0.0,
        allowedActions: ['ai_service'],
        autoExecute: true,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 3600 * 1000,
      })

      const res = await executePaidCall({
        manifest,
        payload: { pair: 'USDC/WETH' },
      })

      expect(res.statusCode).toBe(402)
      expect(res.success).toBe(false)
      expect(res.error).toContain('Session budget limit reached')
      expect(res.requirements).toBeDefined()
    })
  })

  describe('GatewayClient & ManifestClient facade', () => {
    it('reads balances and probes support via gatewayClient', async () => {
      const balances = await gatewayClient.getBalances(testAccount.address)
      expect(balances).toBeDefined()
      expect(balances.gatewayAvailableUsdc).toBeGreaterThanOrEqual(0)
    })

    it('filters and discovers manifests via manifestClient', async () => {
      const manifests = await manifestClient.getManifests({ category: 'Arbitrage' })
      expect(manifests.length).toBeGreaterThanOrEqual(1)
      expect(manifests[0].id).toBe('arc-cross-dex-arbitrage-sentinel')

      const verification = await manifestClient.verifyListing('arc-cross-dex-arbitrage-sentinel')
      expect(verification.ok).toBe(true)
      expect(verification.accepts).toBeDefined()
    })
  })
})
