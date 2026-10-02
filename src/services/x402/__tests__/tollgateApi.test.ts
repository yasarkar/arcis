// src/services/x402/__tests__/tollgateApi.test.ts
// Integration tests for F2 Tollgate API Dispatcher, Invariant Guards,
// EIP-3009 ecrecover verification, and F3 Provider Ledger & Withdrawal.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getAddress, type Hex, type Address } from 'viem'
import { GET, POST } from '../../../../api/x402'
import { OFFICIAL_MANIFESTS } from '../../../config/x402/manifests'
import {
  GATEWAY_BATCHED_DOMAIN,
  CIRCLE_BATCHING_METADATA,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../../../config/x402/schemes'
import { usdcToBaseUnits } from '../../../config/x402/pricing'
import { ARC_TESTNET_TOKENS } from '../../../config/arcChain'
import {
  X402_AUTHORIZATION_DOMAIN,
  PROVIDER_LEDGER_TYPES,
  SERVICE_REGISTRATION_TYPES,
  hashServiceManifest,
} from '../../../config/x402/authorization'
import {
  kvGet,
  kvUpdateProviderLedger,
  kvCreateProviderSettlementIntent,
  kvMarkProviderSettlementAccepted,
  kvGetPendingProviderSettlement,
} from '../../../../api/_utils/redisStorage'
import { generateLiveServiceData } from '../../aiServicesDataProvider'

const circleMock = vi.hoisted(() => ({ settle: vi.fn() }))
vi.mock('@circle-fin/x402-batching/server', () => ({
  BatchFacilitatorClient: vi.fn(function () { return { settle: circleMock.settle } }),
}))
vi.mock('../../aiServicesDataProvider', async () => {
  const actual = await vi.importActual<typeof import('../../aiServicesDataProvider')>('../../aiServicesDataProvider')
  return { ...actual, generateLiveServiceData: vi.fn() }
})

describe('F2 Tollgate API & Dispatcher (/api/x402)', () => {
  const payerPrivKey = generatePrivateKey()
  const payerAccount = privateKeyToAccount(payerPrivKey)
  const manifest = OFFICIAL_MANIFESTS[0] // arc-cross-dex-arbitrage-sentinel (0.005 USDC)
  const providerAddress = getAddress(manifest.provider.address.toLowerCase())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'false')
    vi.stubEnv('X402_UPSTREAM_HOST_ALLOWLIST', 'api.example.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('GET /api/x402/services returns all service manifests catalog', async () => {
    const req = new Request('http://localhost:3000/api/x402/services', { method: 'GET' })
    const res = await GET(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.count).toBeGreaterThanOrEqual(5)
    expect(data.services.length).toBeGreaterThanOrEqual(5)
  })

  it('POST /api/x402/services rejects unsigned registration and registers a signed, safe community service', async () => {
    const serviceId = `custom-community-${Date.now()}`
    const customService = {
      id: serviceId,
      version: '1.0.0',
      name: 'Custom Alpha Service',
      tagline: 'A safe community test service',
      category: 'Arbitrage' as const,
      engine: 'proxy' as const,
      description: 'Community service used by the x402 registration test.',
      listing: { kind: 'community' as const, ownerAddress: payerAccount.address, createdAt: Date.now() },
      provider: { name: 'Community Provider', address: payerAccount.address, isVerified: false, reputationScore: 0 },
      pricing: { model: 'per_call' as const, priceUsdc: 0.005, maxAmountUsdc: 0.005, protocolFeeBps: 0 },
      accepts: [{ ...manifest.accepts[0], payTo: payerAccount.address, amount: '5000' }],
      serve: { method: 'POST' as const, path: `/api/x402/${serviceId}` },
      upstream: { url: 'https://api.example.com/compute', method: 'POST' as const },
      requestSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
      ui: { form: [{ name: 'query', label: 'Query', type: 'string' as const, description: 'Input query', required: true }] },
      examples: { request: { query: 'sample' }, response: { result: 'sample' } },
      sla: { p95LatencyMs: 1000, uptimePct: 99, successRate: 99 },
      healthcheckUrl: '/api/x402/health',
      tags: ['Community'],
    }
    const unsignedManifest = customService
    const unsignedRes = await POST(new Request('http://localhost:3000/api/x402/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: unsignedManifest }),
    }))
    expect(unsignedRes.status).toBe(401)

    const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
    const deadline = Math.floor(Date.now() / 1000) + 300
    const signature = await payerAccount.signTypedData({
      domain: X402_AUTHORIZATION_DOMAIN,
      types: SERVICE_REGISTRATION_TYPES,
      primaryType: 'ServiceRegistration',
      message: {
        owner: payerAccount.address,
        manifestHash: hashServiceManifest(customService),
        nonce,
        deadline: BigInt(deadline),
      },
    })
    const req = new Request('http://localhost:3000/api/x402/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: customService, owner: payerAccount.address, nonce, deadline, signature }),
    })
    const res = await POST(req)
    const registrationResponse = await res.clone().json()
    expect(res.status, JSON.stringify(registrationResponse)).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.manifest.id).toBe(customService.id)
  })

  it('rejects community upstreams outside the HTTPS allowlist and private IP space', async () => {
    for (const upstreamUrl of ['http://api.example.com/compute', 'https://127.0.0.1/admin', 'https://unlisted.example/compute']) {
      const unsafeService = {
        ...manifest,
        id: `unsafe-${Math.random().toString(36).slice(2, 10)}`,
        engine: 'proxy' as const,
        listing: { kind: 'community' as const, ownerAddress: payerAccount.address, createdAt: Date.now() },
        provider: { ...manifest.provider, address: payerAccount.address },
        accepts: [{ ...manifest.accepts[0], payTo: payerAccount.address }],
        serve: { method: 'POST' as const, path: '' },
        upstream: { url: upstreamUrl, method: 'POST' as const },
      }
      unsafeService.serve.path = `/api/x402/${unsafeService.id}`
      const response = await POST(new Request('http://localhost:3000/api/x402/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: unsafeService }),
      }))
      expect(response.status).toBe(400)
    }
  })

  it('rejects provider withdrawals without a signature', async () => {
    const response = await POST(new Request('http://localhost:3000/api/x402/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerAddress, amountUsdc: 0.001 }),
    }))
    expect(response.status).toBe(401)
  })

  it('GET /api/x402/health returns system status', async () => {
    const req = new Request('http://localhost:3000/api/x402/health', { method: 'GET' })
    const res = await GET(req)

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('healthy')
    expect(data.protocol).toBe('x402-Gateway-V1')
  })

  it('GET /api/x402/:id returns HTTP 402 with structured requirements and challenge headers', async () => {
    const req = new Request(`http://localhost:3000/api/x402/${manifest.id}`, { method: 'GET' })
    const res = await GET(req)

    expect(res.status).toBe(402)
    expect(res.headers.get('X-Payment-Required')).toBe('true')
    expect(res.headers.get('X-Payment-Amount')).toBe('0.005')
    expect(res.headers.get('X-Payment-Recipient')?.toLowerCase()).toBe(providerAddress.toLowerCase())

    const data = await res.json()
    expect(data.statusCode).toBe(402)
    expect(data.requirements).toBeDefined()
    expect(data.requirements.accepts[0].scheme).toBe('exact')
    expect(data.requirements.accepts[0].asset).toBe(ARC_TESTNET_TOKENS.USDC)
  })

  it('POST /api/x402/:id without authorization returns HTTP 402 challenge', async () => {
    const req = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair: 'USDC/EURC', tradeSizeUsdc: 25000 }),
    })
    const res = await POST(req)

    expect(res.status).toBe(402)
    const data = await res.json()
    expect(data.statusCode).toBe(402)
    expect(data.requirements).toBeDefined()
  })

  it('does not serve data or credit ledgers for a valid authorization without settlement', async () => {
    const nonce: Hex = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`
    const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS)
    const validAfter = 0n

    const domain = {
      ...GATEWAY_BATCHED_DOMAIN,
      verifyingContract: getAddress(GATEWAY_BATCHED_DOMAIN.verifyingContract),
    }

    const message = {
      from: payerAccount.address,
      to: providerAddress,
      value: BigInt(requiredBaseUnits),
      validAfter,
      validBefore,
      nonce,
    }

    const signature = await payerAccount.signTypedData({
      domain,
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    })

    const beforeLedgerRes = await GET(new Request(`http://localhost:3000/api/x402/provider/${providerAddress}`))
    const beforeLedger = (await beforeLedgerRes.json()).ledger

    const challenge = await GET(new Request(`http://localhost:3000/api/x402/${manifest.id}`))
    const challengeBody = await challenge.json()
    const paymentHeader = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { signature, authorization: { ...message, value: requiredBaseUnits, validAfter: '0', validBefore: validBefore.toString() } },
      accepted: challengeBody.requirements.accepts[0],
      resource: challengeBody.resource,
    })).toString('base64')
    const req = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Payment-Signature': paymentHeader },
      body: JSON.stringify({ payload: { pair: 'USDC/EURC', tradeSizeUsdc: 25000 } }),
    })

    const res = await POST(req)
    expect(res.status).toBe(503)
    expect(res.headers.get('PAYMENT-RESPONSE')).toBeNull()

    const data = await res.json()
    expect(data.statusCode).toBe(503)
    expect(data.success).toBe(false)
    expect(data.error).toMatch(/did not accept the payment/i)
    expect(data.costUsdc).toBe(0)
    expect(data.protocolFeeUsdc).toBe(0)
    expect(data.providerEarnedUsdc).toBe(0)
    expect(data.payment.status).toBe('authorized')
    expect(data.payment.amountUsdc).toBe(0)
    expect(data.payment.settlementRef).toBeUndefined()
    expect(data.data).toBeUndefined()

    const afterLedgerRes = await GET(new Request(`http://localhost:3000/api/x402/provider/${providerAddress}`))
    const afterLedger = (await afterLedgerRes.json()).ledger
    expect(afterLedger.availableUsdc).toBe(beforeLedger.availableUsdc)
    expect(afterLedger.withdrawnUsdc).toBe(beforeLedger.withdrawnUsdc)
    expect(afterLedger.services).toEqual(beforeLedger.services)
  })

  it('keeps accepted payments pending until Circle confirms the nonce-matched transfer, then credits once', async () => {
    vi.stubEnv('ENABLE_GATEWAY_SETTLE', 'true')
    vi.stubEnv('X402_RECONCILIATION_SECRET', 'unit-test-secret')
    vi.mocked(generateLiveServiceData).mockResolvedValue({ data: { status: 'LIVE' }, actionablePayload: undefined } as any)
    circleMock.settle.mockResolvedValue({ success: true, payer: payerAccount.address, transaction: 'circle-settlement-ref-1', network: 'eip155:5042002' })

    const nonce: Hex = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
    const challengeRes = await GET(new Request(`http://localhost:3000/api/x402/${manifest.id}`))
    const challenge = await challengeRes.json()
    const amount = usdcToBaseUnits(manifest.pricing.priceUsdc)
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS + 10)
    const authorization = { from: payerAccount.address, to: providerAddress, value: BigInt(amount), validAfter: 0n, validBefore, nonce }
    const signature = await payerAccount.signTypedData({
      domain: { ...GATEWAY_BATCHED_DOMAIN, verifyingContract: getAddress(GATEWAY_BATCHED_DOMAIN.verifyingContract) },
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: authorization,
    })
    const paymentSignature = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { signature, authorization: { ...authorization, value: amount, validAfter: '0', validBefore: validBefore.toString() } },
      accepted: challenge.requirements.accepts[0],
      resource: challenge.resource,
    })).toString('base64')
    const acceptedRes = await POST(new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Payment-Signature': paymentSignature },
      body: JSON.stringify({ payload: { pair: 'USDC/EURC', tradeSizeUsdc: 25000 } }),
    }))
    expect(acceptedRes.status).toBe(200)
    const accepted = await acceptedRes.json()
    expect(accepted.success).toBe(true)
    expect(accepted.payment.status).toBe('settlement_pending')
    expect(accepted.payment.settlementRef).toBe('circle-settlement-ref-1')
    expect(accepted.payment.settlementRef).not.toMatch(/^0x[0-9a-f]{64}$/i)
    expect(accepted.providerEarnedUsdc).toBe(0)
    expect(accepted.data.status).toBe('LIVE')
    expect(circleMock.settle).toHaveBeenCalledTimes(1)

    const before = await GET(new Request(`http://localhost:3000/api/x402/provider/${providerAddress}`))
    const beforeLedger = (await before.json()).ledger
    expect(beforeLedger.pendingUsdc).toBeGreaterThanOrEqual(manifest.pricing.priceUsdc)
    expect(beforeLedger.availableUsdc).toBe(0)

    const transfer = {
      id: '00000000-0000-4000-8000-000000000001',
      status: 'confirmed',
      token: 'USDC',
      sendingNetwork: 'eip155:5042002',
      recipientNetwork: 'eip155:5042002',
      fromAddress: payerAccount.address,
      toAddress: providerAddress,
      amount: '0.005',
      nonce,
      txHash: `0x${'a'.repeat(64)}`,
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transfers: [transfer] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const reconcileUrl = `http://localhost:3000/api/x402/provider/${providerAddress}/reconcile/${nonce}`
    const getAttempt = await GET(new Request(reconcileUrl))
    expect(getAttempt.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()

    const reconcile = () => POST(new Request(reconcileUrl, {
      method: 'POST',
      headers: { 'x-x402-reconciliation-secret': 'unit-test-secret' },
    }))
    const firstRes = await reconcile()
    expect(firstRes.status).toBe(200)
    const first = await firstRes.json()
    expect(first.status).toBe('confirmed')
    expect(first.txHash).toBe(transfer.txHash)

    const secondRes = await reconcile()
    expect(secondRes.status).toBe(200)
    expect((await secondRes.json()).idempotent).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const after = await GET(new Request(`http://localhost:3000/api/x402/provider/${providerAddress}`))
    const afterLedger = (await after.json()).ledger
    expect(afterLedger.pendingUsdc).toBe(0)
    expect(afterLedger.availableUsdc).toBe(manifest.pricing.priceUsdc)
    const storedLedger = JSON.parse((await kvGet(`arcis:x402:provider:{${providerAddress.toLowerCase()}}`)) || '{}')
    expect(storedLedger.totalUsdcEarned).toBe(manifest.pricing.priceUsdc)
  })

  it('does not credit failed, pending, or mismatched Circle transfers', async () => {
    vi.stubEnv('X402_RECONCILIATION_SECRET', 'unit-test-secret')
    const provider = getAddress(generatePrivateKey().slice(0, 42))
    const payer = getAddress(generatePrivateKey().slice(0, 42))
    const nonce: Hex = `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`
    const providerLower = provider.toLowerCase()
    const nonceLower = nonce.toLowerCase()
    const providerKey = `arcis:x402:provider:{${providerLower}}`
    const pendingKey = `arcis:x402:pending:{${providerLower}}:${nonceLower}`
    const nonceKey = `arcis:x402:nonce:{${providerLower}}:${nonceLower}`
    const intent = { providerAddress: providerLower, payerAddress: payer.toLowerCase(), serviceId: manifest.id, amountMicros: 5000, amountUsdc: 0.005, nonce: nonceLower, status: 'settling' as const, createdAt: Date.now() }
    expect(await kvCreateProviderSettlementIntent(providerKey, pendingKey, nonceKey, intent)).toBe('created')
    expect(await kvMarkProviderSettlementAccepted(providerKey, pendingKey, 'settlement-ref')).toBe('pending')
    const transfers = [
      { id: '00000000-0000-4000-8000-000000000002', status: 'batched', token: 'USDC', sendingNetwork: 'eip155:5042002', recipientNetwork: 'eip155:5042002', fromAddress: payer, toAddress: provider, amount: '0.005', nonce, txHash: null },
    ]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transfers }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const url = `http://localhost:3000/api/x402/provider/${provider}/${'reconcile'}/${nonce}`
    const makeRequest = () => POST(new Request(url, { method: 'POST', headers: { 'authorization': 'Bearer unit-test-secret' } }))

    const pendingRes = await makeRequest()
    expect((await pendingRes.json()).status).toBe('pending')
    expect((await kvGetPendingProviderSettlement(pendingKey))?.status).toBe('pending')
    expect((await GET(new Request(`http://localhost:3000/api/x402/provider/${provider}`)).then((res) => res.json())).ledger.availableUsdc).toBe(0)

    transfers[0] = { ...transfers[0], status: 'failed' }
    const failedRes = await makeRequest()
    expect((await failedRes.json()).status).toBe('failed')
    expect((await kvGetPendingProviderSettlement(pendingKey))?.status).toBe('failed')
    const ledger = (await GET(new Request(`http://localhost:3000/api/x402/provider/${provider}`)).then((res) => res.json())).ledger
    expect(ledger.availableUsdc).toBe(0)
    expect(ledger.totalUsdcEarned ?? 0).toBe(0)
    expect(ledger.pendingUsdc).toBe(0)
  })

  it('does not consume a nonce when facilitator settlement is unavailable', async () => {
    const fixedNonce: Hex = `0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789`
    const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)

    const domain = {
      ...GATEWAY_BATCHED_DOMAIN,
      verifyingContract: getAddress(GATEWAY_BATCHED_DOMAIN.verifyingContract),
    }

    const message = {
      from: payerAccount.address,
      to: providerAddress,
      value: BigInt(requiredBaseUnits),
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 + 100),
      nonce: fixedNonce,
    }

    const signature = await payerAccount.signTypedData({
      domain,
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    })

    // Without settlement the authorization remains unconsumed; no paid result was served.
    const challenge = await GET(new Request(`http://localhost:3000/api/x402/${manifest.id}`))
    const challengeBody = await challenge.json()
    const paymentHeader = Buffer.from(JSON.stringify({
      x402Version: 2,
      payload: { signature, authorization: { ...message, value: requiredBaseUnits, validAfter: '0', validBefore: message.validBefore.toString() } },
      accepted: challengeBody.requirements.accepts[0],
      resource: challengeBody.resource,
    })).toString('base64')
    const req1 = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Payment-Signature': paymentHeader },
      body: JSON.stringify({ payload: { pair: 'USDC/EURC', tradeSizeUsdc: 25000 } }),
    })
    const res1 = await POST(req1)
    expect(res1.status).toBe(503)

    // Retrying the same authorization still fails closed without pretending the nonce settled.
    const req2 = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Payment-Signature': paymentHeader },
      body: JSON.stringify({ payload: { pair: 'USDC/EURC', tradeSizeUsdc: 25000 } }),
    })
    const res2 = await POST(req2)
    expect(res2.status).toBe(503)
    const errData = await res2.json()
    expect(errData.success).toBe(false)
    expect(errData.payment.status).toBe('authorized')
  })

  describe('F3 Provider Ledger & Withdrawal', () => {
    it('queries provider ledger via GET /api/x402/provider/:address', async () => {
      const req = new Request(`http://localhost:3000/api/x402/provider/${providerAddress}`, {
        method: 'GET',
      })
      const res = await GET(req)

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.ledger).toBeDefined()
      expect(data.ledger.providerAddress.toLowerCase()).toBe(providerAddress.toLowerCase())
      expect(data.ledger.availableUsdc).toBeGreaterThanOrEqual(0)
    })

    it('withdraws earnings atomically via a signed, single-use provider authorization', async () => {
      const withdrawalAccount = privateKeyToAccount(generatePrivateKey())
      const withdrawalProvider = withdrawalAccount.address as Address
      const ledgerKey = `arcis:x402:provider:{${withdrawalProvider.toLowerCase()}}`
      await kvUpdateProviderLedger(ledgerKey, { calls: 1, earnedMicros: 20_000 })
      const amountUsdc = 0.005
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
      const deadline = Math.floor(Date.now() / 1000) + 300
      const signature = await withdrawalAccount.signTypedData({
        domain: X402_AUTHORIZATION_DOMAIN,
        types: PROVIDER_LEDGER_TYPES,
        primaryType: 'ProviderLedgerAuthorization',
        message: {
          providerAddress: withdrawalProvider,
          amountMicros: 5000n,
          nonce,
          deadline: BigInt(deadline),
        },
      })
      const body = { providerAddress: withdrawalProvider, amountUsdc, signature, nonce, deadline }
      const withdrawRes = await POST(new Request('http://localhost:3000/api/x402/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))
      expect(withdrawRes.status).toBe(200)
      const withdrawData = await withdrawRes.json()
      expect(withdrawData.success).toBe(true)
      expect(withdrawData.amountUsdc).toBe(amountUsdc)
      expect(withdrawData.remainingBalanceUsdc).toBe(0.015)
      expect(withdrawData.txHash).toBeUndefined()
      expect(withdrawData.settlementStatus).toBe('offchain_ledger_only')

      const replayRes = await POST(new Request('http://localhost:3000/api/x402/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }))
      expect(replayRes.status).toBe(409)
    })

    it('rejects signed withdrawal if amount exceeds available balance', async () => {
      const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
      const deadline = Math.floor(Date.now() / 1000) + 300
      const amountUsdc = 999999
      const signature = await payerAccount.signTypedData({
        domain: X402_AUTHORIZATION_DOMAIN,
        types: PROVIDER_LEDGER_TYPES,
        primaryType: 'ProviderLedgerAuthorization',
        message: {
          providerAddress: payerAccount.address as Address,
          amountMicros: 999999000000n,
          nonce,
          deadline: BigInt(deadline),
        },
      })
      const withdrawRes = await POST(new Request('http://localhost:3000/api/x402/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerAddress: payerAccount.address, amountUsdc, signature, nonce, deadline }),
      }))
      expect(withdrawRes.status).toBe(400)
      const data = await withdrawRes.json()
      expect(data.error).toContain('Insufficient unclaimed earnings')
    })
  })
})
