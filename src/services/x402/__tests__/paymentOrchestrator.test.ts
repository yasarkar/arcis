import { afterEach, describe, expect, it, vi } from 'vitest'
import { executePaidCall } from '../paymentOrchestrator'
import { OFFICIAL_MANIFESTS } from '../../../config/x402/manifests'
import { ARC_TESTNET_TOKENS } from '../../../config/arcChain'
import { CIRCLE_BATCHING_METADATA, GATEWAY_CONTRACTS, X402_NETWORKS, X402_SCHEMES } from '../../../config/x402/schemes'
import { usdcToBaseUnits } from '../../../config/x402/pricing'
import { arcTestnet } from '../../../config/arcChain'

const manifest = OFFICIAL_MANIFESTS[0]
const eoaAddress = '0x1111111111111111111111111111111111111111'
const base64Json = (value: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(value))))

function eoaProvider() {
  const request = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_chainId') return `0x${arcTestnet.id.toString(16)}`
    if (method === 'eth_accounts') return [eoaAddress]
    if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') return `0x${'11'.repeat(65)}`
    throw new Error(`Unexpected wallet RPC: ${method}`)
  })
  return { request }
}

function makeGatewayChallenge() {
  return {
    x402Version: 2,
    resource: { url: manifest.serve.path, description: manifest.description, mimeType: 'application/json' },
    accepts: [{
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: manifest.provider.address,
      amount: usdcToBaseUnits(manifest.pricing.priceUsdc),
      maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
      extra: { name: CIRCLE_BATCHING_METADATA.NAME, version: CIRCLE_BATCHING_METADATA.VERSION, verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet },
    }],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client paid-call orchestrator fails closed without trusted settlement', () => {
  it('fails closed without a wallet provider and without creating a payment', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await executePaidCall({ manifest, payload: { pair: 'USDC/EURC' } })

    expect(result.statusCode).toBe(503)
    expect(result.success).toBe(false)
    expect(result.costUsdc).toBe(0)
    expect(result.protocolFeeUsdc).toBeUndefined()
    expect(result.providerEarnedUsdc).toBeUndefined()
    expect(result.payment).toBeUndefined()
    expect(result.data).toBeUndefined()
    expect(result.requirements?.x402Version).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('verifies the selected EOA, signs the Circle authorization and accepts only a matching pending response', async () => {
    const challenge = makeGatewayChallenge()
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': base64Json(challenge) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        statusCode: 200,
        success: true,
        data: { status: 'LIVE', value: 12 },
        costUsdc: manifest.pricing.priceUsdc,
        payment: {
          status: 'settlement_pending',
          settlementRef: 'circle-reference-not-a-txhash',
          payerAddress: eoaAddress,
          providerAddress: manifest.provider.address,
          serviceId: manifest.id,
          amountUsdc: manifest.pricing.priceUsdc,
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchSpy)
    const provider = eoaProvider()

    const result = await executePaidCall({
      manifest,
      payload: { pair: 'USDC/EURC' },
      payer: { kind: 'external_eoa', address: eoaAddress },
      walletAddress: eoaAddress,
      provider,
    })

    expect(result.success).toBe(true)
    expect(result.payment?.status).toBe('settlement_pending')
    expect(result.payment?.settlementRef).not.toMatch(/^0x[0-9a-f]{64}$/i)
    expect(result.costUsdc).toBe(manifest.pricing.priceUsdc)
    expect(provider.request.mock.calls.map(([call]) => call.method)).toEqual(['eth_chainId', 'eth_accounts', 'eth_signTypedData_v4'])
    const sentHeader = new Headers(fetchSpy.mock.calls[1][1]?.headers).get('Payment-Signature')
    const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(sentHeader!), (char) => char.charCodeAt(0))))
    expect(decoded.x402Version).toBe(2)
    expect(decoded.accepted.asset).toBe(ARC_TESTNET_TOKENS.USDC)
    expect(decoded.payload.authorization.from.toLowerCase()).toBe(eoaAddress)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('rejects an untrusted payment challenge before asking the wallet to sign', async () => {
    const invalidChallenge = makeGatewayChallenge()
    invalidChallenge.accepts[0].asset = 'USDC' as any
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': base64Json(invalidChallenge) } })))
    const provider = eoaProvider()

    const result = await executePaidCall({ manifest, payload: {}, walletAddress: eoaAddress, provider })

    expect(result.success).toBe(false)
    expect(result.statusCode).toBe(502)
    expect(provider.request.mock.calls.map(([call]) => call.method)).toEqual(['eth_chainId', 'eth_accounts'])
  })

  it('rejects a facilitator response that does not verify the signed EOA or pending amount', async () => {
    const challenge = makeGatewayChallenge()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': base64Json(challenge) } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        statusCode: 200, success: true, data: { status: 'LIVE' },
        payment: { status: 'settlement_pending', settlementRef: 'circle-ref', payerAddress: '0x2222222222222222222222222222222222222222', providerAddress: manifest.provider.address, serviceId: manifest.id, amountUsdc: manifest.pricing.priceUsdc },
      }), { status: 200 })))
    const provider = eoaProvider()

    const result = await executePaidCall({ manifest, payload: {}, walletAddress: eoaAddress, provider })

    expect(result.success).toBe(false)
    expect(result.costUsdc).toBe(0)
    expect(result.error).toMatch(/acceptance or paid service result could not be verified/i)
  })

  it('does not accept session EOAs or passkey/MSCA signers', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await executePaidCall({
      manifest,
      payload: { pair: 'USDC/EURC' },
      payer: { kind: 'session_eoa', address: '0x2222222222222222222222222222222222222222' },
    })

    expect(result.statusCode).toBe(503)
    expect(result.success).toBe(false)
    expect(result.costUsdc).toBe(0)
    expect(result.error).toMatch(/no authorization or charge was created/i)
    expect(result.authProof).toBeUndefined()
    expect(result.payment).toBeUndefined()
    expect(result.data).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
