// src/services/x402/__tests__/tollgateApi.test.ts
// Integration tests for F2 Tollgate API Dispatcher, Invariant Guards,
// EIP-3009 ecrecover verification, and F3 Provider Ledger & Withdrawal.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getAddress, type Hex, type Address } from 'viem'
import { GET, POST } from '../../../../api/x402'
import { OFFICIAL_MANIFESTS } from '../../../config/x402/manifests'
import {
  DEFAULT_X402_DOMAIN,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../../../config/x402/schemes'
import { usdcToBaseUnits } from '../../../config/x402/pricing'
import { POOL_CONTRACTS } from '../../../config/poolsConfig'

describe('F2 Tollgate API & Dispatcher (/api/x402)', () => {
  const payerPrivKey = generatePrivateKey()
  const payerAccount = privateKeyToAccount(payerPrivKey)
  const manifest = OFFICIAL_MANIFESTS[0] // arc-cross-dex-arbitrage-sentinel (0.005 USDC)
  const providerAddress = getAddress(manifest.provider.address.toLowerCase())

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('POST /api/x402/services registers a custom community service', async () => {
    const customService = {
      ...manifest,
      id: 'custom-community-alpha-test',
      name: 'Custom Alpha Service',
      listing: { kind: 'community' as const, ownerAddress: payerAccount.address, createdAt: Date.now() },
    }
    const req = new Request('http://localhost:3000/api/x402/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(customService),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.manifest.id).toBe('custom-community-alpha-test')
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
    expect(data.requirements.accepts[0].asset).toBe('USDC')
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

  it('POST /api/x402/:id with valid EIP-3009 signature executes service and commits Two-Phase Settlement', async () => {
    const nonce: Hex = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`
    const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600)
    const validAfter = 0n

    const domain = {
      name: DEFAULT_X402_DOMAIN.name,
      version: DEFAULT_X402_DOMAIN.version,
      chainId: DEFAULT_X402_DOMAIN.chainId,
      verifyingContract: getAddress(
        (manifest.accepts[0]?.domain?.verifyingContract as string) || POOL_CONTRACTS.USDC
      ),
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

    const req = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `x402-Gateway-V1 payer=${payerAccount.address},nonce=${nonce},signature=${signature}`,
      },
      body: JSON.stringify({
        payload: { pair: 'USDC/EURC', tradeSizeUsdc: 25000 },
        authProof: {
          signature,
          payerAddress: payerAccount.address,
        },
        nonce,
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const paymentResponseHeader = res.headers.get('PAYMENT-RESPONSE')
    expect(paymentResponseHeader).toBeDefined()

    const data = await res.json()
    expect(data.statusCode).toBe(200)
    expect(data.success).toBe(true)
    expect(data.costUsdc).toBe(0.005)
    expect(data.protocolFeeUsdc).toBe(0.00005) // 1%
    expect(data.providerEarnedUsdc).toBe(0.00495) // 99%
    expect(data.payment).toBeDefined()
    expect(data.payment.status).toBe('settled')
    expect(data.data).toBeDefined() // Live intelligence computed
  })

  it('enforces Invariant I3: Nonce replay returns 409 Conflict', async () => {
    const fixedNonce: Hex = `0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789`
    const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)

    const domain = {
      name: DEFAULT_X402_DOMAIN.name,
      version: DEFAULT_X402_DOMAIN.version,
      chainId: DEFAULT_X402_DOMAIN.chainId,
      verifyingContract: getAddress(
        (manifest.accepts[0]?.domain?.verifyingContract as string) || POOL_CONTRACTS.USDC
      ),
    }

    const message = {
      from: payerAccount.address,
      to: providerAddress,
      value: BigInt(requiredBaseUnits),
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
      nonce: fixedNonce,
    }

    const signature = await payerAccount.signTypedData({
      domain,
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    })

    // First call consumes the nonce
    const req1 = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `x402-Gateway-V1 payer=${payerAccount.address},nonce=${fixedNonce},signature=${signature}`,
      },
      body: JSON.stringify({
        payload: { pair: 'USDC/EURC' },
        nonce: fixedNonce,
        authProof: { signature, payerAddress: payerAccount.address },
      }),
    })
    const res1 = await POST(req1)
    expect(res1.status).toBe(200)

    // Second call with same nonce must be rejected
    const req2 = new Request(`http://localhost:3000/api/x402/${manifest.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `x402-Gateway-V1 payer=${payerAccount.address},nonce=${fixedNonce},signature=${signature}`,
      },
      body: JSON.stringify({
        payload: { pair: 'USDC/EURC' },
        nonce: fixedNonce,
        authProof: { signature, payerAddress: payerAccount.address },
      }),
    })
    const res2 = await POST(req2)
    expect(res2.status).toBe(409)
    const errData = await res2.json()
    expect(errData.error).toContain('Nonce replay detected')
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

    it('withdraws earnings via POST /api/x402/withdraw', async () => {
      // Check current available balance first
      const getReq = new Request(`http://localhost:3000/api/x402/provider/${providerAddress}`, {
        method: 'GET',
      })
      const getRes = await GET(getReq)
      const { ledger } = await getRes.json()

      if (ledger.availableUsdc > 0) {
        const withdrawAmount = Number((ledger.availableUsdc * 0.5).toFixed(4))
        const withdrawReq = new Request('http://localhost:3000/api/x402/withdraw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerAddress,
            amountUsdc: withdrawAmount,
          }),
        })

        const withdrawRes = await POST(withdrawReq)
        expect(withdrawRes.status).toBe(200)

        const withdrawData = await withdrawRes.json()
        expect(withdrawData.success).toBe(true)
        expect(withdrawData.amountUsdc).toBe(withdrawAmount)
        expect(withdrawData.txHash).toMatch(/^0x[a-f0-9]{64}$/)
      }
    })

    it('rejects withdrawal if amount exceeds available balance', async () => {
      const withdrawReq = new Request('http://localhost:3000/api/x402/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerAddress,
          amountUsdc: 999999.0, // Far exceeds balance
        }),
      })

      const withdrawRes = await POST(withdrawReq)
      expect(withdrawRes.status).toBe(400)
      const data = await withdrawRes.json()
      expect(data.error).toContain('Insufficient unclaimed earnings')
    })
  })
})
